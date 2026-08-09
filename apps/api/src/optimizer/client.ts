import { config } from "../config.js";

export type OptimizerRequest = {
  run_id: string;
  seed: number;
  time_limit_ms: number;
  move_budget: number;
  min_net_benefit_pct: number;
  weights: {
    picking_time: number;
    replenishment: number;
    congestion: number;
    move_cost: number;
    ergonomics: number;
  };
  skus: Array<{
    id: string;
    weight_kg: number;
    volume_m3: number;
    allowed_equipment: Array<"manual" | "cart" | "forklift">;
    allowed_zones: string[];
    current_location_id: string | null;
    fixed_location_id: string | null;
    picks_per_day: number;
    replenishments_per_day: number;
  }>;
  locations: Array<{
    id: string;
    zone: string;
    max_weight_kg: number;
    max_volume_m3: number;
    equipment: "manual" | "cart" | "forklift";
    blocked: boolean;
    distance_to_dock_m: number;
    expected_pick_sec: number;
    congestion_score: number;
    golden_zone: boolean;
  }>;
  locked_assignments: Array<{ sku_id: string; location_id: string }>;
  excluded_sku_ids: string[];
  blocked_location_ids: string[];
  frozen_zones: string[];
};

export type OptimizerResult = {
  run_id: string;
  status: "optimal" | "feasible" | "infeasible" | "timeout" | "failed";
  solution_quality: "optimal" | "feasible" | "none";
  solver_version: string;
  solve_duration_ms: number;
  objective_value: number | null;
  baseline_objective: number | null;
  objective_delta_pct: number;
  gap_pct: number | null;
  hard_violations: number;
  move_count: number;
  assignments: Array<{
    sku_id: string;
    source_location_id: string | null;
    target_location_id: string;
    moved: boolean;
    cost: number;
    expected_pick_sec: number;
    alternatives: string[];
  }>;
  excluded_sku_ids: string[];
  infeasibility_reasons: string[];
  relaxation_options: string[];
  diagnostics: Record<string, number>;
};

export async function solve(request: OptimizerRequest): Promise<OptimizerResult> {
  const response = await fetch(`${config.OPTIMIZER_URL}/solve`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(request.time_limit_ms + 10_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Optimizer HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  return (await response.json()) as OptimizerResult;
}
