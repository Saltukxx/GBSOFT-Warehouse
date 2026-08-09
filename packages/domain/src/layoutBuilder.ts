/**
 * Parametrik tesis geometrisi üreticisi.
 *
 * Layout editörünün motoru. Saf fonksiyondur: aynı taslak her zaman aynı
 * geometriyi verir, React'e veya veritabanına bağlı değildir.
 *
 * Önemli tasarım kararı: editör **kendi yazma yolunu kurmaz**. Ürettiği
 * geometri, elle doldurulmuş bir dosyayla birebir aynı CSV satırlarına
 * çevrilir ve aynı içe aktarma hattından geçer. Böylece doğrulama, ret
 * politikası, sürümleme ve denetim izi tek yerde kalır; editörle dosya
 * yükleme arasında davranış farkı oluşamaz.
 */

import type {
  AisleGeometry,
  Equipment,
  FacilityLayout,
  FloorArea,
  Location,
  RackSide,
  ZoneId,
} from "./warehouse.js";
import { formatLocationId } from "./warehouse.js";
import { estimateLocationPickTimeSec } from "./picking.js";
import { IMPORT_TEMPLATES } from "./imports.js";

export const ZONE_IDS: readonly ZoneId[] = ["A", "B", "C", "D"];

/** Bir koridorun iki yüzünün zon ataması. */
export type AisleZoning = { aisle: number; left: ZoneId; right: ZoneId };

/**
 * Göz sırasına göre raf profili. Seviye, kapasite ve ekipman sınıfı fiziksel
 * olarak göz sırasıyla değişir (alt raf ağır, üst raf forklift).
 */
export type BayProfile = {
  bay: number;
  level: number;
  maxWeightKg: number;
  maxVolumeM3: number;
  equipment: Equipment;
  goldenZone: boolean;
};

export type LayoutBlueprint = {
  aisleCount: number;
  baysPerFace: number;
  /** Bu göz sırasından sonra cross-aisle şeridi geçer; 0 ise yok. */
  crossAisleAfterBay: number;

  // Çizim ızgarası (SVG kullanıcı birimi).
  originX: number;
  originY: number;
  aislePitch: number;
  rackWidth: number;
  walkwayWidth: number;
  bayHeight: number;
  bayGap: number;
  crossAisleGap: number;

  /** SVG kullanıcı birimi / metre. Mesafeler buradan metreye çevrilir. */
  unitsPerMeter: number;

  dock: { x: number; y: number; width: number; height: number; label: string };

  zoneNames: Record<ZoneId, string>;
  zoning: AisleZoning[];
  bayProfiles: BayProfile[];

  /** Göz kodu → engel nedeni. Boş nedenle bloklama kabul edilmez. */
  blocked: Record<string, string>;
};

export const DEFAULT_BAY_PROFILES: BayProfile[] = [
  { bay: 1, level: 2, maxWeightKg: 680, maxVolumeM3: 1.6, equipment: "manual", goldenZone: true },
  { bay: 2, level: 2, maxWeightKg: 680, maxVolumeM3: 1.6, equipment: "manual", goldenZone: true },
  { bay: 3, level: 1, maxWeightKg: 680, maxVolumeM3: 1.6, equipment: "cart", goldenZone: false },
  { bay: 4, level: 3, maxWeightKg: 420, maxVolumeM3: 1.1, equipment: "forklift", goldenZone: false },
];

/** Marmara DM ölçüleri — yeni tesis kurarken makul bir başlangıç. */
export const DEFAULT_BLUEPRINT: LayoutBlueprint = {
  aisleCount: 12,
  baysPerFace: 4,
  crossAisleAfterBay: 2,
  originX: 40,
  originY: 40,
  aislePitch: 76,
  rackWidth: 28,
  walkwayWidth: 20,
  bayHeight: 62,
  bayGap: 6,
  crossAisleGap: 26,
  unitsPerMeter: 7,
  dock: { x: 110, y: 356, width: 80, height: 40, label: "Sevkiyat kapısı" },
  zoneNames: {
    A: "Zone A · Hızlı akış",
    B: "Zone B · Standart",
    C: "Zone C · Yavaş",
    D: "Zone D · Hacimli",
  },
  zoning: Array.from({ length: 12 }, (_, i) => {
    const aisle = i + 1;
    return {
      aisle,
      left: (aisle <= 5 ? "A" : aisle <= 11 ? "B" : "C") as ZoneId,
      right: (aisle <= 5 ? "B" : aisle <= 9 ? "C" : "D") as ZoneId,
    };
  }),
  bayProfiles: DEFAULT_BAY_PROFILES,
  blocked: {},
};

