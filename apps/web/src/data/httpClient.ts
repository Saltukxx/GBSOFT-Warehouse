import type {
  DataQualityResponse,
  FacilityLayoutResponse,
  ImportBatchSummary,
  ImportKind,
  ImportReport,
  ImportTemplate,
  PickTimeCalibrationResult,
  PickTimeModelSnapshot,
  PickingTimeResponse,
  PickOrderDetail,
  PickOrderSummary,
  PickTourOptimizeOptions,
  PickTourPlan,
  RoutePlan,
  Scene3DResponse,
  CreateOptimizationRunResponse,
  OptimizationRunResponse,
  ReoptimizeRequest,
  ReoptimizeResponse,
  MoveTask,
  PlanVersion,
  SlotPlan,
} from "@gbsoft/domain";
import { ApiError } from "./demoAdapter";

/**
 * Gerçek API istemcisi.
 *
 * Canlıya alınan uçlar buradan, henüz ürünleştirilmemiş uçlar demo
 * adaptöründen okunur. Hangi ucun canlı olduğu `LIVE_ENDPOINTS` üzerinden
 * tek yerden görülür.
 */

const BASE_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:3001";

/** Tek kiracı kurulumda kiracı sunucu tarafında çözülür. */
const TENANT_HEADER = import.meta.env.VITE_TENANT_ID;

export const FACILITY_CODE =
  import.meta.env.VITE_FACILITY_CODE ?? "MARMARA-DC-01";

async function request<T>(
  path: string,
  init: RequestInit & { signal?: AbortSignal } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (TENANT_HEADER) headers.set("x-tenant-id", TENANT_HEADER);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(
      `API'ye ulaşılamadı. Sunucu çalışıyor mu? (${BASE_URL})`,
      path,
    );
  }

  if (!response.ok) {
    let message = `İstek başarısız (HTTP ${response.status}).`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // Gövde JSON değilse varsayılan mesaj kullanılır.
    }
    throw new ApiError(message, path);
  }

  return (await response.json()) as T;
}

/* GET /api/facilities/:code/layout */
export async function fetchLayout(
  signal?: AbortSignal,
): Promise<FacilityLayoutResponse> {
  return request(`/api/facilities/${FACILITY_CODE}/layout`, { signal });
}

/* GET /api/facilities/:code/scene-3d */
export async function fetchScene3D(
  signal?: AbortSignal,
): Promise<Scene3DResponse> {
  return request(`/api/facilities/${FACILITY_CODE}/scene-3d`, { signal });
}

/* GET /api/facilities/:code/routes */
export async function fetchRoute(
  stops: string[],
  signal?: AbortSignal,
): Promise<RoutePlan> {
  const query = new URLSearchParams({ stops: stops.join(",") });
  return request(`/api/facilities/${FACILITY_CODE}/routes?${query}`, { signal });
}

/* GET /api/facilities/:code/picking-time */
export async function fetchPickingTime(
  signal?: AbortSignal,
): Promise<PickingTimeResponse> {
  return request(`/api/facilities/${FACILITY_CODE}/picking-time`, { signal });
}

/* GET /api/facilities/:code/pick-time-model */
export async function fetchPickTimeModel(
  signal?: AbortSignal,
): Promise<PickTimeModelSnapshot> {
  return request(`/api/facilities/${FACILITY_CODE}/pick-time-model`, { signal });
}

/* POST /api/facilities/:code/pick-time-model/calibrate */
export async function calibratePickTimeModel(
  signal?: AbortSignal,
): Promise<PickTimeCalibrationResult & { modelVersion: string | null }> {
  return request(`/api/facilities/${FACILITY_CODE}/pick-time-model/calibrate`, {
    method: "POST",
    signal,
  });
}

/* GET /api/data-quality */
export async function fetchDataQuality(
  signal?: AbortSignal,
): Promise<DataQualityResponse> {
  return request(`/api/data-quality?facility=${FACILITY_CODE}`, { signal });
}

/* ------------------------------------------------------------------ */
/* Veri girişi                                                         */
/* ------------------------------------------------------------------ */

/* GET /api/imports/templates */
export async function fetchImportTemplates(
  signal?: AbortSignal,
): Promise<ImportTemplate[]> {
  const body = await request<{ templates: ImportTemplate[] }>(
    "/api/imports/templates",
    { signal },
  );
  return body.templates;
}

/** Şablon dosyasının indirme adresi — tarayıcı doğrudan çeker. */
export function importTemplateUrl(kind: ImportKind): string {
  return `${BASE_URL}/api/imports/templates/${kind}.csv`;
}

/**
 * POST /api/imports/:kind
 *
 * Dosyanın tamamı reddedildiğinde sunucu 422 döner ama gövde yine tam
 * rapordur: kullanıcı neyin neden reddedildiğini görmelidir. Bu yüzden
 * 422 burada hata olarak fırlatılmaz, rapor olarak çözülür.
 */
export async function uploadImport(
  kind: ImportKind,
  fileName: string,
  content: string,
  options: Record<string, string> = {},
  dryRun = true,
  signal?: AbortSignal,
): Promise<ImportReport> {
  const query = new URLSearchParams({
    facility: FACILITY_CODE,
    dryRun: dryRun ? "1" : "0",
    ...options,
  });

  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json",
  });
  if (TENANT_HEADER) headers.set("x-tenant-id", TENANT_HEADER);

  const path = `/api/imports/${kind}?${query.toString()}`;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fileName, content }),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(
      `API'ye ulaşılamadı. Sunucu çalışıyor mu? (${BASE_URL})`,
      path,
    );
  }

  if (response.ok || response.status === 422) {
    return (await response.json()) as ImportReport;
  }

  let message = `Yükleme başarısız (HTTP ${response.status}).`;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch {
    // Gövde JSON değilse varsayılan mesaj kullanılır.
  }
  throw new ApiError(message, path);
}

