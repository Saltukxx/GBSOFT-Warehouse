import type { HandlingClass, VelocityClass } from "@prisma/client";
import type { ImportIssue, ImportRow } from "@gbsoft/domain";
import { readDate, readNumber, readString, reqDate, reqNumber, reqString } from "@gbsoft/domain";
import type { ApplyContext, ApplyOutcome, CheckContext, ImportHandler } from "./context.js";
import { error, findDuplicates, warning } from "./context.js";

/**
 * SKU master, ölçü verisi ve hız anlık görüntüsü.
 *
 * İki kural bu dosyanın omurgasıdır:
 *
 *  1. Kaynak sistem kimliği asla üzerine yazılmaz (PDF §5, §17). Bir kez
 *     kurulan (sourceSystem, sourceId) → kanonik kod eşlemesi değişmez;
 *     çakışma sessizce çözülmez, satır reddedilir.
 *  2. Ölçü verisi eksikse SKU sessizce kaybolmaz; yazılır ama uyarı üretir
 *     ve slot planı kapsamı dışında kalacağı açıkça söylenir.
 */

const HANDLING: Record<string, HandlingClass> = {
  standard: "STANDARD",
  fragile: "FRAGILE",
  heavy: "HEAVY",
};

const DIMENSION_COLUMNS = ["widthCm", "depthCm", "heightCm", "weightKg"] as const;