/* ------------------------------------------------------------------ */
/* Geometri                                                            */
/* ------------------------------------------------------------------ */

function faceX(bp: LayoutBlueprint, aisle: number, side: RackSide): number {
  const base = bp.originX + (aisle - 1) * bp.aislePitch;
  return side === "left" ? base : base + bp.rackWidth + bp.walkwayWidth;
}

/**
 * Göz üst kenarının y konumu. Göz sırası 1 dock'a en yakındır, bu yüzden
 * en aşağıda çizilir; cross-aisle şeridi araya boşluk ekler.
 */
function bayY(bp: LayoutBlueprint, bay: number): number {
  const fromTop = bp.baysPerFace - bay;
  const base = bp.originY + fromTop * (bp.bayHeight + bp.bayGap);
  const shiftsAfter = bp.baysPerFace - bp.crossAisleAfterBay;
  return bp.crossAisleAfterBay > 0 && fromTop >= shiftsAfter
    ? base + bp.crossAisleGap
    : base;
}

function crossAisleBand(bp: LayoutBlueprint): { y: number; height: number } | null {
  if (bp.crossAisleAfterBay <= 0 || bp.crossAisleAfterBay >= bp.baysPerFace) {
    return null;
  }
  const fromTop = bp.baysPerFace - bp.crossAisleAfterBay;
  return {
    y: bp.originY + fromTop * (bp.bayHeight + bp.bayGap),
    height: Math.max(1, bp.crossAisleGap - bp.bayGap),
  };
}

function profileFor(bp: LayoutBlueprint, bay: number): BayProfile {
  return (
    bp.bayProfiles.find((p) => p.bay === bay) ?? {
      bay,
      level: 1,
      maxWeightKg: 500,
      maxVolumeM3: 1.2,
      equipment: "manual",
      goldenZone: false,
    }
  );
}

function zoningFor(bp: LayoutBlueprint, aisle: number): AisleZoning {
  return (
    bp.zoning.find((z) => z.aisle === aisle) ?? { aisle, left: "A", right: "B" }
  );
}

export type LayoutDraft = {
  layout: FacilityLayout;
  locations: Location[];
  /** Kaydetmeden önce kullanıcıya gösterilen uyarılar. */
  warnings: string[];
};

/**
 * Taslaktan çizilebilir bir dijital ikiz üretir.
 *
 * Yeni bir tesiste ölçülmüş etkinlik verisi yoktur; `picksPerDay`,
 * `replenishmentsPerDay` ve `congestionScore` sıfırdır. Bunları uydurmak,
 * ölçülmemiş bir şeyi ölçülmüş göstermek olurdu.
 */
