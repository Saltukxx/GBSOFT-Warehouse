import type {
  PlanVersion,
  SlotAlternative,
  SlotPlan,
  SlotRecommendation,
} from "../../domain/slotting";
import { FACILITY, VERSIONS } from "./facility";
import { getLocation } from "./layout";
import { EMPTY_PICK_LOCATIONS, SKUS, getSku } from "./skus";
import { seededRange } from "../rng";

/**
 * Slot planı SP-2026-081.
 *
 * Özet değerler §2.1 ve §13.3'te sabittir; hiçbir ekranda farklı
 * görünmemelidir. Öneri listesi 21 SKU içerir.
 */

type NamedRec = {
  skuId: string;
  from: string;
  to: string;
  sec: number;
  p90: number;
  replen: number;
  hours: number;
  reasons: string[];
  tradeoffs: string[];
  confidence: number;
  alternatives: SlotAlternative[];
};

const NAMED_RECOMMENDATIONS: NamedRec[] = [
  {
    skuId: "SKU-184",
    from: "B-11-04",
    to: "A-03-02",
    sec: -11.4,
    p90: -14.8,
    replen: 2,
    hours: 0.18,
    reasons: [
      "Sipariş hızında üst %8",
      "Birlikte toplandığı SKU'lara 14 m daha yakın",
      "Altın ergonomik bölge",
      "A-03'te kabul edilebilir congestion",
    ],
    tradeoffs: ["+2 replenishment/gün", "+0,18 forklift-saat taşıma"],
    confidence: 93,
    alternatives: [
      {
        locationId: "A-03-02",
        netSecondsDelta: -11.4,
        picking: "iyi",
        replenishmentDeltaPerDay: 2,
        congestion: "orta",
        status: "önerilen",
      },
      {
        locationId: "A-02-04",
        netSecondsDelta: -9.8,
        picking: "iyi",
        replenishmentDeltaPerDay: 1,
        congestion: "düşük",
        status: "alternatif",
        blockedReason:
          "Bu planda SKU-221 için ayrıldı; seçilirse ek boşaltma görevi gerekir.",
      },
      {
        locationId: "A-05-01",
        netSecondsDelta: -8.9,
        picking: "orta",
        replenishmentDeltaPerDay: 0,
        congestion: "düşük",
        status: "alternatif",
        blockedReason: "SKU-058 boşaltıldıktan sonra kullanılabilir.",
      },
      {
        locationId: "A-01-04",
        netSecondsDelta: -4.2,
        picking: "orta",
        replenishmentDeltaPerDay: 0,
        congestion: "düşük",
        status: "uygun değil",
        blockedReason: "Göz hacmi SKU kolisi için yetersiz (hard constraint).",
      },
    ],
  },
  {
    skuId: "SKU-074",
    from: "A-03-02",
    to: "C-09-04",
    sec: -1.8,
    p90: -2.4,
    replen: -1,
    hours: 0.22,
    reasons: [
      "Hızı A-03 altın gözünü hak etmiyor (B sınıfı, 61 pick/gün)",
      "A-03 koridorunda congestion'ı azaltıyor",
      "Kırılgan ürün için üst seviye yerine erişilebilir göz",
    ],
    tradeoffs: [
      "Bu SKU için picking süresi +1,9 sn/line artıyor",
      "Zincirin ilk görevi; A-03-02 boşalmadan SKU-184 taşınamaz",
    ],
    confidence: 90,
    alternatives: [
      {
        locationId: "C-09-04",
        netSecondsDelta: -1.8,
        picking: "orta",
        replenishmentDeltaPerDay: -1,
        congestion: "düşük",
        status: "önerilen",
      },
      {
        locationId: "C-09-02",
        netSecondsDelta: -1.1,
        picking: "orta",
        replenishmentDeltaPerDay: 0,
        congestion: "düşük",
        status: "alternatif",
      },
    ],
  },
  {
    skuId: "SKU-221",
    from: "C-08-03",
    to: "A-02-04",
    sec: -9.6,
    p90: -12.1,
    replen: 1,
    hours: 0.17,
    reasons: [
      "A sınıfı, 132 pick/gün",
      "SKU-184 ve SKU-019 ile aynı siparişte toplanıyor",
      "A-02 koridoru düşük congestion",
    ],
    tradeoffs: ["+1 replenishment/gün", "Göz doluluğu %86'ya çıkıyor"],
    confidence: 91,
    alternatives: [
      {
        locationId: "A-02-04",
        netSecondsDelta: -9.6,
        picking: "iyi",
        replenishmentDeltaPerDay: 1,
        congestion: "düşük",
        status: "önerilen",
      },
      {
        locationId: "A-01-02",
        netSecondsDelta: -8.4,
        picking: "iyi",
        replenishmentDeltaPerDay: 1,
        congestion: "düşük",
        status: "alternatif",
      },
    ],
  },
  {
    skuId: "SKU-019",
    from: "B-09-01",
    to: "A-04-02",
    sec: -8.7,
    p90: -11.2,
    replen: 1,
    hours: 0.19,
    reasons: [
      "A sınıfı, 118 pick/gün",
      "Kahvaltılık grubu tek koridorda toplanıyor",
      "Altın ergonomik bölge",
    ],
    tradeoffs: [
      "+1 replenishment/gün",
      "A-04 congestion'ı 0,78; katkısı ölçülüyor",
    ],
    confidence: 88,
    alternatives: [
      {
        locationId: "A-04-02",
        netSecondsDelta: -8.7,
        picking: "iyi",
        replenishmentDeltaPerDay: 1,
        congestion: "orta",
        status: "önerilen",
      },
      {
        locationId: "A-01-02",
        netSecondsDelta: -7.9,
        picking: "iyi",
        replenishmentDeltaPerDay: 1,
        congestion: "düşük",
        status: "alternatif",
      },
    ],
  },
  {
    skuId: "SKU-307",
    from: "A-04-02",
    to: "D-10-01",
    sec: -0.9,
    p90: -1.2,
    replen: -1,
    hours: 0.24,
    reasons: [
      "Ağır elleçleme sınıfı; forklift erişimli zon uygun",
      "A-04 altın gözünü daha hızlı SKU'ya bırakıyor",
    ],
    tradeoffs: [
      "Bu SKU için yürüyüş +6,2 m artıyor",
      "Ağır ürün taşıma görevi 0,24 forklift-saat",
    ],
    confidence: 87,
    alternatives: [
      {
        locationId: "D-10-01",
        netSecondsDelta: -0.9,
        picking: "orta",
        replenishmentDeltaPerDay: -1,
        congestion: "düşük",
        status: "önerilen",
      },
      {
        locationId: "D-10-03",
        netSecondsDelta: -0.4,
        picking: "zayıf",
        replenishmentDeltaPerDay: -1,
        congestion: "düşük",
        status: "alternatif",
      },
    ],
  },
  {
    skuId: "SKU-142",
    from: "D-12-01",
    to: "B-02-01",
    sec: -7.4,
    p90: -9.6,
    replen: 1,
    hours: 0.21,
    reasons: [
      "A sınıfı, 103 pick/gün fakat en uzak zonda",
      "Hacimli ürün; cross-aisle ağzında elleçleme kolaylaşıyor",
    ],
    tradeoffs: ["+1 replenishment/gün", "B-02 gözünde hacim marjı %9'a düşüyor"],
    confidence: 89,
    alternatives: [
      {
        locationId: "B-02-01",
        netSecondsDelta: -7.4,
        picking: "iyi",
        replenishmentDeltaPerDay: 1,
        congestion: "düşük",
        status: "önerilen",
      },
      {
        locationId: "B-03-01",
        netSecondsDelta: -6.8,
        picking: "iyi",
        replenishmentDeltaPerDay: 1,
        congestion: "düşük",
        status: "alternatif",
      },
    ],
  },
  {
    skuId: "SKU-058",
    from: "A-05-01",
    to: "C-07-03",
    sec: -0.6,
    p90: -0.8,
    replen: 0,
    hours: 0.17,
    reasons: [
      "B sınıfı; A-05 altın gözü daha hızlı SKU'ya açılıyor",
      "Kırılgan ürün için alt seviye göz",
    ],
    tradeoffs: ["Bu SKU için picking +2,1 sn/line"],
    confidence: 86,
    alternatives: [
      {
        locationId: "C-07-03",
        netSecondsDelta: -0.6,
        picking: "orta",
        replenishmentDeltaPerDay: 0,
        congestion: "düşük",
        status: "önerilen",
      },
    ],
  },
  {
    skuId: "SKU-233",
    from: "B-06-02",
    to: "A-05-01",
    sec: -8.1,
    p90: -10.4,
    replen: 1,
    hours: 0.16,
    reasons: [
      "A sınıfı, 111 pick/gün",
      "SKU-058 ve SKU-165 ile birlikte toplanıyor",
      "Altın ergonomik bölge",
    ],
    tradeoffs: ["+1 replenishment/gün", "SKU-058 boşaltmasına bağımlı"],
    confidence: 90,
    alternatives: [
      {
        locationId: "A-05-01",
        netSecondsDelta: -8.1,
        picking: "iyi",
        replenishmentDeltaPerDay: 1,
        congestion: "düşük",
        status: "önerilen",
      },
      {
        locationId: "B-05-04",
        netSecondsDelta: -5.2,
        picking: "orta",
        replenishmentDeltaPerDay: 0,
        congestion: "düşük",
        status: "alternatif",
      },
    ],
  },
  {
    skuId: "SKU-165",
    from: "C-06-01",
    to: "A-02-01",
    sec: -8.9,
    p90: -11.4,
    replen: 2,
    hours: 0.15,
    reasons: [
      "A sınıfı, 127 pick/gün",
      "Dock'a 41 m daha yakın",
      "Boş göz; boşaltma görevi gerekmiyor",
    ],
    tradeoffs: ["+2 replenishment/gün"],
    confidence: 92,
    alternatives: [
      {
        locationId: "A-02-01",
        netSecondsDelta: -8.9,
        picking: "iyi",
        replenishmentDeltaPerDay: 2,
        congestion: "düşük",
        status: "önerilen",
      },
      {
        locationId: "A-01-04",
        netSecondsDelta: -6.1,
        picking: "orta",
        replenishmentDeltaPerDay: 1,
        congestion: "düşük",
        status: "alternatif",
      },
    ],
  },
];