export const skuHandler: ImportHandler = {
  async check(rows, ctx: CheckContext): Promise<ImportIssue[]> {
    const issues: ImportIssue[] = [
      ...findDuplicates(rows, (r) => readString(r, "code"), "code", "SKU kodu"),
      ...findDuplicates(
        rows,
        (r) => {
          const system = readString(r, "sourceSystem");
          const id = readString(r, "sourceId");
          return system && id ? `${system}:${id}` : null;
        },
        "sourceId",
        "Kaynak sistem kimliği",
      ),
    ];

    // --- Kimlik çakışması -------------------------------------------------
    const identityKeys = rows
      .map((row) => ({
        row,
        system: readString(row, "sourceSystem"),
        id: readString(row, "sourceId"),
      }))
      .filter((entry) => entry.system !== null && entry.id !== null);

    if (identityKeys.length > 0) {
      const existing = await ctx.db.identityMap.findMany({
        where: {
          tenantId: ctx.tenantId,
          facilityId: ctx.facilityId,
          entityType: "sku",
          OR: identityKeys.map((entry) => ({
            sourceSystem: entry.system!,
            sourceId: entry.id!,
          })),
        },
        select: { sourceSystem: true, sourceId: true, canonicalCode: true },
      });
      const canonicalByKey = new Map(
        existing.map((e) => [`${e.sourceSystem}:${e.sourceId}`, e.canonicalCode]),
      );

      for (const entry of identityKeys) {
        const mapped = canonicalByKey.get(`${entry.system}:${entry.id}`);
        const code = reqString(entry.row, "code");
        if (mapped !== undefined && mapped !== code) {
          issues.push(
            error(
              entry.row.line,
              "kimlik-catismasi",
              `${entry.system} sistemindeki ${entry.id} kimliği zaten ` +
                `${mapped} SKU'suna bağlı; ${code} olarak yeniden bağlanamaz. ` +
                "Kaynak kimlik eşlemesi üzerine yazılmaz.",
              "sourceId",
              entry.id ?? undefined,
            ),
          );
        }
      }
    }

    // --- Yerleşim hedefi --------------------------------------------------
    const locationCodes = [
      ...new Set(
        rows
          .map((r) => readString(r, "currentLocationCode"))
          .filter((code): code is string => code !== null),
      ),
    ];

    if (locationCodes.length > 0) {
      const active = await ctx.db.layoutVersion.findFirst({
        where: { tenantId: ctx.tenantId, facilityId: ctx.facilityId, isActive: true },
        orderBy: { version: "desc" },
        select: { id: true },
      });

      if (!active) {
        issues.push(
          error(
            0,
            "aktif-surum-yok",
            "currentLocationCode verilmiş ama tesiste aktif dijital ikiz " +
              "sürümü yok. Önce geometri yükleyin.",
          ),
        );
      } else {
        const known = new Set(
          (
            await ctx.db.location.findMany({
              where: {
                tenantId: ctx.tenantId,
                layoutVersionId: active.id,
                code: { in: locationCodes },
              },
              select: { code: true },
            })
          ).map((l) => l.code),
        );

        for (const row of rows) {
          const code = readString(row, "currentLocationCode");
          if (code !== null && !known.has(code)) {
            issues.push(
              error(
                row.line,
                "bilinmeyen-lokasyon",
                `${code} gözü aktif dijital ikiz sürümünde yok.`,
                "currentLocationCode",
                code,
              ),
            );
          }
        }
      }
    }

    // --- Ölçü eksikliği (uyarı; satır kabul edilir) -----------------------
    for (const row of rows) {
      const missing = DIMENSION_COLUMNS.filter((c) => readNumber(row, c) === null);
      if (missing.length > 0) {
        issues.push(
          warning(
            row.line,
            "olcu-eksik",
            `Ölçü verisi eksik (${missing.join(", ")}). SKU yazılır ama ` +
              "kapasite kısıtı doğrulanamadığı için slot planı kapsamı dışında kalır.",
            missing[0],
          ),
        );
      }
    }

    return issues;
  },

  async apply(rows, ctx: ApplyContext): Promise<ApplyOutcome> {
    const { tx, tenantId, facilityId } = ctx;
    const issues: ImportIssue[] = [];
    const now = new Date();

    let created = 0;
    let updated = 0;
    let placementsOpened = 0;

    for (const row of rows) {
      const code = reqString(row, "code");
      const sourceSystem = readString(row, "sourceSystem");
      const sourceId = readString(row, "sourceId");

      const existing = await tx.sku.findUnique({
        where: { tenantId_facilityId_code: { tenantId, facilityId, code } },
        select: { id: true, sourceSystem: true, sourceId: true },
      });

      // Kaynak kimliği bir kez yazılır; sonraki yüklemeler onu değiştiremez.
      let keepSourceSystem = existing?.sourceSystem ?? sourceSystem;
      let keepSourceId = existing?.sourceId ?? sourceId;

      if (
        existing?.sourceId &&
        sourceId &&
        (existing.sourceId !== sourceId || existing.sourceSystem !== sourceSystem)
      ) {
        issues.push(
          warning(
            row.line,
            "kaynak-kimlik-korundu",
            `${code} için kayıtlı kaynak kimliği ` +
              `(${existing.sourceSystem}/${existing.sourceId}) korundu; ` +
              `dosyadaki ${sourceSystem}/${sourceId} değeri yazılmadı.`,
            "sourceId",
          ),
        );
        keepSourceSystem = existing.sourceSystem;
        keepSourceId = existing.sourceId;
      }

      const sku = await tx.sku.upsert({
        where: { tenantId_facilityId_code: { tenantId, facilityId, code } },
        update: {
          name: reqString(row, "name"),
          category: reqString(row, "category"),
          handling: HANDLING[readString(row, "handling") ?? "standard"],
          sourceSystem: keepSourceSystem,
          sourceId: keepSourceId,
          gtin: readString(row, "gtin"),
        },
        create: {
          tenantId,
          facilityId,
          code,
          name: reqString(row, "name"),
          category: reqString(row, "category"),
          handling: HANDLING[readString(row, "handling") ?? "standard"],
          sourceSystem: keepSourceSystem,
          sourceId: keepSourceId,
          gtin: readString(row, "gtin"),
        },
      });

      if (existing) updated += 1;
      else created += 1;

      // --- Ölçü ------------------------------------------------------------
      const dimension = {
        widthCm: readNumber(row, "widthCm"),
        depthCm: readNumber(row, "depthCm"),
        heightCm: readNumber(row, "heightCm"),
        weightKg: readNumber(row, "weightKg"),
        source: readString(row, "dimensionSource") ?? "import",
        measuredAt: readDate(row, "measuredAt"),
        toleranceP: readNumber(row, "toleranceP") ?? 0.05,
      };
      await tx.skuDimension.upsert({
        where: { skuId: sku.id },
        update: dimension,
        create: { tenantId, skuId: sku.id, ...dimension },
      });

      // --- Kimlik eşlemesi -------------------------------------------------
      if (keepSourceSystem && keepSourceId) {
        await tx.identityMap.upsert({
          where: {
            tenantId_facilityId_entityType_sourceSystem_sourceId: {
              tenantId,
              facilityId,
              entityType: "sku",
              sourceSystem: keepSourceSystem,
              sourceId: keepSourceId,
            },
          },
          // canonicalCode bilinçli olarak güncellenmez: eşleme değişmez.
          update: { lastSeenAt: now },
          create: {
            tenantId,
            facilityId,
            entityType: "sku",
            sourceSystem: keepSourceSystem,
            sourceId: keepSourceId,
            canonicalCode: code,
            firstSeenAt: now,
            lastSeenAt: now,
          },
        });
      }

      // --- Yerleşim ---------------------------------------------------------
      const locationCode = readString(row, "currentLocationCode");
      if (locationCode !== null) {
        const location = await tx.location.findFirst({
          where: {
            tenantId,
            code: locationCode,
            layoutVersion: { facilityId, isActive: true },
          },
          select: { id: true },
        });

        if (location) {
          const open = await tx.skuPlacement.findFirst({
            where: { tenantId, skuId: sku.id, effectiveTo: null },
            select: { id: true, locationId: true },
          });

          if (!open || open.locationId !== location.id) {
            // Geçmiş silinmez: açık kayıt kapatılır, yenisi açılır.
            if (open) {
              await tx.skuPlacement.update({
                where: { id: open.id },
                data: { effectiveTo: now },
              });
            }
            await tx.skuPlacement.create({
              data: {
                tenantId,
                skuId: sku.id,
                locationId: location.id,
                effectiveFrom: now,
              },
            });
            placementsOpened += 1;
          }
        }
      }
    }

    const summary = [
      `${created} yeni SKU · ${updated} güncellenen SKU`,
      `${placementsOpened} yerleşim kaydı açıldı`,
    ];

    return { summary, issues };
  },
};

