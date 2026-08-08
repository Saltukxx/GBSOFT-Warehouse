/** Depo dijital ikizi — mekân ve ürün varlıkları (Şartname §13.1). */

export type ZoneId = "A" | "B" | "C" | "D";

export type Equipment = "manual" | "cart" | "forklift";

export type Location = {
  id: string;
  zone: ZoneId;
  /** Koridor numarası 1-12. */
  aisle: number;
  /** Koridor içindeki göz sırası 1-4. */
  bay: number;
  level: number;
  /** Harita koordinatları (SVG kullanıcı birimi). */
  x: number;
  y: number;
  width: number;
  height: number;
  maxWeightKg: number;
  maxVolumeM3: number;
  equipment: Equipment;
  goldenZone: boolean;
  /** 0-1 arası koridor yoğunluk skoru. */
  congestionScore: number;
  locked: boolean;
  blocked: boolean;
  /** Dock'a graf üzerinden yürüme mesafesi (m). */
  distanceToDockM: number;
  /** Katman verileri — heatmap için. */
  pickTimeSec: number;
  picksPerDay: number;
  replenishmentsPerDay: number;
  dataQuality: number;
};

export type VelocityClass = "A" | "B" | "C";

export type SKU = {
  id: string;
  name: string;
  category: string;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  weightKg: number | null;
  velocityClass: VelocityClass;
  picksPerDay: number;
  unitsPerPick: number;
  replenishmentsPerDay: number;
  currentLocationId: string;
  affinitySkuIds: string[];
  handling: "standard" | "fragile" | "heavy";
};

export type Facility = {
  id: string;
  name: string;
  city: string;
  zoneCount: number;
  aisleCount: number;
  locationCount: number;
  skuCount: number;
  openWaveCount: number;
  dailyOrderLines: number;
  snapshotAt: string;
  shift: string;
};

/** Koridorun iki raf yüzü vardır; her yüz bir zona aittir. */
export type AisleFaces = { aisle: number; left: ZoneId; right: ZoneId };

export function formatLocationId(zone: ZoneId, aisle: number, bay: number) {
  return `${zone}-${String(aisle).padStart(2, "0")}-${String(bay).padStart(
    2,
    "0",
  )}`;
}

export function parseZone(locationId: string): ZoneId {
  return locationId.charAt(0) as ZoneId;
}
