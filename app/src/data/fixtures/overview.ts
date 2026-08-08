import type { ZoneId } from "../../domain/warehouse";

/** Operasyon genel bakış ekranının verisi (§6). */

export type ExceptionItem = {
  rank: number;
  id: string;
  type: string;
  impact: string;
  impactDetail: string;
  confidencePct: number;
  suggestedAction: string;
  /** Drawer içeriği. */
  summary: string;
  affectedWaves: string[];
  componentImpact: Array<{ label: string; deltaSec: number }>;
  linkTo: "time" | "slotting" | "data-quality";
};

export const EXCEPTIONS: ExceptionItem[] = [
  {
    rank: 1,
    id: "EXC-4471",
    type: "A-03 congestion",
    impact: "P90 tamamlanma riski +18 dk",
    impactDetail: "6 wave · SLA 18:00",
    confidencePct: 91,
    suggestedAction: "Slotting fırsatlarını incele",
    summary:
      "A-03 ve A-04 koridorlarında picking ve replenishment görevleri aynı saat diliminde çakışıyor. Travel ve congestion bileşenleri plan üstünde.",
    affectedWaves: ["W-2261", "W-2264", "W-2265", "W-2268", "W-2270", "W-2273"],
    componentImpact: [
      { label: "Travel", deltaSec: 5.7 },
      { label: "Congestion", deltaSec: 3.3 },
      { label: "Queue", deltaSec: 0.7 },
    ],
    linkTo: "time",
  },
  {
    rank: 2,
    id: "EXC-4468",
    type: "6 SKU'da eksik ölçü verisi",
    impact: "Slot planı write-back'i bloklu",
    impactDetail: "6 SKU · 41 açık order line",
    confidencePct: 100,
    suggestedAction: "Ölçüm görevi oluştur",
    summary:
      "Altı SKU için genişlik/derinlik/ağırlık alanları boş. Kapasite kısıtı doğrulanamadığı için bu SKU'lar plana alınmıyor.",
    affectedWaves: ["W-2264", "W-2271"],
    componentImpact: [{ label: "Exception", deltaSec: 1.9 }],
    linkTo: "data-quality",
  },
  {
    rank: 3,
    id: "EXC-4465",
    type: "17 SKU yanlış hız/kapasite sınıfında",
    impact: "Tahmini picking kaybı 4,1 sn/line",
    impactDetail: "Zone B ve C · süreklilik gösteriyor",
    confidencePct: 87,
    suggestedAction: "Slotting Studio'da aç",
    summary:
      "A sınıfı 17 SKU, hız sınıfına uymayan uzak veya üst seviye gözlerde duruyor. Slot planı bunların 12'sini kapsıyor.",
    affectedWaves: ["W-2259", "W-2262", "W-2269"],
    componentImpact: [
      { label: "Travel", deltaSec: 2.8 },
      { label: "Reach/Scan", deltaSec: 1.3 },
    ],
    linkTo: "slotting",
  },
  {
    rank: 4,
    id: "EXC-4462",
    type: "B-07-04 gözü bloklu",
    impact: "Replenishment yönlendirmesi manuel",
    impactDetail: "1 lokasyon · bakım kaydı açık",
    confidencePct: 100,
    suggestedAction: "Bakım kaydını görüntüle",
    summary:
      "Raf ayağı hasar kaydı nedeniyle göz picking'e kapalı. Solver bu gözü aday kümeden çıkarıyor.",
    affectedWaves: [],
    componentImpact: [],
    linkTo: "slotting",
  },
  {
    rank: 5,
    id: "EXC-4459",
    type: "Scanner saat sapması",
    impact: "Süre etiketlerinde güven düşük",
    impactDetail: "2 cihaz · 18 olay",
    confidencePct: 96,
    suggestedAction: "Cihaz kontrolü planla",
    summary:
      "İki el terminalinin saati NTP ile senkron değil. Bu cihazlardan gelen görev süreleri model eğitiminden çıkarıldı.",
    affectedWaves: ["W-2266"],
    componentImpact: [],
    linkTo: "data-quality",
  },
];

export type ZoneWorkload = {
  zone: ZoneId;
  label: string;
  openLines: number;
  activeTasks: number;
  pickersAssigned: number;
  loadIndexPct: number;
  congestionScore: number;
};

export const ZONE_WORKLOAD: ZoneWorkload[] = [
  {
    zone: "A",
    label: "Zone A",
    openLines: 986,
    activeTasks: 164,
    pickersAssigned: 9,
    loadIndexPct: 118,
    congestionScore: 0.74,
  },
  {
    zone: "B",
    label: "Zone B",
    openLines: 842,
    activeTasks: 131,
    pickersAssigned: 8,
    loadIndexPct: 96,
    congestionScore: 0.36,
  },
  {
    zone: "C",
    label: "Zone C",
    openLines: 641,
    activeTasks: 98,
    pickersAssigned: 6,
    loadIndexPct: 88,
    congestionScore: 0.32,
  },
  {
    zone: "D",
    label: "Zone D",
    openLines: 371,
    activeTasks: 45,
    pickersAssigned: 3,
    loadIndexPct: 71,
    congestionScore: 0.19,
  },
];

/**
 * Picking tamamlanma eğrisi (§6.4).
 * Gerçekleşen seri 14:32'ye kadar doludur; sonrası P50/P90 tahminidir.
 */
export type CompletionPoint = {
  hour: number;
  label: string;
  actual: number | null;
  p50: number;
  p90Low: number;
  p90High: number;
};

const RAW_SERIES: Array<[number, number | null, number, number, number]> = [
  // saat, gerçekleşen, p50, p90 alt, p90 üst
  [8, 0, 0, 0, 0],
  [9, 214, 220, 196, 244],
  [10, 452, 470, 424, 516],
  [11, 706, 738, 668, 808],
  [12, 913, 968, 878, 1058],
  [13, 1096, 1188, 1078, 1298],
  [14, 1348, 1442, 1310, 1574],
  [15, null, 1704, 1538, 1870],
  [16, null, 1978, 1772, 2184],
  [17, null, 2264, 2010, 2518],
  [18, null, 2548, 2236, 2860],
  [19, null, 2762, 2418, 3106],
  [20, null, 2840, 2510, 3170],
];

export const COMPLETION_SERIES: CompletionPoint[] = RAW_SERIES.map(
  ([hour, actual, p50, low, high]) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    actual,
    p50,
    p90Low: low,
    p90High: high,
  }),
);

/** Şu anki veri kesme saati; grafik burada gerçekleşenden tahmine geçer. */
export const NOW_HOUR = 14.53;

/** SLA cut-off — kırmızı ince dikey çizgi. */
export const SLA_CUTOFF_HOUR = 18;

export const SLA_TARGET_LINES = 2548;

export const OVERVIEW_KPIS = {
  waveRiskCount: 6,
  waveTotal: 38,
  pickingVarianceSecPerLine: 14.6,
  activeTasks: 438,
  dataConfidencePct: 94,
};