/**
 * Kalan 12 öneri veriden türetilir: dock'a uzak, yüksek hızlı SKU'lar
 * boşta duran veya boşalacak gözlere taşınır.
 */
const GENERIC_TARGETS = [
  "B-03-01",
  "B-04-03",
  "B-05-04",
  "C-08-01",
  "C-09-02",
  "C-12-02",
  "D-10-03",
  "D-11-03",
  "B-06-02",
  "C-06-01",
  "B-09-01",
  "D-12-01",
];

function buildGenericRecommendations(): SlotRecommendation[] {
  const namedIds = new Set(NAMED_RECOMMENDATIONS.map((r) => r.skuId));
  const namedTargets = new Set(NAMED_RECOMMENDATIONS.map((r) => r.to));

  const candidates = SKUS.filter((sku) => {
    if (namedIds.has(sku.id)) return false;
    if (EMPTY_PICK_LOCATIONS.has(sku.currentLocationId)) return false;
    const loc = getLocation(sku.currentLocationId);
    if (!loc) return false;
    if (namedTargets.has(loc.id)) return false;
    // Zone A'daki bütün değişiklikler adı geçen zincirlerde toplanır; böylece
    // "Zone A görevleri" kısmi onayı bütün A lokasyonlarını kapsar.
    if (loc.zone === "A") return false;
    return sku.velocityClass !== "C" && loc.distanceToDockM > 60;
  })
    .slice()
    .sort((a, b) => b.picksPerDay - a.picksPerDay || a.id.localeCompare(b.id))
    .slice(0, GENERIC_TARGETS.length);

  return candidates.map((sku, index) => {
    const targetId = GENERIC_TARGETS[index];
    const source = getLocation(sku.currentLocationId);
    const target = getLocation(targetId);
    const savedMeters =
      source && target
        ? Math.round((source.distanceToDockM - target.distanceToDockM) * 10) / 10
        : 0;
    const sec = -Math.round((1.2 + Math.abs(savedMeters) * 0.055) * 10) / 10;
    const replen = savedMeters > 40 ? 1 : 0;

    const reasons = [
      `${sku.velocityClass} sınıfı, ${sku.picksPerDay} pick/gün`,
      savedMeters > 0
        ? `Dock'a ${savedMeters.toFixed(1)} m daha yakın`
        : "Koridor yoğunluğu daha düşük",
      target?.goldenZone
        ? "Altın ergonomik bölge"
        : "Ekipman sınıfı ürüne uygun",
    ];

    const tradeoffs = [
      replen > 0 ? `+${replen} replenishment/gün` : "Replenishment değişmiyor",
      `+${seededRange(`mh:${sku.id}`, 0.15, 0.22, 2).toFixed(2)} forklift-saat taşıma`,
    ];

    const alternatives: SlotAlternative[] = [
      {
        locationId: targetId,
        netSecondsDelta: sec,
        picking: "iyi",
        replenishmentDeltaPerDay: replen,
        congestion:
          (target?.congestionScore ?? 0) > 0.7
            ? "yüksek"
            : (target?.congestionScore ?? 0) > 0.45
              ? "orta"
              : "düşük",
        status: "önerilen",
      },
    ];

    return {
      skuId: sku.id,
      sourceLocationId: sku.currentLocationId,
      targetLocationId: targetId,
      expectedSecondsPerLineDelta: sec,
      p90SecondsPerLineDelta: Math.round(sec * 1.28 * 10) / 10,
      replenishmentDeltaPerDay: replen,
      moveHours: seededRange(`mh:${sku.id}`, 0.15, 0.22, 2),
      reasons,
      tradeoffs,
      hardConstraintsPassed: true,
      status: "recommended",
      alternatives,
      confidencePct: Math.round(seededRange(`conf:${sku.id}`, 82, 94, 0)),
    } satisfies SlotRecommendation;
  });
}

