/** Picking süresi bileşenleri ve tahmin modeli (Şartname §13.1, §14.1). */

export type PickTimeBreakdown = {
  queueSec: number;
  travelSec: number;
  searchSec: number;
  reachScanSec: number;
  handleSec: number;
  congestionSec: number;
  exceptionSec: number;
  p50Sec: number;
  p90Sec: number;
};

export type ComponentKey =
  | "queue"
  | "travel"
  | "search"
  | "reachScan"
  | "handle"
  | "congestion"
  | "exception";

export type ComponentMeta = {
  key: ComponentKey;
  label: string;
  color: string;
  /** Bileşenin ne ölçtüğünü açıklayan kısa metin. */
  definition: string;
};

/** Renk sırası şartname §7.3'te sabittir. */
export const PICK_TIME_COMPONENTS: ComponentMeta[] = [
  {
    key: "queue",
    label: "Queue",
    color: "var(--purple-700)",
    definition: "Görev atanana kadar geçen bekleme ve ekipman kuyruğu.",
  },
  {
    key: "travel",
    label: "Travel",
    color: "var(--blue-600)",
    definition: "Graf üzerinde önceki lokasyondan hedefe yürüme süresi.",
  },
  {
    key: "search",
    label: "Search",
    color: "var(--teal-600)",
    definition: "Gözde doğru SKU ve lotu bulma süresi.",
  },
  {
    key: "reachScan",
    label: "Reach/Scan",
    color: "var(--green-700)",
    definition: "Uzanma, kavrama ve barkod/SSCC okutma süresi.",
  },
  {
    key: "handle",
    label: "Handle",
    color: "var(--amber-700)",
    definition: "Ürünü toplama kabına/palete yerleştirme süresi.",
  },
  {
    key: "congestion",
    label: "Congestion",
    color: "var(--red-700)",
    definition: "Koridorda başka görev veya replenishment nedeniyle kayıp.",
  },
  {
    key: "exception",
    label: "Exception",
    color: "var(--ink-950)",
    definition: "Eksik stok, hasar, yanlış lokasyon gibi istisna çözümü.",
  },
];

export const COMPONENT_FIELD: Record<ComponentKey, keyof PickTimeBreakdown> = {
  queue: "queueSec",
  travel: "travelSec",
  search: "searchSec",
  reachScan: "reachScanSec",
  handle: "handleSec",
  congestion: "congestionSec",
  exception: "exceptionSec",
};

/* ------------------------------------------------------------------ */
/* Lokasyon bazlı süre tahmini                                          */
/* ------------------------------------------------------------------ */

/**
 * Süre modelinin parametreleri. Tesis bazlı, versiyonlu ve API'den okunur;
 * koda gömülmez.
 */
export type PickTimeModelParameters = {
  /** Yürüme dışındaki sabit bileşenler. */
  queueSec: number;
  searchSec: number;
  reachScanSec: number;
  handleSec: number;
  /** Tesis ortalamasındaki travel bileşeni; mesafe buna göre normalize edilir. */
  meanTravelSec: number;
  /** Congestion skorunun travel süresine katsayısı. */
  congestionFactor: number;
  /** Altın bölge dışındaki gözlerde ek uzanma/merdiven süresi. */
  nonGoldenPenaltySec: number;
  /** P90 = P50 × multiplier + offset. */
  p90Multiplier: number;
  p90OffsetSec: number;
};

/**
 * Kalibre edilmemiş başlangıç parametreleri.
 *
 * Sabit bileşenlerin toplamı ve ortalama travel değeri tesis P50'siyle
 * tutarlıdır. Gerçek olay verisi geldiğinde bu değerler quantile regression
 * ile değiştirilir; o ana kadar model `calibrated: false` raporlanır.
 */
export const DEFAULT_PICK_TIME_PARAMETERS: PickTimeModelParameters = {
  queueSec: 4.2,
  searchSec: 8.2,
  reachScanSec: 10.7,
  handleSec: 14.0,
  meanTravelSec: 26.1,
  congestionFactor: 0.55,
  nonGoldenPenaltySec: 3.4,
  p90Multiplier: 1.28,
  p90OffsetSec: 2.8,
};

/**
 * Tek bir gözden toplama süresi (sn/line).
 *
 * Travel bileşeni tesis ortalamasına göre normalize edilir; böylece lokasyon
 * sürelerinin ortalaması tesis P50'si ile örtüşür ve ısı haritası ile süre
 * analizi aynı modeli anlatır.
 */
export function estimateLocationPickTimeSec(input: {
  distanceToDockM: number;
  meanDistanceToDockM: number;
  congestionScore: number;
  goldenZone: boolean;
  parameters?: PickTimeModelParameters;
}): number {
  const p = input.parameters ?? DEFAULT_PICK_TIME_PARAMETERS;
  const ratio =
    input.meanDistanceToDockM > 0
      ? input.distanceToDockM / input.meanDistanceToDockM
      : 1;

  const travelSec = p.meanTravelSec * ratio;
  const congestionSec = travelSec * input.congestionScore * p.congestionFactor;
  const fixedSec = p.queueSec + p.searchSec + p.reachScanSec + p.handleSec;
  const ergonomicsSec = input.goldenZone ? 0 : p.nonGoldenPenaltySec;

  return (
    Math.round((fixedSec + travelSec + congestionSec + ergonomicsSec) * 10) / 10
  );
}

/**
 * Picking süresi tahmini (§14.1). Demo deterministiktir; gerçek WMS verisi
 * bağlandığında kalibre edilir.
 */
export function calculatePickTime(input: {
  graphDistanceM: number;
  nominalSpeedMps: number;
  searchBaseSec: number;
  reachScanBaseSec: number;
  handleBaseSec: number;
  congestionScore: number;
  exceptionProbability: number;
}) {
  const travelSec = input.graphDistanceM / input.nominalSpeedMps;
  const congestionSec = travelSec * input.congestionScore * 0.22;
  const exceptionSec = input.exceptionProbability * 18;

  const p50Sec =
    travelSec +
    input.searchBaseSec +
    input.reachScanBaseSec +
    input.handleBaseSec +
    congestionSec +
    exceptionSec;

  const p90Sec = p50Sec * 1.28 + 2.8;

  return { travelSec, congestionSec, exceptionSec, p50Sec, p90Sec };
}
