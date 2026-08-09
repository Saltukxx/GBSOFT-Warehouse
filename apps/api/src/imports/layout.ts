import type { EquipmentClass, RackSide } from "@prisma/client";
import type { ImportIssue } from "@gbsoft/domain";
import { readBoolean, readNumber, readString, reqBoolean, reqNumber, reqString } from "@gbsoft/domain";
import type { ApplyContext, ApplyOutcome, CheckContext, ImportHandler } from "./context.js";
import {
  booleanOption,
  error,
  findDuplicates,
  findInconsistency,
  numberOption,
  warning,
} from "./context.js";
import { rebuildLayoutGraph } from "../twin/graph.js";

/**
 * Tesis geometrisi ve raf dışı alanlar.
 *
 * Geometri all-or-nothing yüklenir: yarım yazılmış bir dijital ikiz, hiç
 * yazılmamışından kötüdür — plan onun üzerinde üretilir.
 *
 * Yükleme her zaman **yeni bir sürüm** açar, mevcut sürümü değiştirmez.
 * Planlar hangi sürümde üretildiklerini sakladığı için geçmiş bozulmaz.
 */

const EQUIPMENT: Record<string, EquipmentClass> = {
  manual: "MANUAL",
  cart: "CART",
  forklift: "FORKLIFT",
};

/** Türetilen çizim alanının kenar boşluğu (SVG kullanıcı birimi). */
const VIEWBOX_MARGIN = 40;

