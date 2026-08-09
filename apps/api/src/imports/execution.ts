import type { Prisma } from "@prisma/client";
import type { ImportIssue, ImportRow } from "@gbsoft/domain";
import { readDate, readNumber, readString, reqDate, reqNumber, reqString } from "@gbsoft/domain";
import type { ApplyContext, ApplyOutcome, CheckContext, ImportHandler } from "./context.js";
import { error, findDuplicates, warning } from "./context.js";

/**
 * Dalga ve toplama görevi geçmişi.
 *
 * Görev olayları süre modelinin etiket kaynağıdır (Faz 3). Bu yüzden zaman
 * disiplini burada başlar: `eventTime` olayın sahada gerçekleştiği andır,
 * `ingestTime` sisteme ulaştığı an. Geç gelen bir dosya doğru operasyon
 * zamanına yazılır; tahmin anındaki snapshot bozulmaz.
 */

export const waveHandler: ImportHandler = {
  async check(rows, _ctx: CheckContext): Promise<ImportIssue[]> {
    const issues = findDuplicates(
      rows,
      (r) => readString(r, "code"),
      "code",
      "Dalga kodu",
    );

    for (const row of rows) {
      if (reqDate(row, "slaCutoff") < reqDate(row, "plannedStart")) {
        issues.push(
          warning(
            row.line,
            "sla-baslangictan-once",
            "SLA kesimi planlanan başlangıçtan önce. Dalga daima gecikmiş sayılır.",
            "slaCutoff",
          ),
        );
      }
    }

    return issues;
  },

  async apply(rows, ctx: ApplyContext): Promise<ApplyOutcome> {
    const { tx, tenantId, facilityId } = ctx;
    let orderLines = 0;

    for (const row of rows) {
      const data = {
        plannedStart: reqDate(row, "plannedStart"),
        slaCutoff: reqDate(row, "slaCutoff"),
        status: reqString(row, "status"),
        orderLines: reqNumber(row, "orderLines"),
      };
      orderLines += data.orderLines;

      await tx.wave.upsert({
        where: {
          tenantId_facilityId_code: { tenantId, facilityId, code: reqString(row, "code") },
        },
        update: data,
        create: { tenantId, facilityId, code: reqString(row, "code"), ...data },
      });
    }

    return {
      summary: [`${rows.length} dalga · toplam ${orderLines} sipariş satırı`],
      issues: [],
    };
  },
};

/* ------------------------------------------------------------------ */
/* Toplama görevleri ve olaylar                                        */
/* ------------------------------------------------------------------ */

/** Aynı görevin iki kez yüklenmesini engelleyen deterministik anahtar. */
function taskKey(row: ImportRow): string {
  const sourceId = readString(row, "sourceId");
  if (sourceId !== null) return sourceId;
  const started = readDate(row, "startedAt");
  return [
    reqString(row, "waveCode"),
    reqString(row, "skuCode"),
    reqString(row, "locationCode"),
    started ? started.toISOString() : "-",
  ].join("|");
}

