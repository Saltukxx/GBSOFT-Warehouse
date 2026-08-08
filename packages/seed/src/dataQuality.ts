import { MISSING_DIMENSION_SKUS, getSku } from "./skus.js";

/** Veri kalitesi ekranı (§10). Coverage bar + problem listesi; donut yok. */

export type CoverageRow = {
  key: string;
  label: string;
  valuePct: number;
  threshold: number;
  context: string;
};

export const READINESS_PCT = 94;

export const COVERAGE: CoverageRow[] = [
  {
    key: "sku-physical",
    label: "SKU fiziksel veri",
    valuePct: 97,
    threshold: 98,
    context: "184 SKU · genişlik, derinlik, yükseklik, ağırlık",
  },
  {
    key: "location-capacity",
    label: "Lokasyon kapasitesi",
    valuePct: 100,
    threshold: 98,
    context: "96 pick gözü · hacim ve ağırlık limiti",
  },
  {
    key: "event-completeness",
    label: "Event completeness",
    valuePct: 92,
    threshold: 95,
    context: "Son 14 gün · TASK_STARTED / TASK_COMPLETED çiftleri",
  },
  {
    key: "graph-coverage",
    label: "Graph coverage",
    valuePct: 100,
    threshold: 100,
    context: "Traversable alan · tek yön ve blokaj dahil",
  },
  {
    key: "identity",
    label: "Kimlik eşleme",
    valuePct: 99.6,
    threshold: 99,
    context: "WMS ID ↔ GTIN/SSCC · 184 SKU, 96 lokasyon",
  },
];

export type QualityIssue = {
  id: string;
  priority: "Kritik" | "Yüksek" | "Orta";
  problem: string;
  affectedLabel: string;
  affectedIds: string[];
  impact: string;
  action: string;
  owner: string;
  detail: string;
};

export const QUALITY_ISSUES: QualityIssue[] = [
  {
    id: "DQ-118",
    priority: "Kritik",
    problem: "SKU ölçüsü eksik",
    affectedLabel: "6 SKU",
    affectedIds: MISSING_DIMENSION_SKUS,
    impact: "write-back blok",
    action: "Ölçüm görevi",
    owner: "Depo · master data",
    detail:
      "Kapasite kısıtı doğrulanamadığı için bu SKU'lar slot planına alınmıyor ve WMS write-back'i bloklanıyor.",
  },
  {
    id: "DQ-114",
    priority: "Yüksek",
    problem: "Duplicate TASK_COMPLETED",
    affectedLabel: "18 olay",
    affectedIds: ["W-2261", "W-2264", "W-2266"],
    impact: "label kalitesi",
    action: "Yeniden işle",
    owner: "Veri platformu",
    detail:
      "Aynı görev için iki tamamlanma olayı geldi. Süre etiketleri model eğitiminden çıkarıldı; ingest dedup kuralı güncellenmeli.",
  },
  {
    id: "DQ-109",
    priority: "Orta",
    problem: "Scanner saat sapması",
    affectedLabel: "2 cihaz",
    affectedIds: ["SCN-1142", "SCN-1188"],
    impact: "süre etiketi",
    action: "Cihaz kontrolü",
    owner: "Saha IT",
    detail:
      "İki el terminalinin saati NTP ile senkron değil. Event time ile ingest time farkı 40 sn üzerinde.",
  },
];

export function missingDimensionRows() {
  return MISSING_DIMENSION_SKUS.map((id) => {
    const sku = getSku(id);
    return {
      id,
      name: sku?.name ?? "-",
      category: sku?.category ?? "-",
      missing: ["Genişlik", "Derinlik", "Yükseklik", "Ağırlık"],
      picksPerDay: sku?.picksPerDay ?? 0,
      location: sku?.currentLocationId ?? "-",
    };
  });
}

/** Kaynak sistem sağlığı — entegrasyon bağlamı. */
export const SOURCE_HEALTH = [
  {
    source: "WMS · Sipariş ve stok",
    mode: "REST · 5 dk",
    lastSync: "14:30",
    completenessPct: 99.2,
    state: "sağlıklı" as const,
  },
  {
    source: "WMS · Görev olayları",
    mode: "Webhook",
    lastSync: "14:32",
    completenessPct: 92.0,
    state: "uyarı" as const,
  },
  {
    source: "Master data · SKU ölçü",
    mode: "SFTP · günlük",
    lastSync: "06:15",
    completenessPct: 96.7,
    state: "uyarı" as const,
  },
  {
    source: "Twin · Layout ve graph",
    mode: "Manuel sürüm",
    lastSync: "05.08.2026",
    completenessPct: 100,
    state: "sağlıklı" as const,
  },
];
