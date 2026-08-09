/** Optimizer çalışma sözleşmesi (Şartname §8.7, §15.2). */

import type { ObjectiveProfile } from "./slotting.js";
import type { ZoneId } from "./warehouse.js";

export type ObjectiveWeights = {
  pickingTime: number;
  replenishment: number;
  congestion: number;
  moveCost: number;
};

export type LockedAssignment = {
  skuId: string;
  locationId: string;
};

export type ReoptimizeRequest = {
  planId: string;
  profile: ObjectiveProfile;
  weights: ObjectiveWeights;
  moveBudget: number;
  minNetBenefitPct: number;
  lockedAssignments: LockedAssignment[];
  excludedSkuIds: string[];
  blockedLocationIds: string[];
  frozenZones: ZoneId[];
};

export type ReoptimizeResponse = {
  runId: string;
  status: "feasible" | "infeasible" | "timeout" | "failed";
  planId: string;
  solverVersion: string;
  solutionQuality?: "optimal" | "feasible" | "none";
  objectiveDeltaPct: number;
  gapPct?: number;
  hardViolations: number;
  moveTaskCount: number;
  solveDurationMs: number;
  /** infeasible durumunda operatöre gösterilen nedenler (§19.4). */
  infeasibilityReasons?: string[];
  relaxationOptions?: string[];
};

export type OptimizationRunStatus =
  | "queued"
  | "running"
  | ReoptimizeResponse["status"];

export type CreateOptimizationRunResponse = {
  runId: string;
  status: "queued";
};

export type OptimizationRunResponse = Omit<ReoptimizeResponse, "status"> & {
  status: OptimizationRunStatus;
};

/** Solver adımları — sahte "AI düşünüyor" metni değil, gerçek aşamalar (§8.7). */
export const SOLVER_STEPS = [
  "Veri snapshot'ı doğrulanıyor",
  "Kısıtlar hazırlanıyor",
  "Uygulanabilir plan aranıyor",
  "Alternatifler karşılaştırılıyor",
  "Sonuç hazır",
] as const;

export const PROFILE_PRESETS: Record<
  ObjectiveProfile,
  { label: string; description: string; weights: ObjectiveWeights; moveBudget: number }
> = {
  balanced: {
    label: "Dengeli",
    description: "Picking, replenishment ve taşıma maliyeti birlikte tartılır.",
    weights: { pickingTime: 1, replenishment: 0.55, congestion: 0.7, moveCost: 0.25 },
    moveBudget: 30,
  },
  picking: {
    label: "Picking öncelikli",
    description: "Toplama süresi ağırlığı yükselir; taşıma işi artabilir.",
    weights: { pickingTime: 1, replenishment: 0.35, congestion: 0.6, moveCost: 0.15 },
    moveBudget: 40,
  },
  "low-move": {
    label: "Düşük taşıma",
    description: "Az sayıda taşıma görevi; kazanç daha sınırlı olur.",
    weights: { pickingTime: 1, replenishment: 0.6, congestion: 0.7, moveCost: 0.7 },
    moveBudget: 14,
  },
  peak: {
    label: "Yoğun dönem",
    description: "Congestion cezası artar; koridor yığılması öncelikli çözülür.",
    weights: { pickingTime: 1, replenishment: 0.5, congestion: 1.1, moveCost: 0.3 },
    moveBudget: 26,
  },
};
