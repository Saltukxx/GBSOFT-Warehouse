import { config } from "../config.js";

export type TruckLoadSolveRequest = {
  run_id: string;
  seed: number;
  time_limit_ms: number;
  vehicle: {
    code: string;
    internal_length_m: number;
    internal_width_m: number;
    internal_height_m: number;
    rear_door: { width_m: number; height_m: number; sill_height_m: number };
    max_payload_kg: number;
    axle_groups: Array<{
      code: string;
      label: string;
      position_x: number;
      empty_load_kg: number;
      max_load_kg: number;
    }>;
    obstacles: Array<{
      code: string;
      label: string;
      x: number;
      y: number;
      z: number;
      length_m: number;
      width_m: number;
      height_m: number;
    }>;
    cog_envelope: { min_x: number; max_x: number; min_y: number; max_y: number; max_z: number };
  };
  units: Array<{
    hu_code: string;
    length_m: number;
    width_m: number;
    height_m: number;
    gross_weight_kg: number;
    stop_code: string;
    stop_seq: number;
    rotation: "fixed" | "yaw";
    floor_only: boolean;
  }>;
  fixed_placements: Array<{
    hu_code: string;
    x: number;
    y: number;
    z: number;
    length_m: number;
    width_m: number;
    height_m: number;
  }>;
};

export type TruckLoadSolveResult = {
  run_id: string;
  status: "feasible" | "infeasible" | "failed";
  solution_quality: "feasible" | "none";
  solver_version: string;
  solve_duration_ms: number;
  positions: Array<{
    hu_code: string;
    x: number;
    y: number;
    z: number;
    length_m: number;
    width_m: number;
    height_m: number;
    seq: number;
  }>;
  unplaced_hu_codes: string[];
  infeasibility_reasons: string[];
  relaxation_options: string[];
  diagnostics: Record<string, number>;
};

export async function solveTruckLoad(
  request: TruckLoadSolveRequest,
): Promise<TruckLoadSolveResult> {
  const response = await fetch(`${config.OPTIMIZER_URL}/solve/truck-load`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(request.time_limit_ms + 10_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Optimizer HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  return (await response.json()) as TruckLoadSolveResult;
}