export const pickTaskHandler: ImportHandler = {
  async check(rows, ctx: CheckContext): Promise<ImportIssue[]> {
    const issues: ImportIssue[] = findDuplicates(
      rows,
      (r) => taskKey(r),
      "sourceId",
      "Görev kimliği",
    );

    // --- Zaman tutarlılığı ------------------------------------------------
    for (const row of rows) {
      const startedAt = readDate(row, "startedAt");
      const completedAt = readDate(row, "completedAt");

      if (startedAt && completedAt && completedAt < startedAt) {
        issues.push(
          error(
            row.line,
            "gecersiz-sure",
            "completedAt, startedAt'tan önce olamaz.",
            "completedAt",
          ),
        );
      }
      if (!startedAt && !completedAt && readNumber(row, "durationSec") === null) {
        issues.push(
          warning(
            row.line,
            "sure-etiketi-yok",
            "Başlangıç, bitiş ve süre birlikte boş. Görev yazılır ama süre " +
              "modeline etiket üretmez.",
            "completedAt",
          ),
        );
      }
    }

    // --- Dalga referansı --------------------------------------------------
    const waveCodes = [
      ...new Set(rows.map((r) => reqString(r, "waveCode"))),
    ];
    const knownWaves = new Set(
      (
        await ctx.db.wave.findMany({
          where: { tenantId: ctx.tenantId, facilityId: ctx.facilityId, code: { in: waveCodes } },
          select: { code: true },
        })
      ).map((w) => w.code),
    );
    for (const row of rows) {
      const code = reqString(row, "waveCode");
      if (!knownWaves.has(code)) {
        issues.push(
          error(
            row.line,
            "bilinmeyen-dalga",
            `${code} dalgası tesiste kayıtlı değil. Önce dalga dosyasını yükleyin.`,
            "waveCode",
            code,
          ),
        );
      }
    }

    // --- SKU ve göz referansı (uyarı) -------------------------------------
    // PickTask bu değerleri kod olarak taşır; geçmiş veri master'dan eski
    // olabilir. Satır reddedilmez ama sessizce de geçilmez.
    const skuCodes = [...new Set(rows.map((r) => reqString(r, "skuCode")))];
    const knownSkus = new Set(
      (
        await ctx.db.sku.findMany({
          where: { tenantId: ctx.tenantId, facilityId: ctx.facilityId, code: { in: skuCodes } },
          select: { code: true },
        })
      ).map((s) => s.code),
    );

    const locationCodes = [...new Set(rows.map((r) => reqString(r, "locationCode")))];
    const knownLocations = new Set(
      (
        await ctx.db.location.findMany({
          where: {
            tenantId: ctx.tenantId,
            code: { in: locationCodes },
            layoutVersion: { facilityId: ctx.facilityId },
          },
          select: { code: true },
        })
      ).map((l) => l.code),
    );

    for (const row of rows) {
      const skuCode = reqString(row, "skuCode");
      if (!knownSkus.has(skuCode)) {
        issues.push(
          warning(
            row.line,
            "bilinmeyen-sku",
            `${skuCode} SKU master'da yok; görev yazılır ama SKU bazlı ` +
              "analize girmez.",
            "skuCode",
            skuCode,
          ),
        );
      }
      const locationCode = reqString(row, "locationCode");
      if (!knownLocations.has(locationCode)) {
        issues.push(
          warning(
            row.line,
            "bilinmeyen-lokasyon",
            `${locationCode} gözü hiçbir ikiz sürümünde yok; görev yazılır ` +
              "ama mesafe analizine girmez.",
            "locationCode",
            locationCode,
          ),
        );
      }
    }

    return issues;
  },

  async apply(rows, ctx: ApplyContext): Promise<ApplyOutcome> {
    const { tx, tenantId, facilityId, correlationId } = ctx;
    const issues: ImportIssue[] = [];

    const waves = await tx.wave.findMany({
      where: { tenantId, facilityId },
      select: { id: true, code: true },
    });
    const waveIdByCode = new Map(waves.map((w) => [w.code, w.id]));

    // Daha önce yüklenmiş görevler tekrar yazılmaz.
    const keys = rows.map(taskKey);
    const existing = new Set(
      (
        await tx.pickTask.findMany({
          where: { tenantId, sourceId: { in: keys }, wave: { facilityId } },
          select: { sourceId: true },
        })
      ).map((t) => t.sourceId!),
    );

    let written = 0;
    let skipped = 0;
    let labelled = 0;
    const events: Prisma.EventCreateManyInput[] = [];

    for (const row of rows) {
      const key = taskKey(row);
      if (existing.has(key)) {
        skipped += 1;
        continue;
      }

      const startedAt = readDate(row, "startedAt");
      const completedAt = readDate(row, "completedAt");
      const explicitDuration = readNumber(row, "durationSec");
      const derivedDuration =
        startedAt && completedAt
          ? (completedAt.getTime() - startedAt.getTime()) / 1000
          : null;
      const durationSec = explicitDuration ?? derivedDuration;

      if (durationSec !== null) labelled += 1;

      const skuCode = reqString(row, "skuCode");
      const locationCode = reqString(row, "locationCode");
      const quantity = reqNumber(row, "quantity");
      const operatorRef = readString(row, "operatorRef");
      const exceptionCode = readString(row, "exceptionCode");

      await tx.pickTask.create({
        data: {
          tenantId,
          waveId: waveIdByCode.get(reqString(row, "waveCode"))!,
          sourceId: key,
          skuCode,
          locationCode,
          quantity,
          startedAt,
          completedAt,
          durationSec,
          operatorRef,
          exceptionCode,
        },
      });
      written += 1;

      // Olay zarfı (PDF §17). eventTime sahadaki an, ingestTime varsayılan
      // olarak şimdi — ikisi bilinçli olarak ayrıdır.
      const payload = {
        skuCode,
        locationCode,
        quantity,
        exceptionCode,
      } satisfies Prisma.InputJsonObject;

      if (startedAt) {
        events.push({
          tenantId,
          facilityId,
          eventType: "TASK_STARTED",
          source: "import",
          sourceId: key,
          entityType: "pick-task",
          entityId: key,
          eventTime: startedAt,
          locationCode,
          actor: operatorRef,
          payloadSchemaVersion: "1",
          payload,
          correlationId,
        });
      }
      if (completedAt) {
        events.push({
          tenantId,
          facilityId,
          eventType: "TASK_COMPLETED",
          source: "import",
          sourceId: key,
          entityType: "pick-task",
          entityId: key,
          eventTime: completedAt,
          locationCode,
          actor: operatorRef,
          payloadSchemaVersion: "1",
          payload: { ...payload, durationSec },
          correlationId,
        });
      }
    }

    // Aynı kaynak olayı iki kez işlenemez; çakışanlar sessizce atlanır
    // çünkü zaten kayıtlıdırlar.
    const eventResult =
      events.length > 0
        ? await tx.event.createMany({ data: events, skipDuplicates: true })
        : { count: 0 };

    if (skipped > 0) {
      issues.push(
        warning(
          0,
          "zaten-yuklu",
          `${skipped} görev daha önce yüklendiği için atlandı. ` +
            "Tekrar yükleme yeni kayıt üretmez.",
        ),
      );
    }

    return {
      summary: [
        `${written} toplama görevi yazıldı`,
        `${eventResult.count} olay kaydı (TASK_STARTED / TASK_COMPLETED)`,
        `${labelled} görev süre etiketi taşıyor`,
      ],
      issues,
    };
  },
};