export function buildLayoutDraft(bp: LayoutBlueprint): LayoutDraft {
  const warnings: string[] = [];
  const locations: Omit<Location, "pickTimeSec">[] = [];

  const dockAnchor = {
    x: bp.dock.x + bp.dock.width / 2,
    y: bp.dock.y + bp.dock.height / 2,
  };

  for (let aisle = 1; aisle <= bp.aisleCount; aisle += 1) {
    const zoning = zoningFor(bp, aisle);
    for (const side of ["left", "right"] as const) {
      const zone = side === "left" ? zoning.left : zoning.right;
      const x = faceX(bp, aisle, side);

      for (let bay = 1; bay <= bp.baysPerFace; bay += 1) {
        const profile = profileFor(bp, bay);
        const id = formatLocationId(zone, aisle, bay);
        const y = bayY(bp, bay);
        const cx = x + bp.rackWidth / 2;
        const cy = y + bp.bayHeight / 2;

        // Yürüme mesafesi koridor boyunca ölçülür (Manhattan). Gerçek graf
        // mesafesi Faz 2'de gelir; o zamana kadar bu tahmindir.
        const distanceToDockM =
          Math.round(
            ((Math.abs(cx - dockAnchor.x) + Math.abs(cy - dockAnchor.y)) /
              bp.unitsPerMeter) *
              10,
          ) / 10;

        const blockedReason = bp.blocked[id];

        locations.push({
          id,
          zone,
          aisle,
          bay,
          level: profile.level,
          x,
          y,
          width: bp.rackWidth,
          height: bp.bayHeight,
          maxWeightKg: profile.maxWeightKg,
          maxVolumeM3: profile.maxVolumeM3,
          equipment: profile.equipment,
          goldenZone: profile.goldenZone,
          congestionScore: 0,
          blocked: Boolean(blockedReason),
          blockedReason,
          distanceToDockM,
          picksPerDay: 0,
          replenishmentsPerDay: 0,
          dataQuality: 1,
        });
      }
    }
  }

  // --- Uyarılar ---------------------------------------------------------
  const codes = new Map<string, number>();
  for (const loc of locations) {
    codes.set(loc.id, (codes.get(loc.id) ?? 0) + 1);
  }
  const duplicates = [...codes].filter(([, count]) => count > 1).map(([code]) => code);
  if (duplicates.length > 0) {
    warnings.push(
      `Aynı göz kodu birden çok kez üretiliyor (${duplicates.slice(0, 3).join(", ")}` +
        `${duplicates.length > 3 ? "…" : ""}). Bir koridorun iki yüzüne aynı zonu ` +
        "atadıysanız kodlar çakışır.",
    );
  }

  const missingReason = Object.entries(bp.blocked)
    .filter(([, reason]) => !reason.trim())
    .map(([code]) => code);
  if (missingReason.length > 0) {
    warnings.push(
      `Bloklu göz için neden girilmedi: ${missingReason.join(", ")}. ` +
        "Kapalı bir gözün nedeni kayıtlı olmalı.",
    );
  }

  const band = crossAisleBand(bp);
  const maxRackY = Math.max(...locations.map((l) => l.y + l.height));
  const maxRackX = Math.max(...locations.map((l) => l.x + l.width));

  if (bp.dock.y < maxRackY && bp.dock.x < maxRackX) {
    warnings.push(
      "Dock alanı raf bloğuyla çakışıyor. Dock'u rafların altına veya yanına alın.",
    );
  }
  if (bp.walkwayWidth <= 0) {
    warnings.push("Yürüme koridoru genişliği sıfır; iki raf yüzü bitişik çiziliyor.");
  }

  const usedZones = new Set(locations.map((l) => l.zone));

  const viewBox = {
    width: Math.max(maxRackX, bp.dock.x + bp.dock.width) + bp.originX,
    height: Math.max(maxRackY, bp.dock.y + bp.dock.height) + bp.originY,
  };

  const aisles: AisleGeometry[] = Array.from(
    { length: bp.aisleCount },
    (_, i) => {
      const aisle = i + 1;
      const zoning = zoningFor(bp, aisle);
      return {
        number: aisle,
        x: faceX(bp, aisle, "left"),
        walkwayWidth: bp.walkwayWidth,
        congestionScore: 0,
        faces: [
          { side: "left" as const, zone: zoning.left, x: faceX(bp, aisle, "left"), width: bp.rackWidth },
          { side: "right" as const, zone: zoning.right, x: faceX(bp, aisle, "right"), width: bp.rackWidth },
        ],
      };
    },
  );

  const floorAreas: FloorArea[] = [
    {
      id: "DOCK-1",
      label: bp.dock.label,
      kind: "dock",
      x: bp.dock.x,
      y: bp.dock.y,
      width: bp.dock.width,
      height: bp.dock.height,
    },
  ];
  if (band) {
    floorAreas.push({
      id: "CROSS-1",
      label: "Cross-aisle",
      kind: "cross-aisle",
      x: bp.originX,
      y: band.y,
      width: maxRackX - bp.originX,
      height: band.height,
    });
  }

  const layout: FacilityLayout = {
    // Tesis kimliği kaydetme sırasında sunucu tarafında belirlenir; önizleme
    // bunu bilmek zorunda değildir.
    facilityCode: "",
    facilityName: "",
    layoutVersion: 0,
    viewBox,
    unitsPerMeter: bp.unitsPerMeter,
    dockAnchor,
    zones: ZONE_IDS.filter((code) => usedZones.has(code)).map((code) => ({
      code,
      name: bp.zoneNames[code],
    })),
    aisles,
    floorAreas,
  };

  const meanDistanceToDockM =
    locations.reduce((sum, l) => sum + l.distanceToDockM, 0) /
    Math.max(1, locations.length);

  return {
    layout,
    locations: locations.map((draft) => ({
      ...draft,
      pickTimeSec: estimateLocationPickTimeSec({
        distanceToDockM: draft.distanceToDockM,
        meanDistanceToDockM,
        congestionScore: draft.congestionScore,
        goldenZone: draft.goldenZone,
      }),
    })),
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* CSV karşılığı                                                       */
/* ------------------------------------------------------------------ */

/** Ondalık ayraç olarak virgül — export:csv çıktısıyla aynı biçim. */
function n(value: number, precision = 3): string {
  return String(Number(value.toFixed(precision))).replace(".", ",");
}

/**
 * Taslağı `layout` şablonunun satırlarına çevirir.
 *
 * Kolon sırası şablon tanımından okunur; şablona kolon eklendiğinde burası
 * sessizce bozulamaz.
 */
export function blueprintToLayoutCsvRows(bp: LayoutBlueprint): string[][] {
  const { layout, locations } = buildLayoutDraft(bp);
  const columns = IMPORT_TEMPLATES.layout.columns.map((c) => c.name);
  const aisleById = new Map(layout.aisles.map((a) => [a.number, a]));

  const rows = locations.map((loc) => {
    const aisle = aisleById.get(loc.aisle)!;
    const face = aisle.faces.find((f) => f.zone === loc.zone)!;
    const record: Record<string, string> = {
      zoneCode: loc.zone,
      zoneName: bp.zoneNames[loc.zone],
      aisleNumber: String(loc.aisle),
      aisleX: n(aisle.x),
      walkwayWidth: n(aisle.walkwayWidth),
      aisleCongestion: n(aisle.congestionScore),
      side: face.side,
      faceX: n(face.x),
      faceWidth: n(face.width),
      locationCode: loc.id,
      bay: String(loc.bay),
      level: String(loc.level),
      x: n(loc.x),
      y: n(loc.y),
      width: n(loc.width),
      height: n(loc.height),
      maxWeightKg: n(loc.maxWeightKg),
      maxVolumeM3: n(loc.maxVolumeM3),
      equipment: loc.equipment,
      goldenZone: loc.goldenZone ? "evet" : "hayır",
      distanceToDockM: n(loc.distanceToDockM),
      congestionScore: n(loc.congestionScore),
      blocked: loc.blocked ? "evet" : "hayır",
      blockedReason: loc.blockedReason ?? "",
      dataQuality: n(loc.dataQuality),
    };
    return columns.map((name) => record[name] ?? "");
  });

  return [columns, ...rows];
}

/** Taslağın raf dışı alanlarını `floor-area` şablonuna çevirir. */
export function blueprintToFloorAreaCsvRows(bp: LayoutBlueprint): string[][] {
  const { layout } = buildLayoutDraft(bp);
  const columns = IMPORT_TEMPLATES["floor-area"].columns.map((c) => c.name);

  const rows = layout.floorAreas.map((area) => {
    const record: Record<string, string> = {
      code: area.id,
      label: area.label,
      kind: area.kind,
      x: n(area.x),
      y: n(area.y),
      width: n(area.width),
      height: n(area.height),
    };
    return columns.map((name) => record[name] ?? "");
  });

  return [columns, ...rows];
}
