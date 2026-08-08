import type {
  FacilityLayoutResponse,
  MoveTask,
  SlotPlan,
} from "@gbsoft/domain";
import type {
  ReoptimizeRequest,
  ReoptimizeResponse,
} from "@gbsoft/domain";

import {
  ACTUAL_BREAKDOWN,
  COMPLETION_SERIES,
  COVERAGE,
  DEMO_SLOT_PLAN,
  EXCEPTIONS,
  FACILITY,
  FACILITY_LAYOUT,
  LOCATIONS,
  LOCKED_REOPTIMIZED_PLAN,
  MODEL_QUALITY,
  MOVE_TASKS,
  MOVE_TASKS_R1,
  OVERVIEW_KPIS,
  PLAN_BREAKDOWN,
  PLAN_VERSIONS,
  QUALITY_ISSUES,
  READINESS_PCT,
  SKUS,
  VARIANCE_ROWS,
  ZONE_WORKLOAD,
} from "@gbsoft/seed";
/**
 * Demo adaptörü — VITE_DEMO_MODE=1 iken devrededir.
 *
 * Backend olmadan satış demosunu çalıştırır. Endpoint sözleşmesi, sabit
 * gecikmeler ve hata/infeasible senaryoları gerçek istemciyle aynıdır.
 *
 * Eski açıklama (§15):
 *
 * Gerçek bir ağ çağrısı yoktur; ancak endpoint sözleşmesi, gecikme ve hata
 * senaryoları uygulama tarafında gerçek bir istemci gibi ele alınır.
 * Gecikmeler sabittir, rastgele değildir (§15.4).
 */

const LATENCY = {
  overview: 180,
  layout: 220,
  pickingTime: 160,
  slotPlan: 200,
  moveTasks: 150,
  dataQuality: 140,
  publish: 420,
};

export class ApiError extends Error {
  readonly endpoint: string;
  readonly fallbackPlanId?: string;

  constructor(message: string, endpoint: string, fallbackPlanId?: string) {
    super(message);
    this.name = "ApiError";
    this.endpoint = endpoint;
    this.fallbackPlanId = fallbackPlanId;
  }
}

function delay<T>(value: T, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => resolve(value), ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

/**
 * Demo sırasında hata durumunu göstermek için kullanılan anahtar.
 * `?fail=slot-plan` sorgu parametresi ile açılır.
 */
function shouldFail(endpoint: string): boolean {
  if (typeof window === "undefined") return false;
  const failing = new URLSearchParams(window.location.search).get("fail");
  return failing === endpoint;
}

/* GET /api/facilities/:id/overview */
export async function fetchOverview(signal?: AbortSignal) {
  if (shouldFail("overview")) {
    throw new ApiError(
      "Operasyon özeti yüklenemedi.",
      "/api/facilities/MARMARA-DC-01/overview",
    );
  }
  return delay(
    {
      facility: FACILITY,
      kpis: OVERVIEW_KPIS,
      exceptions: EXCEPTIONS,
      zoneWorkload: ZONE_WORKLOAD,
      completion: COMPLETION_SERIES,
      plan: DEMO_SLOT_PLAN,
    },
    LATENCY.overview,
    signal,
  );
}

/* GET /api/facilities/:id/layout */
export async function fetchLayout(
  signal?: AbortSignal,
): Promise<FacilityLayoutResponse> {
  return delay(
    { facility: FACILITY, layout: FACILITY_LAYOUT, locations: LOCATIONS },
    LATENCY.layout,
    signal,
  );
}

/** SKU master'ı — demo modunda golden dataset'ten okunur. */
export async function fetchSkus(signal?: AbortSignal) {
  return delay(SKUS, LATENCY.layout, signal);
}

/* GET /api/facilities/:id/picking-time */
export async function fetchPickingTime(signal?: AbortSignal) {
  return delay(
    {
      plan: PLAN_BREAKDOWN,
      actual: ACTUAL_BREAKDOWN,
      variance: VARIANCE_ROWS,
      modelQuality: MODEL_QUALITY,
    },
    LATENCY.pickingTime,
    signal,
  );
}

/* GET /api/slot-plans/:id */
export async function fetchSlotPlan(
  planId: string,
  signal?: AbortSignal,
): Promise<SlotPlan> {
  if (shouldFail("slot-plan")) {
    throw new ApiError(
      "Slot planı yüklenemedi.",
      `/api/slot-plans/${planId}`,
      "SP-2026-079",
    );
  }
  const plan =
    planId === LOCKED_REOPTIMIZED_PLAN.id
      ? LOCKED_REOPTIMIZED_PLAN
      : DEMO_SLOT_PLAN;
  return delay(plan, LATENCY.slotPlan, signal);
}

/* GET /api/slot-plans/:id/move-tasks */
export async function fetchMoveTasks(
  planId: string,
  signal?: AbortSignal,
): Promise<MoveTask[]> {
  const tasks = planId === LOCKED_REOPTIMIZED_PLAN.id ? MOVE_TASKS_R1 : MOVE_TASKS;
  return delay(tasks, LATENCY.moveTasks, signal);
}

/* GET /api/slot-plans */
export async function fetchPlanVersions(signal?: AbortSignal) {
  return delay(PLAN_VERSIONS, LATENCY.moveTasks, signal);
}

/* GET /api/data-quality */
export async function fetchDataQuality(signal?: AbortSignal) {
  return delay(
    { readinessPct: READINESS_PCT, coverage: COVERAGE, issues: QUALITY_ISSUES },
    LATENCY.dataQuality,
    signal,
  );
}

/* POST /api/slot-plans/:id/reoptimize */
export async function reoptimize(
  request: ReoptimizeRequest,
): Promise<ReoptimizeResponse> {
  // Move budget çok düşükse çözüm bulunamaz (§19.4).
  if (request.moveBudget < 12) {
    return {
      runId: "RUN-9483",
      status: "infeasible",
      planId: request.planId,
      solverVersion: DEMO_SLOT_PLAN.solverVersion,
      objectiveDeltaPct: 0,
      hardViolations: 0,
      moveTaskCount: 0,
      solveDurationMs: 940,
      infeasibilityReasons: [
        "4 SKU için kapasiteye uygun lokasyon yok",
        `Zone A move budget yetersiz (${request.moveBudget} görev)`,
        "2 hedef lokasyon kilitli",
      ],
      relaxationOptions: [
        "Move budget'ı artır",
        "Kilitleri incele",
        "Alternatif zonlara izin ver",
      ],
    };
  }

  const locked = request.lockedAssignments.some(
    (a) => a.skuId === "SKU-184" && a.locationId === "A-03-02",
  );

  const plan = locked ? LOCKED_REOPTIMIZED_PLAN : DEMO_SLOT_PLAN;

  return {
    runId: plan.runId,
    status: "feasible",
    planId: plan.id,
    solverVersion: plan.solverVersion,
    objectiveDeltaPct: plan.netOperationDeltaPct,
    hardViolations: plan.hardViolationCount,
    moveTaskCount: plan.moveTaskCount,
    solveDurationMs: plan.solveDurationMs,
  };
}

/* POST /api/slot-plans/:id/publish */
export async function publishMoveTasks(
  planId: string,
  taskIds: string[],
): Promise<{ published: number; planId: string; mode: "demo" }> {
  return delay(
    { published: taskIds.length, planId, mode: "demo" as const },
    LATENCY.publish,
  );
}