export const layoutHandler: ImportHandler = {
  async check(rows, _ctx: CheckContext): Promise<ImportIssue[]> {
    const issues: ImportIssue[] = [
      ...findDuplicates(rows, (r) => readString(r, "locationCode"), "locationCode", "Göz kodu"),
      ...findInconsistency(
        rows,
        (r) => readString(r, "zoneCode"),
        (r) => reqString(r, "zoneName"),
        "zoneName",
        "Zon adı",
      ),
      ...findInconsistency(
        rows,
        (r) => String(reqNumber(r, "aisleNumber")),
        (r) => `${reqNumber(r, "aisleX")}|${reqNumber(r, "walkwayWidth")}`,
        "aisleX",
        "Koridor geometrisi",
      ),
      ...findInconsistency(
        rows,
        (r) => `${reqNumber(r, "aisleNumber")}:${reqString(r, "side")}`,
        (r) =>
          `${reqNumber(r, "faceX")}|${reqNumber(r, "faceWidth")}|${reqString(r, "zoneCode")}`,
        "faceX",
        "Raf yüzü geometrisi",
      ),
    ];

    for (const row of rows) {
      if (readBoolean(row, "blocked") === true && !readString(row, "blockedReason")) {
        issues.push(
          error(
            row.line,
            "eksik-gerekce",
            "Göz bloklu işaretlenmiş ama blockedReason boş. " +
              "Kapalı bir gözün nedeni kayıtlı olmalı.",
            "blockedReason",
          ),
        );
      }
    }

    return issues;
  },

  async apply(rows, ctx: ApplyContext): Promise<ApplyOutcome> {
    const { tx, tenantId, facilityId, options } = ctx;
    const issues: ImportIssue[] = [];

    // --- Sürüm numarası --------------------------------------------------
    const latest = await tx.layoutVersion.findFirst({
      where: { tenantId, facilityId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = numberOption(options, "version") ?? (latest?.version ?? 0) + 1;

    // --- Çizim alanı ve dock referansı -----------------------------------
    const maxX = Math.max(...rows.map((r) => reqNumber(r, "x") + reqNumber(r, "width")));
    const maxY = Math.max(...rows.map((r) => reqNumber(r, "y") + reqNumber(r, "height")));
    const minX = Math.min(...rows.map((r) => reqNumber(r, "x")));

    const viewBoxWidth = numberOption(options, "viewBoxWidth") ?? maxX + VIEWBOX_MARGIN;
    const viewBoxHeight = numberOption(options, "viewBoxHeight") ?? maxY + VIEWBOX_MARGIN;

    let unitsPerMeter = numberOption(options, "unitsPerMeter");
    if (unitsPerMeter === undefined) {
      unitsPerMeter = 1;
      issues.push(
        warning(
          0,
          "varsayilan-olcek",
          "unitsPerMeter verilmedi; 1 birim = 1 m varsayıldı. " +
            "Harita ölçeği yanlış görünüyorsa bu değeri girin.",
        ),
      );
    }

    let dockAnchorX = numberOption(options, "dockAnchorX");
    let dockAnchorY = numberOption(options, "dockAnchorY");
    if (dockAnchorX === undefined || dockAnchorY === undefined) {
      dockAnchorX ??= (minX + maxX) / 2;
      dockAnchorY ??= maxY;
      issues.push(
        warning(
          0,
          "varsayilan-dock",
          "Dock referans noktası verilmedi; alanın alt orta noktası " +
            "varsayıldı. Mesafeler CSV'den okunduğu için plan etkilenmez, " +
            "harita üzerindeki dock işareti kayabilir.",
        ),
      );
    }

    const activate = booleanOption(options, "activate");

    const layoutVersion = await tx.layoutVersion.create({
      data: {
        tenantId,
        facilityId,
        version,
        viewBoxWidth,
        viewBoxHeight,
        unitsPerMeter,
        dockAnchorX,
        dockAnchorY,
        isActive: false,
        note: options.note?.trim() || `İçe aktarma · ${rows.length} göz`,
      },
    });

    // --- Zonlar -----------------------------------------------------------
    const zoneNameByCode = new Map<string, string>();
    for (const row of rows) {
      zoneNameByCode.set(reqString(row, "zoneCode"), reqString(row, "zoneName"));
    }
    const zoneIdByCode = new Map<string, string>();
    for (const [code, name] of [...zoneNameByCode].sort(([a], [b]) => a.localeCompare(b, "tr"))) {
      const zone = await tx.zone.create({
        data: { tenantId, layoutVersionId: layoutVersion.id, code, name },
      });
      zoneIdByCode.set(code, zone.id);
    }

    // --- Koridorlar -------------------------------------------------------
    type AisleSpec = { x: number; walkwayWidth: number; congestion: number };
    const aisleSpecs = new Map<number, AisleSpec>();
    for (const row of rows) {
      const number = reqNumber(row, "aisleNumber");
      if (!aisleSpecs.has(number)) {
        aisleSpecs.set(number, {
          x: reqNumber(row, "aisleX"),
          walkwayWidth: reqNumber(row, "walkwayWidth"),
          congestion: readNumber(row, "aisleCongestion") ?? 0,
        });
      }
    }
    const aisleIdByNumber = new Map<number, string>();
    for (const [number, spec] of [...aisleSpecs].sort(([a], [b]) => a - b)) {
      const aisle = await tx.aisle.create({
        data: {
          tenantId,
          layoutVersionId: layoutVersion.id,
          number,
          x: spec.x,
          walkwayWidth: spec.walkwayWidth,
          congestionScore: spec.congestion,
        },
      });
      aisleIdByNumber.set(number, aisle.id);
    }

    // --- Raf yüzleri ------------------------------------------------------
    type FaceSpec = { aisle: number; side: string; zoneCode: string; x: number; width: number };
    const faceSpecs = new Map<string, FaceSpec>();
    for (const row of rows) {
      const key = `${reqNumber(row, "aisleNumber")}:${reqString(row, "side")}`;
      if (!faceSpecs.has(key)) {
        faceSpecs.set(key, {
          aisle: reqNumber(row, "aisleNumber"),
          side: reqString(row, "side"),
          zoneCode: reqString(row, "zoneCode"),
          x: reqNumber(row, "faceX"),
          width: reqNumber(row, "faceWidth"),
        });
      }
    }
    const faceIdByKey = new Map<string, string>();
    for (const [key, spec] of faceSpecs) {
      const face = await tx.rackFace.create({
        data: {
          tenantId,
          layoutVersionId: layoutVersion.id,
          aisleId: aisleIdByNumber.get(spec.aisle)!,
          zoneId: zoneIdByCode.get(spec.zoneCode)!,
          side: spec.side.toUpperCase() as RackSide,
          x: spec.x,
          width: spec.width,
        },
      });
      faceIdByKey.set(key, face.id);
    }

    // --- Gözler -----------------------------------------------------------
    await tx.location.createMany({
      data: rows.map((row) => {
        const aisleNumber = reqNumber(row, "aisleNumber");
        const side = reqString(row, "side");
        return {
          tenantId,
          layoutVersionId: layoutVersion.id,
          zoneId: zoneIdByCode.get(reqString(row, "zoneCode"))!,
          aisleId: aisleIdByNumber.get(aisleNumber)!,
          rackFaceId: faceIdByKey.get(`${aisleNumber}:${side}`)!,
          code: reqString(row, "locationCode"),
          bay: reqNumber(row, "bay"),
          level: reqNumber(row, "level"),
          x: reqNumber(row, "x"),
          y: reqNumber(row, "y"),
          width: reqNumber(row, "width"),
          height: reqNumber(row, "height"),
          maxWeightKg: reqNumber(row, "maxWeightKg"),
          maxVolumeM3: reqNumber(row, "maxVolumeM3"),
          equipment: EQUIPMENT[reqString(row, "equipment")],
          goldenZone: reqBoolean(row, "goldenZone"),
          distanceToDockM: reqNumber(row, "distanceToDockM"),
          congestionScore:
            readNumber(row, "congestionScore") ??
            aisleSpecs.get(aisleNumber)?.congestion ??
            0,
          blocked: readBoolean(row, "blocked") ?? false,
          blockedReason: readString(row, "blockedReason"),
          dataQuality: readNumber(row, "dataQuality") ?? 1,
        };
      }),
    });

    const graph = await rebuildLayoutGraph(tx, tenantId, layoutVersion.id);

    // --- Aktifleştirme ----------------------------------------------------
    if (activate) {
      await tx.layoutVersion.updateMany({
        where: { tenantId, facilityId, isActive: true },
        data: { isActive: false },
      });
      await tx.layoutVersion.update({
        where: { id: layoutVersion.id },
        data: { isActive: true },
      });

      const openPlacements = await tx.skuPlacement.count({
        where: { tenantId, effectiveTo: null, sku: { facilityId } },
      });
      if (openPlacements > 0) {
        issues.push(
          warning(
            0,
            "yerlesim-eski-surumde",
            `Yeni sürüm aktifleştirildi ama ${openPlacements} SKU yerleşimi ` +
              "önceki sürümün gözlerine bağlı. SKU dosyasını " +
              "currentLocationCode ile yeniden yükleyin.",
          ),
        );
      }
    } else {
      issues.push(
        warning(
          0,
          "surum-pasif",
          `Sürüm ${version} yazıldı ama aktif değil; arayüz hâlâ önceki ` +
            "sürümü çiziyor. Aktifleştirmek için activate=1 ile yükleyin.",
        ),
      );
    }

    return {
      summary: [
        `Dijital ikiz sürümü ${version}${activate ? " (aktif)" : " (pasif)"}`,
        `${zoneIdByCode.size} zon · ${aisleIdByNumber.size} koridor · ${faceIdByKey.size} raf yüzü`,
        `${rows.length} göz`,
        `${graph.nodeCount} graph node · ${graph.edgeCount} edge · %${graph.coveragePct} coverage`,
      ],
      issues,
    };
  },
};

/* ------------------------------------------------------------------ */
/* Raf dışı alanlar                                                    */
/* ------------------------------------------------------------------ */

export const floorAreaHandler: ImportHandler = {
  async check(rows, ctx: CheckContext): Promise<ImportIssue[]> {
    const issues = findDuplicates(
      rows,
      (r) => readString(r, "code"),
      "code",
      "Alan kodu",
    );

    const active = await activeLayoutVersion(ctx);
    if (!active) {
      issues.push(
        error(
          0,
          "aktif-surum-yok",
          "Tesiste aktif dijital ikiz sürümü yok. Önce geometri (layout) " +
            "yükleyip activate=1 ile aktifleştirin.",
        ),
      );
    }

    return issues;
  },

  async apply(rows, ctx: ApplyContext): Promise<ApplyOutcome> {
    const { tx, tenantId, facilityId } = ctx;

    const active = await tx.layoutVersion.findFirst({
      where: { tenantId, facilityId, isActive: true },
      orderBy: { version: "desc" },
      select: { id: true, version: true },
    });
    if (!active) {
      throw new Error("Aktif dijital ikiz sürümü bulunamadı.");
    }

    for (const row of rows) {
      const data = {
        label: reqString(row, "label"),
        kind: reqString(row, "kind"),
        x: reqNumber(row, "x"),
        y: reqNumber(row, "y"),
        width: reqNumber(row, "width"),
        height: reqNumber(row, "height"),
      };
      await tx.floorArea.upsert({
        where: {
          tenantId_layoutVersionId_code: {
            tenantId,
            layoutVersionId: active.id,
            code: reqString(row, "code"),
          },
        },
        update: data,
        create: {
          tenantId,
          layoutVersionId: active.id,
          code: reqString(row, "code"),
          ...data,
        },
      });
    }

    const graph = await rebuildLayoutGraph(tx, tenantId, active.id);

    return {
      summary: [
        `${rows.length} raf dışı alan · ikiz sürümü ${active.version}`,
        `Graf güncellendi · ${graph.nodeCount} node · ${graph.edgeCount} edge`,
      ],
      issues: [],
    };
  },
};

async function activeLayoutVersion(ctx: CheckContext) {
  return ctx.db.layoutVersion.findFirst({
    where: { tenantId: ctx.tenantId, facilityId: ctx.facilityId, isActive: true },
    orderBy: { version: "desc" },
    select: { id: true, version: true },
  });
}