/* ------------------------------------------------------------------ */
/* Hız anlık görüntüsü                                                 */
/* ------------------------------------------------------------------ */

export const velocityHandler: ImportHandler = {
  async check(rows, ctx: CheckContext): Promise<ImportIssue[]> {
    const issues: ImportIssue[] = findDuplicates(
      rows,
      (r) =>
        `${reqString(r, "skuCode")}:${reqDate(r, "windowStart").toISOString()}:` +
        `${reqDate(r, "windowEnd").toISOString()}`,
      "skuCode",
      "SKU ve ölçüm penceresi",
    );

    for (const row of rows) {
      if (reqDate(row, "windowEnd") < reqDate(row, "windowStart")) {
        issues.push(
          error(
            row.line,
            "gecersiz-pencere",
            "windowEnd, windowStart'tan önce olamaz.",
            "windowEnd",
          ),
        );
      }
    }

    issues.push(...(await unknownSkuIssues(rows, "skuCode", ctx)));
    return issues;
  },

  async apply(rows, ctx: ApplyContext): Promise<ApplyOutcome> {
    const { tx, tenantId, facilityId } = ctx;
    const skuIdByCode = await loadSkuIds(tx, tenantId, facilityId, rows, "skuCode");

    for (const row of rows) {
      const skuId = skuIdByCode.get(reqString(row, "skuCode"))!;
      const windowStart = reqDate(row, "windowStart");
      const windowEnd = reqDate(row, "windowEnd");
      const data = {
        velocityClass: reqString(row, "velocityClass") as VelocityClass,
        picksPerDay: reqNumber(row, "picksPerDay"),
        unitsPerPick: reqNumber(row, "unitsPerPick"),
        replenishmentsPerDay: reqNumber(row, "replenishmentsPerDay"),
      };

      await tx.velocitySnapshot.upsert({
        where: {
          tenantId_skuId_windowStart_windowEnd: {
            tenantId,
            skuId,
            windowStart,
            windowEnd,
          },
        },
        update: data,
        create: { tenantId, skuId, windowStart, windowEnd, ...data },
      });
    }

    const windows = new Set(
      rows.map(
        (r) =>
          `${reqDate(r, "windowStart").toISOString().slice(0, 10)} → ` +
          `${reqDate(r, "windowEnd").toISOString().slice(0, 10)}`,
      ),
    );

    return {
      summary: [
        `${rows.length} hız kaydı`,
        `Ölçüm penceresi: ${[...windows].join(", ")}`,
      ],
      issues: [],
    };
  },
};

/* ------------------------------------------------------------------ */
/* Ortak yardımcılar                                                   */
/* ------------------------------------------------------------------ */

/** Dosyada geçen ama tesiste kayıtlı olmayan SKU kodlarını hata olarak döner. */
export async function unknownSkuIssues(
  rows: ImportRow[],
  column: string,
  ctx: CheckContext,
): Promise<ImportIssue[]> {
  const codes = [
    ...new Set(
      rows.map((r) => readString(r, column)).filter((c): c is string => c !== null),
    ),
  ];
  if (codes.length === 0) return [];

  const known = new Set(
    (
      await ctx.db.sku.findMany({
        where: { tenantId: ctx.tenantId, facilityId: ctx.facilityId, code: { in: codes } },
        select: { code: true },
      })
    ).map((s) => s.code),
  );

  return rows
    .filter((row) => {
      const code = readString(row, column);
      return code !== null && !known.has(code);
    })
    .map((row) =>
      error(
        row.line,
        "bilinmeyen-sku",
        `${readString(row, column)} SKU'su tesiste kayıtlı değil. ` +
          "Önce SKU master dosyasını yükleyin.",
        column,
        readString(row, column) ?? undefined,
      ),
    );
}

async function loadSkuIds(
  tx: ApplyContext["tx"],
  tenantId: string,
  facilityId: string,
  rows: ImportRow[],
  column: string,
): Promise<Map<string, string>> {
  const codes = [
    ...new Set(
      rows.map((r) => readString(r, column)).filter((c): c is string => c !== null),
    ),
  ];
  const skus = await tx.sku.findMany({
    where: { tenantId, facilityId, code: { in: codes } },
    select: { id: true, code: true },
  });
  return new Map(skus.map((s) => [s.code, s.id]));
}
