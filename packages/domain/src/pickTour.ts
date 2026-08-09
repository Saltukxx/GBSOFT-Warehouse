/**
 * Toplama turu süre modeli (Faz 6.5).
 *
 * Bir yükleme siparişi geldiğinde asıl soru şudur: **hangi ürün önce alınacak
 * ve bu ne kadar sürecek?** `estimateLocationPickTimeSec` bu soruya cevap
 * veremez, çünkü travel bileşenini *tesis ortalamasına* normalize eder — yani
 * her toplamanın "ortalama bir yerden" başladığını varsayar. Isı haritası için
 * doğru, tur için yanlıştır: turda önceki durak bellidir.
 *
 * Bu modül ikinci bir süre modeli **değildir**. Satır başına sabit bileşenler
 * (arama, uzanma/okutma, elleçleme, ergonomi cezası) kalibre `PickTimeModel`'den
 * aynen alınır; buraya eklenen tek şey turun kendi yapısıdır:
 *
 *   tur = hazırlık + Σ(duraklar arası travel + toplama) + dönüş + bırakma
 *
 * Duraklar arası mesafe Faz 2'nin graf mesafe matrisinden gelir. Böylece 3B'de
 * çizilen rota, panelde yazan mesafe ve buradaki süre aynı kaynaktan çıkar.
 */

import type { PickTimeModelParameters } from "./picking.js";
import { DEFAULT_PICK_TIME_PARAMETERS } from "./picking.js";
import type { Equipment } from "./warehouse.js";

/* ------------------------------------------------------------------ */
/* Parametreler                                                        */
/* ------------------------------------------------------------------ */

export type PickTourParameters = {
  /** Ekipman yürüme/sürme hızı (m/sn). */
  equipmentSpeedMps: Record<Equipment, number>;
  /** Tur başına araç hazırlığı (sn). */
  tourSetupSec: number;
  /** Dock'a bırakma — tur başına sabit (sn). */
  depositSec: number;
  /** Bırakmanın birim başına değişken kısmı (sn). */
  depositPerUnitSec: number;
};

/**
 * Kalibre edilmemiş başlangıç parametreleri.
 *
 * Hızlar saha literatüründeki tipik değerlerdir ve **ölçülmemiştir**. Turun
 * raporladığı süre, altındaki `PickTimeModel` kalibre değilse tahmindir;
 * arayüz bunu modelin kalibrasyon durumuyla birlikte gösterir.
 */
export const DEFAULT_PICK_TOUR_PARAMETERS: PickTourParameters = {
  equipmentSpeedMps: { manual: 1.2, cart: 1.0, forklift: 1.8 },
  tourSetupSec: 45,
  depositSec: 60,
  depositPerUnitSec: 1.5,
};

/* ------------------------------------------------------------------ */
/* Girdi ve çıktı                                                      */
/* ------------------------------------------------------------------ */

export type PickTourStopInput = {
  locationCode: string;
  skuCode: string;
  quantity: number;
  /** Önceki duraktan bu durağa graf mesafesi (m). İlk durakta dock'tan. */
  travelFromPreviousM: number;
  goldenZone: boolean;
  /** 0-1 arası; geçilen koridorun yoğunluğu. */
  congestionScore: number;
};

export type PickTourEstimateInput = {
  stops: PickTourStopInput[];
  /** Son duraktan dock'a dönüş mesafesi (m). */
  returnDistanceM: number;
  equipment: Equipment;
  parameters?: PickTourParameters;
  /** Kalibre pick-time parametreleri; verilmezse baseline kullanılır. */
  pickTimeParameters?: PickTimeModelParameters;
};

export type PickTourStopEstimate = {
  locationCode: string;
  skuCode: string;
  quantity: number;
  travelSec: number;
  congestionSec: number;
  pickSec: number;
  /** Turun başından bu durak bitene kadar geçen süre (sn). */
  cumulativeSec: number;
};

