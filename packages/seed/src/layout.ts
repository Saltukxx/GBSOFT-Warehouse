import type { AisleFaces, FacilityLayout, FloorArea, Location, ZoneId } from "@gbsoft/domain";
import { estimateLocationPickTimeSec, formatLocationId } from "@gbsoft/domain";
import { seededRange } from "./rng.js";

/**
 * Depo geometrisi.
 *
 * 12 koridor · her koridorda iki raf yüzü · her yüzde 4 göz = 96 lokasyon.
 * Bir koridorun iki yüzü farklı zonlara ait olabilir; cross-aisle koridoru
 * ikiye böler. Bay 01 dock'a en yakın gözdür.
 */

export const AISLE_COUNT = 12;
export const BAYS_PER_FACE = 4;

/** Koridor yüzlerinin zon ataması. */
export const AISLE_FACES: AisleFaces[] = Array.from(
  { length: AISLE_COUNT },
  (_, i) => {
    const aisle = i + 1;
    const left: ZoneId = aisle <= 5 ? "A" : aisle <= 11 ? "B" : "C";
    const right: ZoneId = aisle <= 5 ? "B" : aisle <= 9 ? "C" : "D";
    return { aisle, left, right };
  },
);

/* ------------------------------------------------------------------ */
/* SVG geometrisi                                                      */
/* ------------------------------------------------------------------ */

export const MAP = {
  width: 1000,
  height: 452,
  originX: 40,
  aislePitch: 76,
  rackWidth: 28,
  walkwayWidth: 20,
  bayHeight: 62,
  bayGap: 6,
  crossAisleGap: 26,
  /** Dock referans noktası — mesafe hesabı buradan yapılır. */
  dockX: 150,
  dockY: 376,
  /** SVG kullanıcı birimi / metre. */
  unitsPerMeter: 7,
};

/** Göz üst kenarının y konumu. Bay 4 en üstte, bay 1 dock'a en yakın. */
function bayY(bay: number): number {
  const fromTop = BAYS_PER_FACE - bay; // bay 4 -> 0
  const base = 40 + fromTop * (MAP.bayHeight + MAP.bayGap);
  return fromTop >= 2 ? base + MAP.crossAisleGap : base;
}

function faceX(aisle: number, side: "left" | "right"): number {
  const base = MAP.originX + (aisle - 1) * MAP.aislePitch;
  return side === "left" ? base : base + MAP.rackWidth + MAP.walkwayWidth;
}

/** Cross-aisle şeridinin y aralığı — haritada koridor ayrımı olarak çizilir. */
export const CROSS_AISLE = {
  y: 40 + 2 * (MAP.bayHeight + MAP.bayGap),
  height: MAP.crossAisleGap - MAP.bayGap,
};

/* ------------------------------------------------------------------ */
/* Koridor yoğunluğu                                                   */
/* ------------------------------------------------------------------ */

/** Koridor bazlı congestion — A-03 ve A-04 demo senaryosunun merkezidir. */
const AISLE_CONGESTION: Record<number, number> = {
  1: 0.34,
  2: 0.52,
  3: 0.86,
  4: 0.78,
  5: 0.44,
  6: 0.31,
  7: 0.36,
  8: 0.28,
  9: 0.33,
  10: 0.19,
  11: 0.22,
  12: 0.16,
};

/* ------------------------------------------------------------------ */
/* Lokasyon üretimi                                                    */
/* ------------------------------------------------------------------ */

/** Blokaj — fiziksel neden ile; demo boyunca sabittir. */
const BLOCKED_LOCATIONS = new Set(["B-07-04", "D-11-01"]);

/** Veri kalitesi düşük lokasyonlar (kapasite ölçüsü doğrulanmamış). */
const LOW_QUALITY_LOCATIONS = new Set([
  "C-08-04",
  "C-12-03",
  "D-10-04",
  "B-09-04",
]);

type Draft = Omit<Location, "pickTimeSec">;

