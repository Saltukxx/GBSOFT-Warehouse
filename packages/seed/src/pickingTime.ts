import type { PickTimeBreakdown, PickTimeVarianceRow } from "@gbsoft/domain";

/**
 * Picking süresi bileşenleri.
 *
 * P50 71,4 sn/line ve P90 94,2 sn/line değerleri §7.3'te sabittir; bileşen
 * toplamı P50'ye eşittir.
 */
export const PLAN_BREAKDOWN: PickTimeBreakdown = {
  queueSec: 4.2,
  travelSec: 26.1,
  searchSec: 8.2,
  reachScanSec: 10.7,
  handleSec: 14.0,
  congestionSec: 5.8,
  exceptionSec: 2.4,
  p50Sec: 71.4,
  p90Sec: 94.2,
};

/** Son vardiyada gerçekleşen değerler. */
export const ACTUAL_BREAKDOWN: PickTimeBreakdown = {
  queueSec: 4.9,
  travelSec: 31.8,
  searchSec: 10.4,
  reachScanSec: 11.1,
  handleSec: 14.3,
  congestionSec: 9.1,
  exceptionSec: 4.4,
  p50Sec: 86.0,
  p90Sec: 118.7,
};

export type VarianceRow = PickTimeVarianceRow;

/** Beklenen / gerçekleşen tablosu — §7.4. */
export const VARIANCE_ROWS: VarianceRow[] = [
  {
    key: "travel",
    component: "Travel",
    expected: 26.1,
    actual: 31.8,
    delta: 5.7,
    rootCause: "A-03 yoğunluğu",
    causeTone: "attention",
  },
  {
    key: "search",
    component: "Search",
    expected: 8.2,
    actual: 10.4,
    delta: 2.2,
    rootCause: "Görsel benzer SKU",
    causeTone: "attention",
  },
  {
    key: "reachScan",
    component: "Reach/Scan",
    expected: 10.7,
    actual: 11.1,
    delta: 0.4,
    rootCause: "Normal",
    causeTone: "normal",
  },
  {
    key: "handle",
    component: "Handle",
    expected: 14.0,
    actual: 14.3,
    delta: 0.3,
    rootCause: "Normal",
    causeTone: "normal",
  },
  {
    key: "congestion",
    component: "Congestion",
    expected: 5.8,
    actual: 9.1,
    delta: 3.3,
    rootCause: "Replenishment çakışması",
    causeTone: "attention",
  },
];

/** Model kalite paneli — "AI confidence" değil, somut ölçüler (§7.5). */
export const MODEL_QUALITY = {
  p50Calibration: "iyi",
  p50CalibrationDetail: "Son 14 vardiyada ortalama sapma +1,8 sn",
  p90CoveragePct: 89,
  p90CoverageDetail: "Hedef aralık %88-92",
  dataCompletenessPct: 94,
  modelVersion: "pick-time-1.4.2",
  updatedAt: "13:40",
  trainingWindow: "01.06.2026 - 07.08.2026",
  sampleLines: 412_000,
};

/**
 * Travel bileşeni seçildiğinde gösterilen route karşılaştırması (§7.6).
 * Segment listesi haritada da vurgulanır.
 */
export const TRAVEL_ROUTE_SEGMENTS = [
  {
    id: "seg-1",
    label: "Dock → A-02",
    baselineSec: 6.2,
    actualSec: 6.4,
    congested: false,
  },
  {
    id: "seg-2",
    label: "A-02 → A-03",
    baselineSec: 4.8,
    actualSec: 8.9,
    congested: true,
  },
  {
    id: "seg-3",
    label: "A-03 → A-04",
    baselineSec: 5.1,
    actualSec: 9.2,
    congested: true,
  },
  {
    id: "seg-4",
    label: "A-04 → cross-aisle",
    baselineSec: 4.4,
    actualSec: 4.6,
    congested: false,
  },
  {
    id: "seg-5",
    label: "cross-aisle → packing",
    baselineSec: 5.6,
    actualSec: 2.7,
    congested: false,
  },
];

/** Congestion görülen koridorlar — haritada kırmızı çizilir. */
export const CONGESTED_AISLES = [3, 4];
