import type {
  DataQualityResponse,
  FacilityLayoutResponse,
  ImportBatchSummary,
  ImportKind,
  ImportReport,
  ImportTemplate,
  MoveTask,
  PickingTimeResponse,
  PickOrderDetail,
  PickOrderSummary,
  PickTourPlan,
  RoutePlan,
  Scene3DResponse,
  SlotPlan,
} from "@gbsoft/domain";
import type {
  ReoptimizeRequest,
  ReoptimizeResponse,
} from "@gbsoft/domain";
import {
  DEFAULT_PICK_TIME_PARAMETERS,
  buildScene3D,
  buildTwinGraph,
  shortestPathNodes,
  IMPORT_KINDS,
  IMPORT_TEMPLATES,
  templateToCsvRows,
  toCsv,
  validateImportCsv,
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
  SOURCE_HEALTH,
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

/**
 * GET /api/facilities/:id/scene-3d
 *
 * Demo modu 3B sahneyi de gerçek dönüşümle üretir: aynı `buildScene3D`
 * sunucuda da çalışır. Demo ile ürün farklı bir sahne gösteremez.
 */
export async function fetchScene3D(
  signal?: AbortSignal,
): Promise<Scene3DResponse> {
  return delay(
    {
      facility: { id: FACILITY.id, name: FACILITY.name, city: FACILITY.city },
      scene: buildScene3D({ layout: FACILITY_LAYOUT, locations: LOCATIONS }),
    },
    LATENCY.layout,
    signal,
  );
}

/**
 * GET /api/facilities/:id/routes
 *
 * Demo modunda graf tarayıcıda kurulur ve aynı `shortestPathNodes` ile
 * çözülür. Sunucudaki rota ile demo rotası aynı algoritmadan çıkar.
 */
export async function fetchRoute(
  stops: string[],
  signal?: AbortSignal,
): Promise<RoutePlan> {
  const graph = buildTwinGraph({
    unitsPerMeter: FACILITY_LAYOUT.unitsPerMeter,
    dockAnchor: FACILITY_LAYOUT.dockAnchor,
    aisles: FACILITY_LAYOUT.aisles,
    floorAreas: FACILITY_LAYOUT.floorAreas,
    locations: LOCATIONS,
  });

  const toM = (units: number) =>
    Math.round((units / FACILITY_LAYOUT.unitsPerMeter) * 1_000) / 1_000;
  const nodeFor = (stop: string) =>
    stop === "DOCK"
      ? graph.dockNodeCode
      : (graph.nodes.find((node) => node.locationCode === stop)?.code ?? null);

  const legs: RoutePlan["legs"] = [];
  const unreachable: RoutePlan["unreachable"] = [];

  for (let index = 1; index < stops.length; index += 1) {
    const fromCode = stops[index - 1];
    const toCode = stops[index];
    if (fromCode === toCode) continue;

    const from = nodeFor(fromCode);
    const to = nodeFor(toCode);
    const path = from && to ? shortestPathNodes(graph, from, to) : null;
    if (!path) {
      unreachable.push({
        fromCode,
        toCode,
        reason: "Grafta yürünebilir yol yok.",
      });
      continue;
    }

    const points = path.map((node) => ({ x: toM(node.x), y: 0, z: toM(node.y) }));
    let distanceM = 0;
    for (let step = 1; step < points.length; step += 1) {
      distanceM += Math.hypot(
        points[step].x - points[step - 1].x,
        points[step].z - points[step - 1].z,
      );
    }
    legs.push({
      fromCode,
      toCode,
      distanceM: Math.round(distanceM * 1_000) / 1_000,
      points,
    });
  }

  return delay(
    {
      facilityCode: FACILITY.id,
      layoutVersion: FACILITY_LAYOUT.layoutVersion,
      units: "m" as const,
      unreachable,
      legs,
      totalDistanceM:
        Math.round(legs.reduce((sum, leg) => sum + leg.distanceM, 0) * 1_000) / 1_000,
    },
    LATENCY.layout,
    signal,
  );
}

/* ------------------------------------------------------------------ */
/* Yükleme siparişleri — demo modunda kapsam dışı                      */
/* ------------------------------------------------------------------ */

/**
 * Toplama turu optimizasyonu gerçek solver'a ihtiyaç duyar; tarayıcıda
 * çalıştırılamaz. Demo modu bunu uydurmak yerine açıkça söyler — sahte bir
 * tur planı göstermek, ölçülmemiş bir şeyi ölçülmüş göstermenin başka biçimi
 * olurdu.
 */
const TOURS_NEED_BACKEND =
  "Toplama turu optimizasyonu Python solver'ına ihtiyaç duyar ve demo modunda çalışmaz. " +
  "API ve optimizer servislerini başlatın.";

export async function fetchPickOrders(signal?: AbortSignal) {
  return delay([] as PickOrderSummary[], LATENCY.layout, signal);
}

export async function fetchPickOrder(): Promise<PickOrderDetail> {
  throw new ApiError(TOURS_NEED_BACKEND, "/api/pick-orders/:id");
}

export async function optimizePickOrder(): Promise<never> {
  throw new ApiError(TOURS_NEED_BACKEND, "/api/pick-orders/:id/optimize");
}

export async function fetchPickTours(): Promise<PickTourPlan> {
  throw new ApiError(TOURS_NEED_BACKEND, "/api/pick-orders/:id/tours");
}

export async function fetchTourRoute(): Promise<RoutePlan> {
  throw new ApiError(TOURS_NEED_BACKEND, "/api/pick-orders/:id/tours/:tid/route");
}

export async function awaitOptimizationRun(): Promise<never> {
  throw new ApiError(TOURS_NEED_BACKEND, "/api/optimization-runs/:id");
}

/** SKU master'ı — demo modunda golden dataset'ten okunur. */
export async function fetchSkus(signal?: AbortSignal) {
  return delay(SKUS, LATENCY.layout, signal);
}

/* GET /api/facilities/:id/picking-time */
export async function fetchPickingTime(
  signal?: AbortSignal,
): Promise<PickingTimeResponse> {
  return delay(
    {
      facilityCode: FACILITY.id,
      plan: PLAN_BREAKDOWN,
      actual: ACTUAL_BREAKDOWN,
      variance: VARIANCE_ROWS,
      model: {
        version: MODEL_QUALITY.modelVersion,
        parameters: DEFAULT_PICK_TIME_PARAMETERS,
        calibrated: false,
        algorithm: "demo-simulation",
        sampleSize: MODEL_QUALITY.sampleLines,
        trainedFrom: null,
        trainedTo: null,
        p50MaeSec: 1.8,
        p90CoveragePct: MODEL_QUALITY.p90CoveragePct,
        createdAt: FACILITY.snapshotAt,
        calibrationMessage:
          "Demo simülasyonu. Gerçek WMS görev verisi bağlandığında tesis bazında kalibre edilir.",
      },
      eventSummary: {
        taskCount: MODEL_QUALITY.sampleLines,
        labelledTaskCount: Math.round(
          (MODEL_QUALITY.sampleLines * MODEL_QUALITY.dataCompletenessPct) / 100,
        ),
        trainingEligibleCount: MODEL_QUALITY.sampleLines,
        pairedEventCount: Math.round(
          (MODEL_QUALITY.sampleLines * MODEL_QUALITY.dataCompletenessPct) / 100,
        ),
        lateEventCount: 0,
      },
      actualWindowLabel: MODEL_QUALITY.trainingWindow,
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
export async function fetchDataQuality(
  signal?: AbortSignal,
): Promise<DataQualityResponse> {
  const issues = QUALITY_ISSUES.map((issue) => ({
    ...issue,
    blocksPublish: issue.priority === "Kritik",
    detectedAt: FACILITY.snapshotAt,
  }));
  return delay(
    {
      facilityCode: FACILITY.id,
      readinessPct: READINESS_PCT,
      coverage: COVERAGE,
      issues,
      sourceHealth: SOURCE_HEALTH,
      publishGate: {
        allowed: false,
        blockingIssueCodes: issues
          .filter((issue) => issue.blocksPublish)
          .map((issue) => issue.id),
        reason: "1 kritik veri kalitesi sorunu plan yayınını blokluyor.",
      },
      blockingIssueCount: issues.filter((issue) => issue.blocksPublish).length,
      lastValidatedAt: FACILITY.snapshotAt,
    },
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

export async function rollbackSlotPlan(
  planId: string,
  targetPlanId: string,
): Promise<{ rolledBackPlanId: string; activePlanId: string; publishedTasksUnaffected: true }> {
  return delay({ rolledBackPlanId: planId, activePlanId: targetPlanId, publishedTasksUnaffected: true as const }, LATENCY.publish);
}

/* ------------------------------------------------------------------ */
/* Veri girişi                                                         */
/* ------------------------------------------------------------------ */

/* GET /api/imports/templates */
export async function fetchImportTemplates(
  signal?: AbortSignal,
): Promise<ImportTemplate[]> {
  return delay(
    IMPORT_KINDS.map((kind) => IMPORT_TEMPLATES[kind]),
    LATENCY.dataQuality,
    signal,
  );
}

/**
 * Demo modunda şablon dosyası tarayıcıda üretilir; sunucuya ihtiyaç yoktur.
 * Türkçe Excel için noktalı virgül ayraç ve BOM ile.
 */
export function importTemplateUrl(kind: ImportKind): string {
  const csv = toCsv(templateToCsvRows(IMPORT_TEMPLATES[kind]), ";");
  const blob = new Blob(["\uFEFF" + csv + "\r\n"], {
    type: "text/csv;charset=utf-8",
  });
  return URL.createObjectURL(blob);
}

/**
 * POST /api/imports/:kind — demo karşılığı.
 *
 * Doğrulama tarayıcıda gerçekten çalışır: aynı @gbsoft/domain motoru, aynı
 * satır bazlı rapor. Yazma ise yapılmaz — demo modunda veritabanı yoktur ve
 * "uygulandı" demek yalan olurdu.
 */
export async function uploadImport(
  kind: ImportKind,
  fileName: string,
  content: string,
  _options: Record<string, string> = {},
  dryRun = true,
  signal?: AbortSignal,
): Promise<ImportReport> {
  const startedAt = new Date().toISOString();
  const validation = validateImportCsv(kind, content);
  const issues = [...validation.issues];

  if (!dryRun) {
    issues.push({
      line: 0,
      code: "demo-modu",
      message:
        "Demo modunda veritabanı yok: dosya doğrulandı ama yazılmadı. " +
        "Gerçek yükleme için VITE_DEMO_MODE=0 ile API'ye bağlanın.",
      severity: "warning",
    });
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const rowsAccepted = validation.fatal ? 0 : validation.rows.length;

  const report: ImportReport = {
    batchId: null,
    kind,
    fileName,
    facilityCode: FACILITY.id,
    // Demo modunda her koşu kuru koşudur.
    dryRun: true,
    status: validation.fatal ? "REJECTED" : "VALIDATED",
    delimiter: validation.delimiter,
    rowsTotal: validation.rowsTotal,
    rowsAccepted,
    rowsRejected: validation.rowsTotal - rowsAccepted,
    issues,
    issuesTruncated: false,
    errorCount,
    warningCount: issues.length - errorCount,
    summary: validation.fatal
      ? []
      : [
          `${rowsAccepted} satır biçim doğrulamasından geçti.`,
          "Demo modu: veritabanına hiçbir şey yazılmadı.",
        ],
    startedAt,
    finishedAt: new Date().toISOString(),
  };

  return delay(report, LATENCY.dataQuality, signal);
}

/** Demo modunda içe aktarma geçmişi tutulmaz. */
export async function fetchImportBatches(
  signal?: AbortSignal,
): Promise<ImportBatchSummary[]> {
  return delay([], LATENCY.dataQuality, signal);
}

export async function fetchImportBatch(id: string): Promise<ImportReport> {
  throw new ApiError(
    "Demo modunda içe aktarma geçmişi tutulmaz.",
    `/api/imports/batches/${id}`,
  );
}
