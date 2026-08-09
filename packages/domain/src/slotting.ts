/** Slot planı, öneri ve taşıma görevi tipleri (Şartname §13.1, §9). */

import type { ZoneId } from "./warehouse.js";

export type RecommendationStatus =
  | "recommended"
  | "alternative"
  | "excluded"
  | "locked";

export type SlotRecommendation = {
  skuId: string;
  sourceLocationId: string;
  targetLocationId: string;
  expectedSecondsPerLineDelta: number;
  p90SecondsPerLineDelta: number;
  replenishmentDeltaPerDay: number;
  moveHours: number;
  reasons: string[];
  tradeoffs: string[];
  hardConstraintsPassed: boolean;
  status: RecommendationStatus;
  /** Alternatif lokasyon tablosu (§8.6). */
  alternatives: SlotAlternative[];
  /** Öneri güveni; veri tamlığı ve model kalibrasyonundan türetilir. */
  confidencePct: number;
};

export type SlotAlternative = {
  locationId: string;
  netSecondsDelta: number;
  picking: "iyi" | "orta" | "zayıf";
  replenishmentDeltaPerDay: number;
  congestion: "düşük" | "orta" | "yüksek";
  status: "önerilen" | "alternatif" | "uygun değil";
  /** Uygun değilse nedeni. */
  blockedReason?: string;
};

export type ObjectiveProfile = "balanced" | "picking" | "low-move" | "peak";

export type SlotPlan = {
  id: string;
  facilityId: string;
  snapshotAt: string;
  solverVersion: string;
  modelVersion: string;
  objectiveProfile: ObjectiveProfile;
  netOperationDeltaPct: number;
  pickingTimeDeltaPct: number;
  walkingDeltaPct: number;
  replenishmentDeltaPct: number;
  moveTaskCount: number;
  moveHours: number;
  affectedSkuCount: number;
  hardViolationCount: number;
  recommendations: SlotRecommendation[];
  /** Solver çalışma bilgisi — açıklanabilirlik için. */
  runId: string;
  solveDurationMs: number;
  status: "feasible" | "infeasible";
  /** Bu planın türetildiği plan. */
  basePlanId?: string;
  createdAt: string;
  createdBy: string;
};

export type MoveTaskKind = "vacate" | "move" | "verify" | "open";

export type MoveTaskStatus = "hazır" | "bekliyor" | "bloklu" | "yayınlandı";

export type MoveTask = {
  seq: number;
  id: string;
  kind: MoveTaskKind;
  label: string;
  skuId: string | null;
  sourceLocationId: string | null;
  targetLocationId: string | null;
  /** Önkoşul görev sıra numaraları. */
  dependsOn: number[];
  loadLabel: string;
  loadHours: number;
  zone: ZoneId;
  status: MoveTaskStatus;
  /** Bu görevin bağlı olduğu bağımlılık paketi. */
  packageId: string;
  expectedBenefitPct: number;
};

export type PlanVersion = {
  id: string;
  createdAt: string;
  createdBy: string;
  netOperationDeltaPct: number;
  moveTaskCount: number;
  note: string;
  state: "arşiv" | "aktif" | "taslak";
};

export type PlanMeasurement = {
  planId: string;
  status: "not-published" | "insufficient-data" | "measured";
  expectedDeltaPct: number;
  actualDeltaPct?: number;
  baselineP50Sec?: number;
  observedP50Sec?: number;
  baselineSamples: number;
  observedSamples: number;
  minimumSamples: number;
  windowStart?: string;
  windowEnd?: string;
};

/** Slot skorlama fonksiyonu (§14.2). */
export function slotScore(input: {
  expectedPickSeconds: number;
  p90RiskSeconds: number;
  replenishmentCost: number;
  congestionCost: number;
  moveCost: number;
  splitPickCost: number;
}) {
  return (
    input.expectedPickSeconds * 1.0 +
    input.p90RiskSeconds * 0.35 +
    input.replenishmentCost * 0.55 +
    input.congestionCost * 0.7 +
    input.moveCost * 0.25 +
    input.splitPickCost * 0.45
  );
}
