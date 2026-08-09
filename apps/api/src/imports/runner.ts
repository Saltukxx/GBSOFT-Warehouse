import type { ImportIssue, ImportKind, ImportReport, ImportRow, ImportStatus } from "@gbsoft/domain";
import { IMPORT_TEMPLATES, validateImportCsv } from "@gbsoft/domain";
import { prisma } from "../db.js";
import type { ImportHandler, ImportOptions } from "./context.js";
import { floorAreaHandler, layoutHandler } from "./layout.js";
import { skuHandler, velocityHandler } from "./product.js";
import { pickTaskHandler, waveHandler } from "./execution.js";

/**
 * İçe aktarma akışı.
 *
 *   ayrıştır → kolon doğrula → bağlam doğrula → (kuru koşu değilse) yaz
 *
 * Kuru koşu varsayılandır. Kullanıcı önce raporu görür, sonra uygular; iki
 * aşama da aynı kontrollerden geçer, bu yüzden rapor gerçeği söyler.
 *
 * Hiçbir aşamada satır sessizce atılmaz: reddedilen her satır numarası,
 * kolonu ve nedeniyle rapora girer ve rapor ImportBatch içinde saklanır.
 */

const HANDLERS: Record<ImportKind, ImportHandler> = {
  layout: layoutHandler,
  "floor-area": floorAreaHandler,
  sku: skuHandler,
  velocity: velocityHandler,
  wave: waveHandler,
  "pick-task": pickTaskHandler,
};

/** Rapor gövdesinin sınırı; sayaçlar her zaman tam sayıyı gösterir. */
const MAX_ISSUES = 500;

export type RunImportParams = {
  kind: ImportKind;
  tenantId: string;
  facilityId: string;
  facilityCode: string;
  fileName: string;
  content: string;
  dryRun: boolean;
  options: ImportOptions;
  correlationId: string;
};

export async function runImport(params: RunImportParams): Promise<ImportReport> {
  const { kind, tenantId, facilityId, facilityCode, fileName, dryRun, options } = params;
  const template = IMPORT_TEMPLATES[kind];
  const startedAt = new Date();

  const validation = validateImportCsv(kind, params.content);
  const issues: ImportIssue[] = [...validation.issues];

  let accepted: ImportRow[] = validation.rows;
  let summary: string[] = [];
  let fatal = validation.fatal;

  // --- Bağlam doğrulaması ------------------------------------------------
  if (!fatal && accepted.length > 0) {
    const checkIssues = await HANDLERS[kind].check(accepted, {
      db: prisma,
      tenantId,
      facilityId,
      options,
    });
    issues.push(...checkIssues);

    const rejectedLines = new Set(
      checkIssues.filter((i) => i.severity === "error").map((i) => i.line),
    );

    if (rejectedLines.size > 0) {
      if (template.rejectPolicy === "all-or-nothing") {
        fatal = true;
        accepted = [];
      } else {
        // line 0 dosya seviyesi bir hatadır: hiçbir satır yazılamaz.
        accepted = rejectedLines.has(0)
          ? []
          : accepted.filter((row) => !rejectedLines.has(row.line));
        if (accepted.length === 0) fatal = true;
      }
    }
  } else if (!fatal && accepted.length === 0) {
    // Geçerli satır yok: dosyada yalnız başlık olabilir.
    fatal = true;
    if (validation.rowsTotal === 0) {
      issues.push({
        line: 0,
        code: "veri-yok",
        message: "Dosyada başlık dışında satır yok.",
        severity: "error",
      });
    }
  }

  // --- Yazma --------------------------------------------------------------
  let status: ImportStatus = fatal ? "REJECTED" : dryRun ? "VALIDATED" : "APPLIED";

  if (!fatal && !dryRun) {
    const outcome = await prisma.$transaction(
      async (tx) =>
        HANDLERS[kind].apply(accepted, {
          tx,
          tenantId,
          facilityId,
          options,
          correlationId: params.correlationId,
        }),
      { timeout: 120_000, maxWait: 15_000 },
    );
    summary = outcome.summary;
    issues.push(...outcome.issues);
  } else if (!fatal) {
    summary = [
      `${accepted.length} satır yazılmaya hazır.`,
      "Kuru koşu: veritabanına hiçbir şey yazılmadı.",
    ];
  }

  const finishedAt = new Date();
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.length - errorCount;
  const rowsRejected = validation.rowsTotal - accepted.length;

  const report: ImportReport = {
    batchId: null,
    kind,
    fileName,
    facilityCode,
    dryRun,
    status,
    delimiter: validation.delimiter,
    rowsTotal: validation.rowsTotal,
    rowsAccepted: accepted.length,
    rowsRejected,
    issues: issues.slice(0, MAX_ISSUES),
    issuesTruncated: issues.length > MAX_ISSUES,
    errorCount,
    warningCount,
    summary,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    correlationId: params.correlationId,
  };

  // --- Parti kaydı ---------------------------------------------------------
  // Kuru koşular da saklanır: kullanıcının ne denediği de denetim izidir.
  const batch = await prisma.importBatch.create({
    data: {
      tenantId,
      facilityId,
      kind,
      fileName,
      status,
      dryRun,
      rowsTotal: validation.rowsTotal,
      rowsAccepted: accepted.length,
      rowsRejected,
      report: { ...report, batchId: undefined },
      correlationId: params.correlationId,
    },
    select: { id: true },
  });

  report.batchId = batch.id;

  if (status === "APPLIED") {
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: `import.${kind}`,
        entityType: "ImportBatch",
        entityId: batch.id,
        correlationId: params.correlationId,
        after: {
          fileName,
          rowsAccepted: accepted.length,
          rowsRejected,
          summary,
        },
      },
    });
  }

  return report;
}
