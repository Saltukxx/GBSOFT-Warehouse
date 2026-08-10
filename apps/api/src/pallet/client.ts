import { config } from "../config.js";

/**
 * Palet paketleme çözücüsünün HTTP istemcisi.
 *
 * Sözleşme `services/optimizer/src/gbsoft_optimizer/pallet/models.py` ile
 * birebirdir; alan adları Python tarafındaki snake_case biçimini korur.
 */

export type PalletSolveRequest = {
  run_id: string;
  seed: number;
  time_limit_ms: number;
  base: {
    package_type_code: string;
    length_m: number;
    width_m: number;
    deck_height_m: number;
    max_height_m: number;
    max_weight_kg: number;
  };
  package_types: Array<{
    code: string;
    length_m: number;
    width_m: number;
    height_m: number;
    rotation: "fixed" | "yaw" | "any";
    max_top_load_kg: number;
    min_support_ratio: number;
    stackable: boolean;
    fragile: boolean;
    temperature_class: "ambient" | "chilled" | "frozen";
    segregation_group: string | null;
  }>;
  items: Array<{
    hu_code: string;
    package_type_code: string;
    gross_weight_kg: number;
    stop_code: string | null;
  }>;
  fixed_placements: Array<{
    hu_code: string;
    pallet_seq: number;
    x: number;
    y: number;
    z: number;
    length_m: number;
    width_m: number;
    height_m: number;
    seq: number;
  }>;
};

export type PalletSolveResult = {
  run_id: string;
  status: "feasible" | "infeasible" | "failed";
  solution_quality: "feasible" | "none";
  solver_version: string;
  solve_duration_ms: number;
  pallets: Array<{
    seq: number;
    used_height_m: number;
    used_weight_kg: number;
    volume_utilization_pct: number;
    footprint_utilization_pct: number;
    placements: Array<{
      hu_code: string;
      package_type_code: string;
      x: number;
      y: number;
      z: number;
      length_m: number;
      width_m: number;
      height_m: number;
      gross_weight_kg: number;
      layer: number;
      seq: number;
    }>;
  }>;
  unplaced_hu_codes: string[];
  lower_bound_pallets: number;
  infeasibility_reasons: string[];
  relaxation_options: string[];
  diagnostics: Record<string, number>;
};

export async function solvePallet(
  request: PalletSolveRequest,
): Promise<PalletSolveResult> {
  const response = await fetch(`${config.OPTIMIZER_URL}/solve/pallet`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(request.time_limit_ms + 10_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Optimizer HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  return (await response.json()) as PalletSolveResult;
}