export const RECOMMENDATIONS: SlotRecommendation[] = [
  ...NAMED_RECOMMENDATIONS.map(
    (r): SlotRecommendation => ({
      skuId: r.skuId,
      sourceLocationId: r.from,
      targetLocationId: r.to,
      expectedSecondsPerLineDelta: r.sec,
      p90SecondsPerLineDelta: r.p90,
      replenishmentDeltaPerDay: r.replen,
      moveHours: r.hours,
      reasons: r.reasons,
      tradeoffs: r.tradeoffs,
      hardConstraintsPassed: true,
      status: "recommended",
      alternatives: r.alternatives,
      confidencePct: r.confidence,
    }),
  ),
  ...buildGenericRecommendations(),
];

export const RECOMMENDATION_BY_SKU = new Map(
  RECOMMENDATIONS.map((r) => [r.skuId, r]),
);

/** Kaynak veya hedef olarak plana giren lokasyonlar. */
export const RECOMMENDATION_BY_LOCATION = new Map<string, SlotRecommendation>();
for (const rec of RECOMMENDATIONS) {
  RECOMMENDATION_BY_LOCATION.set(rec.sourceLocationId, rec);
  RECOMMENDATION_BY_LOCATION.set(rec.targetLocationId, rec);
}

/* ------------------------------------------------------------------ */
/* Plan sürümleri                                                      */
/* ------------------------------------------------------------------ */

