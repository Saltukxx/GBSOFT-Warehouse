import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ImportBatchSummary, ImportKind, ImportReport, ImportTemplate } from "@gbsoft/domain";
import { IMPORT_KINDS, IMPORT_TEMPLATES, isImportKind, templateToCsvRows, toCsv } from "@gbsoft/domain";
import { prisma } from "../db.js";
import type { ImportOptions } from "../imports/context.js";
import { runImport } from "../imports/runner.js";

/**
 * Veri girişi uçları.
 *
 * Müşteri yok senaryosunda konektör yerine kendi giriş yüzeyimiz: şablon
 * indir, doldur, yükle. Yükleme varsayılan olarak **kuru koşudur**; yazma
 * ayrı ve açık bir komuttur (`dryRun=0`).
 *
 * HTTP anlamı: kısmi ret bir başarıdır (200) — kabul edilen satırlar
 * yazılmıştır, reddedilenler raporda durur. Yalnız dosyanın tamamı
 * reddedildiğinde 422 döner; gövde her iki durumda da tam rapordur.
 */

/** Yükleme gövdesi sınırı. 96 gözlük bir geometri ~15 KB'dir. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

type UploadBody = { fileName?: string; content?: string; options?: ImportOptions };

const RESERVED_QUERY = new Set(["facility", "dryRun", "fileName"]);

function optionsFromQuery(query: Record<string, unknown>): ImportOptions {
  const options: ImportOptions = {};
  for (const [key, value] of Object.entries(query)) {
    if (RESERVED_QUERY.has(key)) continue;
    if (typeof value === "string") options[key] = value;
  }
  return options;
}

async function resolveFacility(tenantId: string, code: string | undefined) {
  if (code) {
    return prisma.facility.findUnique({
      where: { tenantId_code: { tenantId, code } },
      select: { id: true, code: true },
    });
  }

  // Tek kiracı kurulumda tek tesis varsa onu kullanmak güvenlidir; birden
  // çoksa hangisine yazılacağı tahmin edilmez.
  const facilities = await prisma.facility.findMany({
    where: { tenantId },
    select: { id: true, code: true },
    take: 2,
  });
  return facilities.length === 1 ? facilities[0] : null;
}

export async function importRoutes(app: FastifyInstance) {
  // Ham CSV gövdesi: curl ve betikler için en doğal biçim.
  app.addContentTypeParser(
    ["text/csv", "text/plain"],
    { parseAs: "string", bodyLimit: MAX_UPLOAD_BYTES },
    (_request, body, done) => done(null, body),
  );

  /* GET /imports/templates */
  app.get("/imports/templates", async (): Promise<{ templates: ImportTemplate[] }> => ({
    templates: IMPORT_KINDS.map((kind) => IMPORT_TEMPLATES[kind]),
  }));

  /* GET /imports/templates/:kind.csv — doldurulmaya hazır dosya */
  app.get<{ Params: { kind: string }; Querystring: { delimiter?: string } }>(
    "/imports/templates/:kind.csv",
    async (request, reply) => {
      const { kind } = request.params;
      if (!isImportKind(kind)) {
        return reply.notFound(`Bilinmeyen içe aktarma türü: ${kind}`);
      }

      // Türkçe Excel noktalı virgülle açar; varsayılan olarak onu veriyoruz.
      const delimiter = request.query.delimiter === "," ? "," : ";";
      const csv = toCsv(templateToCsvRows(IMPORT_TEMPLATES[kind]), delimiter);

      return reply
        .type("text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="gbsoft-${kind}.csv"`)
        // BOM: Excel dosyayı UTF-8 olarak açsın, Türkçe karakterler bozulmasın.
        .send(`\uFEFF${csv}\r\n`);
    },
  );

  /* POST /imports/:kind */
  app.post<{
    Params: { kind: string };
    Querystring: Record<string, string | undefined>;
    Body: UploadBody | string;
  }>(
    "/imports/:kind",
    { bodyLimit: MAX_UPLOAD_BYTES },
    async (request, reply): Promise<ImportReport | undefined> => {
      const { kind } = request.params;
      if (!isImportKind(kind)) {
        return reply.notFound(
          `Bilinmeyen içe aktarma türü: ${kind}. ` +
            `Geçerli türler: ${IMPORT_KINDS.join(", ")}.`,
        );
      }

      const rawBody = request.body;
      const isJsonBody = typeof rawBody === "object" && rawBody !== null;

      const content = isJsonBody ? (rawBody as UploadBody).content : rawBody;
      if (typeof content !== "string" || content.trim() === "") {
        return reply.badRequest(
          "Gövde boş. CSV içeriğini text/csv olarak veya JSON gövdede " +
            "`content` alanında gönderin.",
        );
      }

      const facilityCode = request.query.facility;
      const facility = await resolveFacility(request.tenantId, facilityCode);
      if (!facility) {
        return reply.notFound(
          facilityCode
            ? `Tesis bulunamadı: ${facilityCode}`
            : "Birden çok tesis var; `facility` sorgu parametresiyle hangisine " +
                "yükleneceğini belirtin.",
        );
      }

      const fileName =
        (isJsonBody ? (rawBody as UploadBody).fileName : undefined) ??
        request.query.fileName ??
        `${kind}.csv`;

      // Yazma açık bir komuttur; varsayılan kuru koşudur.
      const dryRunRaw = request.query.dryRun;
      const dryRun = !(dryRunRaw === "0" || dryRunRaw === "false");

      const options: ImportOptions = {
        ...optionsFromQuery(request.query),
        ...(isJsonBody ? ((rawBody as UploadBody).options ?? {}) : {}),
      };

      const report = await runImport({
        kind: kind as ImportKind,
        tenantId: request.tenantId,
        facilityId: facility.id,
        facilityCode: facility.code,
        fileName,
        content,
        dryRun,
        options,
        correlationId: request.correlationId,
      });

      // Kısmi ret başarıdır; yalnız dosyanın tamamı reddedildiyse 422.
      if (report.status === "REJECTED") return reply.status(422).send(report);
      return report;
    },
  );

  /* GET /imports/batches */
  app.get<{ Querystring: { facility?: string; limit?: string } }>(
    "/imports/batches",
    async (request, reply): Promise<{ batches: ImportBatchSummary[] } | undefined> => {
      const facility = await resolveFacility(request.tenantId, request.query.facility);
      if (!facility) return reply.notFound("Tesis bulunamadı.");

      const limit = Math.min(Number(request.query.limit ?? 50) || 50, 200);
      const rows = await prisma.importBatch.findMany({
        where: { tenantId: request.tenantId, facilityId: facility.id },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          kind: true,
          fileName: true,
          status: true,
          dryRun: true,
          rowsTotal: true,
          rowsAccepted: true,
          rowsRejected: true,
          createdAt: true,
        },
      });

      return {
        batches: rows.map((row) => ({
          id: row.id,
          kind: row.kind as ImportKind,
          fileName: row.fileName,
          status: row.status,
          dryRun: row.dryRun,
          rowsTotal: row.rowsTotal,
          rowsAccepted: row.rowsAccepted,
          rowsRejected: row.rowsRejected,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },
  );

  /* GET /imports/batches/:id — saklanan satır bazlı rapor */
  app.get<{ Params: { id: string } }>(
    "/imports/batches/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const batch = await prisma.importBatch.findFirst({
        where: { id: request.params.id, tenantId: request.tenantId },
      });
      if (!batch) return reply.notFound("İçe aktarma partisi bulunamadı.");

      return {
        ...(batch.report as object),
        batchId: batch.id,
        createdAt: batch.createdAt.toISOString(),
      };
    },
  );
}