/* GET /api/imports/batches */
export async function fetchImportBatches(
  signal?: AbortSignal,
): Promise<ImportBatchSummary[]> {
  const body = await request<{ batches: ImportBatchSummary[] }>(
    `/api/imports/batches?facility=${FACILITY_CODE}`,
    { signal },
  );
  return body.batches;
}

/* GET /api/imports/batches/:id */
export async function fetchImportBatch(
  id: string,
  signal?: AbortSignal,
): Promise<ImportReport> {
  return request(`/api/imports/batches/${id}`, { signal });
}

/* POST /api/optimization-runs + GET /api/optimization-runs/:id */
export async function reoptimize(
  payload: ReoptimizeRequest,
): Promise<ReoptimizeResponse> {
  const created = await request<CreateOptimizationRunResponse>(
    "/api/optimization-runs",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    const run = await request<OptimizationRunResponse>(
      `/api/optimization-runs/${created.runId}`,
    );
    if (
      run.status === "feasible" ||
      run.status === "infeasible" ||
      run.status === "timeout" ||
      run.status === "failed"
    ) {
      return { ...run, status: run.status };
    }
  }
  throw new ApiError(
    "Optimizasyon sonucu bekleme süresini aştı. Çalıştırma geçmişten izlenebilir.",
    `/api/optimization-runs/${created.runId}`,
  );
}

export async function fetchSlotPlan(planId: string, signal?: AbortSignal): Promise<SlotPlan> {
  return request(`/api/slot-plans/${encodeURIComponent(planId)}`, { signal });
}

export async function fetchMoveTasks(planId: string, signal?: AbortSignal): Promise<MoveTask[]> {
  return request(`/api/slot-plans/${encodeURIComponent(planId)}/move-tasks`, { signal });
}

export async function fetchPlanVersions(signal?: AbortSignal): Promise<PlanVersion[]> {
  return request(`/api/slot-plans?facility=${FACILITY_CODE}`, { signal });
}

export async function publishMoveTasks(planId: string, taskIds: string[]) {
  return request<{ published: number; planId: string; idempotent: boolean; mode: "live" }>(
    `/api/slot-plans/${encodeURIComponent(planId)}/publish`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ taskIds }),
    },
  );
}

export async function rollbackSlotPlan(planId: string, targetPlanId: string) {
  return request<{ rolledBackPlanId: string; activePlanId: string; publishedTasksUnaffected: true }>(
    `/api/slot-plans/${encodeURIComponent(planId)}/rollback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetPlanId }),
    },
  );
}

/* ------------------------------------------------------------------ */
/* Yükleme siparişleri ve toplama turları (Faz 6.5)                    */
/* ------------------------------------------------------------------ */

/* GET /api/pick-orders */
export async function fetchPickOrders(
  signal?: AbortSignal,
): Promise<PickOrderSummary[]> {
  const body = await request<{ orders: PickOrderSummary[] }>(
    `/api/pick-orders?facility=${FACILITY_CODE}`,
    { signal },
  );
  return body.orders;
}

/* GET /api/pick-orders/:id */
export async function fetchPickOrder(
  id: string,
  signal?: AbortSignal,
): Promise<PickOrderDetail> {
  return request(`/api/pick-orders/${encodeURIComponent(id)}`, { signal });
}

/**
 * POST /api/pick-orders/:id/optimize
 *
 * 202 + runId döner; sonuç `optimization-runs` üzerinden izlenir. Sipariş
 * satırlarından tura giremeyenler `skippedLines` ile birlikte gelir —
 * sessizce düşmezler.
 */
export async function optimizePickOrder(
  id: string,
  options: PickTourOptimizeOptions,
): Promise<{ runId: string; skippedLines: PickTourPlan["skippedLines"] }> {
  return request(`/api/pick-orders/${encodeURIComponent(id)}/optimize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options),
  });
}

/* GET /api/pick-orders/:id/tours */
export async function fetchPickTours(
  id: string,
  signal?: AbortSignal,
): Promise<PickTourPlan> {
  return request(`/api/pick-orders/${encodeURIComponent(id)}/tours`, { signal });
}

/* GET /api/pick-orders/:id/tours/:tourId/route */
export async function fetchTourRoute(
  orderId: string,
  tourId: string,
  signal?: AbortSignal,
): Promise<RoutePlan> {
  return request(
    `/api/pick-orders/${encodeURIComponent(orderId)}/tours/${encodeURIComponent(tourId)}/route`,
    { signal },
  );
}

/** Çalıştırmanın terminal duruma gelmesini bekler. */
export async function awaitOptimizationRun(
  runId: string,
  timeoutMs = 60_000,
): Promise<OptimizationRunResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    const run = await request<OptimizationRunResponse>(
      `/api/optimization-runs/${runId}`,
    );
    if (run.status !== "queued" && run.status !== "running") return run;
  }
  throw new ApiError(
    "Optimizasyon sonucu bekleme süresini aştı.",
    `/api/optimization-runs/${runId}`,
  );
}
