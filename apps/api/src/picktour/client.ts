import { config } from "../config.js";

/**
 * Toplama turu çözücüsünün HTTP istemcisi.
 *
 * Sözleşme `services/optimizer/src/gbsoft_optimizer/picktour/models.py` ile
 * birebirdir; alan adları Python tarafındaki snake_case biçimini korur.
 */

export type PickTourSolveRequest = {
  run_id: string;
  seed: number;
  time_limit_ms: number;
  solution_limit: number;
  equipment: "manual" | "cart" | "forklift";
  vehicle_count: number;
  capacity_volume_m3: number;
  capacity_weight_kg: number;
  speed_mps: number;
  objective: "makespan" | "total";
  setup_sec: number;
  deposit_sec: number;
  deposit_per_unit_sec: number;
  congestion_factor: number;
  /** (n+1)×(n+1); 0. indeks dock. */
  distance_m: number[][];
  stops: Array<{
    id: string;
    sku_id: string;
    quantity: number;
    volume_m3: number;
    weight_kg: number;
    pick_sec: number;
    congestion_score: number;
  }>;
};

export type PickTourSolveResult = {
  run_id: string;
  status: "feasible" | "infeasible" | "timeout" | "failed";
  solution_quality: "feasible" | "none";
  solver_version: string;
  solve_duration_ms: number;
  makespan_sec: number;
  total_sec: number;
  lower_bound_sec: number;
  tours: Array<{
    seq: number;
    distance_m: number;
    travel_sec: number;
    congestion_sec: number;
    pick_sec: number;
    setup_sec: number;
    deposit_sec: number;
    total_sec: number;
    volume_m3: number;
    weight_kg: number;
    stops: Array<{
      seq: number;
      location_id: string;
      sku_id: string;
      quantity: number;
      distance_m: number;
      travel_sec: number;
      congestion_sec: number;
      pick_sec: number;
      cumulative_sec: number;
    }>;
  }>;
  unassigned_stop_ids: string[];
  infeasibility_reasons: string[];
  relaxation_options: string[];
  diagnostics: Record<string, number>;
  stopped_by: "solution-limit" | "time-limit" | null;
};

export async function solvePickTour(
  request: PickTourSolveRequest,
): Promise<PickTourSolveResult> {
  const response = await fetch(`${config.OPTIMIZER_URL}/solve/pick-tour`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(request.time_limit_ms + 10_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Optimizer HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  return (await response.json()) as PickTourSolveResult;
}