export const DEMO_SLOT_PLAN: SlotPlan = {
  id: "SP-2026-081",
  facilityId: FACILITY.id,
  snapshotAt: FACILITY.snapshotAt,
  solverVersion: VERSIONS.solver,
  modelVersion: VERSIONS.model,
  objectiveProfile: "balanced",
  netOperationDeltaPct: -7.6,
  pickingTimeDeltaPct: -9.8,
  walkingDeltaPct: -12.4,
  replenishmentDeltaPct: 3.1,
  moveTaskCount: 26,
  moveHours: 4.3,
  affectedSkuCount: 21,
  hardViolationCount: 0,
  recommendations: RECOMMENDATIONS,
  runId: "RUN-9451",
  solveDurationMs: 2140,
  status: "feasible",
  createdAt: "2026-08-08T14:36:00+03:00",
  createdBy: "Otomatik çalıştırma · vardiya 2",
};

/** SKU-184 hedefi kilitlendiğinde üretilen plan (§13.4, §8.8). */
export const LOCKED_REOPTIMIZED_PLAN: SlotPlan = {
  ...DEMO_SLOT_PLAN,
  id: "SP-2026-081-R1",
  basePlanId: DEMO_SLOT_PLAN.id,
  netOperationDeltaPct: -7.2,
  pickingTimeDeltaPct: -9.4,
  walkingDeltaPct: -11.9,
  replenishmentDeltaPct: 2.8,
  moveTaskCount: 24,
  moveHours: 3.9,
  runId: "RUN-9482",
  solveDurationMs: 1780,
  createdAt: "2026-08-08T14:48:00+03:00",
  createdBy: "Ayşe Yılmaz · kilitli atama",
  recommendations: RECOMMENDATIONS.map((rec) =>
    rec.skuId === "SKU-184" ? { ...rec, status: "locked" } : rec,
  ),
};

export const PLAN_VERSIONS: PlanVersion[] = [
  {
    id: "SP-2026-079",
    createdAt: "07.08.2026 09:12",
    createdBy: "Otomatik çalıştırma · vardiya 1",
    netOperationDeltaPct: -5.9,
    moveTaskCount: 19,
    note: "Uygulandı; A zonu kısmi. Ölçülen etki -5,4%.",
    state: "arşiv",
  },
  {
    id: "SP-2026-080",
    createdAt: "07.08.2026 17:40",
    createdBy: "Mert Aydın · planlama",
    netOperationDeltaPct: -6.4,
    moveTaskCount: 22,
    note: "Yayınlanmadı; move budget aşıldığı için geri alındı.",
    state: "arşiv",
  },
  {
    id: "SP-2026-081",
    createdAt: "08.08.2026 14:36",
    createdBy: "Otomatik çalıştırma · vardiya 2",
    netOperationDeltaPct: -7.6,
    moveTaskCount: 26,
    note: "Onay bekliyor.",
    state: "aktif",
  },
];

export function getRecommendation(skuId: string) {
  return RECOMMENDATION_BY_SKU.get(skuId);
}

export function recommendationSkuName(skuId: string) {
  return getSku(skuId)?.name ?? skuId;
}