function buildLocations(): Location[] {
  const drafts: Draft[] = [];

  for (const face of AISLE_FACES) {
    for (const side of ["left", "right"] as const) {
      const zone = side === "left" ? face.left : face.right;
      for (let bay = 1; bay <= BAYS_PER_FACE; bay += 1) {
        const id = formatLocationId(zone, face.aisle, bay);
        const x = faceX(face.aisle, side);
        const y = bayY(bay);
        const cx = x + MAP.rackWidth / 2;
        const cy = y + MAP.bayHeight / 2;

        // Yürüme mesafesi koridor boyunca ölçülür (Manhattan).
        const distanceToDockM =
          Math.round(
            ((Math.abs(cx - MAP.dockX) + Math.abs(cy - MAP.dockY)) /
              MAP.unitsPerMeter) *
              10,
          ) / 10;

        // Raf yüksekliği: bay 1-2 bel hizası, bay 3 alt, bay 4 üst seviye.
        const level = bay <= 2 ? 2 : bay === 3 ? 1 : 3;
        const goldenZone = level === 2;

        const congestionBase = AISLE_CONGESTION[face.aisle];
        const congestionScore =
          Math.round(
            (congestionBase + seededRange(`cong:${id}`, -0.06, 0.06, 3)) * 100,
          ) / 100;

        const picksPerDay = Math.round(
          seededRange(`picks:${id}`, 4, 26, 0) *
            (zone === "A" ? 2.4 : zone === "B" ? 1.5 : zone === "C" ? 1 : 0.6),
        );

        const replenishmentsPerDay =
          Math.round(seededRange(`repl:${id}`, 0.2, 2.6, 1) * 10) / 10;

        drafts.push({
          id,
          zone,
          aisle: face.aisle,
          bay,
          level,
          x,
          y,
          width: MAP.rackWidth,
          height: MAP.bayHeight,
          maxWeightKg: level === 3 ? 420 : 680,
          maxVolumeM3: level === 3 ? 1.1 : 1.6,
          equipment: level === 3 ? "forklift" : bay <= 2 ? "manual" : "cart",
          goldenZone,
          congestionScore,
          blocked: BLOCKED_LOCATIONS.has(id),
          blockedReason: BLOCKED_LOCATIONS.has(id)
            ? "Raf ayağı hasar kaydı açık"
            : undefined,
          distanceToDockM,
          picksPerDay,
          replenishmentsPerDay,
          dataQuality: LOW_QUALITY_LOCATIONS.has(id) ? 0.62 : 1,
        });
      }
    }
  }

  // Süre tahmini @gbsoft/domain'deki tek modelden gelir; seed, API ve solver
  // aynı formülü kullanır.
  const meanDistanceToDockM =
    drafts.reduce((sum, d) => sum + d.distanceToDockM, 0) / drafts.length;

  return drafts.map((draft) => ({
    ...draft,
    pickTimeSec: estimateLocationPickTimeSec({
      distanceToDockM: draft.distanceToDockM,
      meanDistanceToDockM,
      congestionScore: draft.congestionScore,
      goldenZone: draft.goldenZone,
    }),
  }));
}

export const LOCATIONS: Location[] = buildLocations();

export const LOCATION_BY_ID = new Map(LOCATIONS.map((l) => [l.id, l]));

/** Isı haritası skalalarının veriye uyması için gerçek aralıklar. */
function range(values: number[]) {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export const LOCATION_STATS = {
  pickTime: range(LOCATIONS.map((l) => l.pickTimeSec)),
  picks: range(LOCATIONS.map((l) => l.picksPerDay)),
  congestion: range(LOCATIONS.map((l) => l.congestionScore)),
  replenishment: range(LOCATIONS.map((l) => l.replenishmentsPerDay)),
  distance: range(LOCATIONS.map((l) => l.distanceToDockM)),
};

export function getLocation(id: string): Location | undefined {
  return LOCATION_BY_ID.get(id);
}

export const ZONE_LABELS: Record<ZoneId, string> = {
  A: "Zone A · Hızlı akış",
  B: "Zone B · Standart",
  C: "Zone C · Yavaş akış",
  D: "Zone D · Hacimli / düşük hız",
};

/**
 * Raf dışı alanlar. Cross-aisle de bir zemin alanıdır; harita bunları
 * geometriden türetmek yerine dijital ikizden okur.
 */
export const FLOOR_AREAS: FloorArea[] = [
  {
    id: "cross-aisle-1",
    label: "cross-aisle",
    kind: "cross-aisle",
    x: MAP.originX - 12,
    y: CROSS_AISLE.y,
    width: MAP.aislePitch * AISLE_COUNT,
    height: CROSS_AISLE.height,
  },
  {
    id: "dock",
    label: "Dock 1-6",
    kind: "dock",
    x: 40,
    y: 352,
    width: 260,
    height: 52,
  },
  {
    id: "staging",
    label: "Staging",
    kind: "staging",
    x: 320,
    y: 352,
    width: 300,
    height: 52,
  },
  {
    id: "packing",
    label: "Packing",
    kind: "packing",
    x: 640,
    y: 352,
    width: 312,
    height: 52,
  },
];

/** Dijital ikizin harita sözleşmesi — API ile aynı biçim. */
export const FACILITY_LAYOUT: FacilityLayout = {
  facilityCode: "MARMARA-DC-01",
  facilityName: "Marmara Dağıtım Merkezi",
  layoutVersion: 1,
  viewBox: { width: MAP.width, height: MAP.height },
  unitsPerMeter: MAP.unitsPerMeter,
  dockAnchor: { x: MAP.dockX, y: MAP.dockY },
  zones: (["A", "B", "C", "D"] as ZoneId[]).map((code) => ({
    code,
    name: ZONE_LABELS[code],
  })),
  aisles: AISLE_FACES.map((face) => ({
    number: face.aisle,
    x: MAP.originX + (face.aisle - 1) * MAP.aislePitch,
    walkwayWidth: MAP.walkwayWidth,
    congestionScore: AISLE_CONGESTION[face.aisle],
    faces: [
      {
        side: "left" as const,
        zone: face.left,
        x: faceX(face.aisle, "left"),
        width: MAP.rackWidth,
      },
      {
        side: "right" as const,
        zone: face.right,
        x: faceX(face.aisle, "right"),
        width: MAP.rackWidth,
      },
    ],
  })),
  floorAreas: FLOOR_AREAS,
};