/**
 * Turun bileşenlerine ayrılmış süresi.
 *
 * Anahtarlar `PickTimeBreakdown` ile bilinçli olarak örtüşür; Time
 * Intelligence ekranının bileşen grafiği yeniden kullanılabilsin diye.
 */
export type PickTourEstimate = {
  totalSec: number;
  setupSec: number;
  travelSec: number;
  congestionSec: number;
  pickSec: number;
  depositSec: number;
  totalDistanceM: number;
  totalUnits: number;
  stops: PickTourStopEstimate[];
};

/* ------------------------------------------------------------------ */
/* Hesap                                                               */
/* ------------------------------------------------------------------ */

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Tek bir durakta geçen toplama süresi (travel hariç).
 *
 * Sabit bileşenler kalibre modelden gelir. `queueSec` bilerek dışarıdadır:
 * kuyruk görev başına değil **tur başına** yaşanır ve hazırlık kalemine yazılır.
 * Aynı kalemi hem tur başına hem satır başına saymak süreyi şişirirdi.
 *
 * `handleSec` turda birim başınadır; miktar 1 olduğunda satır bazlı modelin
 * elleçleme değeriyle birebir örtüşür.
 */
export function pickStopSec(
  stop: Pick<PickTourStopInput, "quantity" | "goldenZone">,
  parameters: PickTimeModelParameters = DEFAULT_PICK_TIME_PARAMETERS,
): number {
  const units = Math.max(1, stop.quantity);
  return (
    parameters.searchSec +
    parameters.reachScanSec +
    parameters.handleSec * units +
    (stop.goldenZone ? 0 : parameters.nonGoldenPenaltySec)
  );
}

/**
 * Bir toplama turunun beklenen süresi.
 *
 * Saf fonksiyondur; aynı girdi her zaman aynı süreyi verir. Solver bu modeli
 * maliyet fonksiyonu olarak kullanır, arayüz de aynısını gösterir — solver'ın
 * optimize ettiği sayı ile kullanıcının gördüğü sayı ayrışamaz.
 */
export function estimatePickTourSec(
  input: PickTourEstimateInput,
): PickTourEstimate {
  const tour = input.parameters ?? DEFAULT_PICK_TOUR_PARAMETERS;
  const pick = input.pickTimeParameters ?? DEFAULT_PICK_TIME_PARAMETERS;
  const speed = tour.equipmentSpeedMps[input.equipment];
  if (!(speed > 0)) {
    throw new Error(`Ekipman hızı tanımsız veya sıfır: ${input.equipment}`);
  }

  const setupSec = tour.tourSetupSec + pick.queueSec;

  let travelSec = 0;
  let congestionSec = 0;
  let pickSec = 0;
  let totalDistanceM = 0;
  let totalUnits = 0;
  let cumulative = setupSec;

  const stops: PickTourStopEstimate[] = input.stops.map((stop) => {
    const legTravelSec = stop.travelFromPreviousM / speed;
    const legCongestionSec =
      legTravelSec * stop.congestionScore * pick.congestionFactor;
    const legPickSec = pickStopSec(stop, pick);

    travelSec += legTravelSec;
    congestionSec += legCongestionSec;
    pickSec += legPickSec;
    totalDistanceM += stop.travelFromPreviousM;
    totalUnits += Math.max(1, stop.quantity);
    cumulative += legTravelSec + legCongestionSec + legPickSec;

    return {
      locationCode: stop.locationCode,
      skuCode: stop.skuCode,
      quantity: stop.quantity,
      travelSec: round(legTravelSec),
      congestionSec: round(legCongestionSec),
      pickSec: round(legPickSec),
      cumulativeSec: round(cumulative),
    };
  });

  // Dönüş bacağı: son duraktan dock'a. Yoğunluk katsayısı uygulanmaz —
  // dolu araçla dönüş koridor trafiğinden bağımsız bir omurga hareketidir.
  const returnSec = input.returnDistanceM / speed;
  travelSec += returnSec;
  totalDistanceM += input.returnDistanceM;

  const depositSec = tour.depositSec + tour.depositPerUnitSec * totalUnits;
  const totalSec = setupSec + travelSec + congestionSec + pickSec + depositSec;

  return {
    totalSec: round(totalSec),
    setupSec: round(setupSec),
    travelSec: round(travelSec),
    congestionSec: round(congestionSec),
    pickSec: round(pickSec),
    depositSec: round(depositSec),
    totalDistanceM: Math.round(totalDistanceM * 1_000) / 1_000,
    totalUnits,
    stops,
  };
}

/**
 * Çok turlu bir siparişin makespan'i — en geç biten turun süresi.
 *
 * "En hızlı yükleme" sorusunun cevabı toplam süre değil, budur: toplayıcılar
 * paralel çalışır, sipariş en son tur bitince hazırdır.
 */
export function tourMakespanSec(tours: Array<{ totalSec: number }>): number {
  return tours.length === 0 ? 0 : Math.max(...tours.map((tour) => tour.totalSec));
}

/* ------------------------------------------------------------------ */
/* API sözleşmesi                                                      */
/* ------------------------------------------------------------------ */

/** Tur optimizasyonu isteğinin ayarlanabilir kısmı. */
export type PickTourOptimizeOptions = {
  equipment?: Equipment;
  /** Paralel çalışan toplayıcı sayısı. */
  vehicleCount?: number;
  capacityVolumeM3?: number;
  capacityWeightKg?: number;
  /** `makespan` en geç biten turu, `total` toplam iş gücünü küçültür. */
  objective?: "makespan" | "total";
  timeLimitMs?: number;
};

export type PickOrderStatus =
  | "draft"
  | "ready"
  | "planned"
  | "released"
  | "cancelled";

export type PickOrderSummary = {
  id: string;
  code: string;
  dockCode: string | null;
  status: PickOrderStatus;
  priority: number;
  dueAt: string | null;
  lineCount: number;
  unitCount: number;
  createdAt: string;
  /** Bu sipariş için üretilmiş en son tur planı var mı? */
  hasTours: boolean;
};

export type PickOrderLineView = {
  lineNo: number;
  skuCode: string;
  skuName: string;
  quantity: number;
  uom: string;
  /** SKU'nun aktif pick gözü; yoksa satır tura giremez. */
  locationCode: string | null;
};

export type PickOrderDetail = PickOrderSummary & {
  facilityCode: string;
  lines: PickOrderLineView[];
};

export type PickTourStopView = {
  seq: number;
  locationCode: string;
  skuCode: string;
  quantity: number;
  travelSec: number;
  congestionSec: number;
  pickSec: number;
  cumulativeSec: number;
};

export type PickTourView = {
  id: string;
  seq: number;
  equipment: Equipment;
  totalDistanceM: number;
  estimatedSec: number;
  volumeUsedM3: number;
  weightUsedKg: number;
  stops: PickTourStopView[];
};

/**
 * Bir siparişin çözülmüş tur planı.
 *
 * `calibrated` alanı bilinçlidir: süreler altındaki `PickTimeModel` kalibre
 * değilse tahmindir ve arayüz bunu söylemek zorundadır.
 */
export type PickTourPlan = {
  orderId: string;
  orderCode: string;
  runId: string;
  solverVersion: string;
  /** Routing optimum kanıtlamaz; bu alan hiçbir zaman "optimal" olmaz. */
  solutionQuality: "feasible" | "none";
  makespanSec: number;
  totalSec: number;
  /** Makespan alt sınırı — optimum iddiası değil, kalite göstergesi. */
  lowerBoundSec: number;
  calibrated: boolean;
  modelVersion: string;
  tours: PickTourView[];
  /** Aktif yerleşimi olmadığı için tura giremeyen satırlar. */
  skippedLines: Array<{ lineNo: number; skuCode: string; reason: string }>;
};
