from __future__ import annotations

import math
import time
from collections import Counter
from typing import Dict, List, Tuple

from ortools.sat.python import cp_model

from .models import (
    AssignmentResult,
    LocationInput,
    SkuInput,
    SolveRequest,
    SolveResponse,
)


SOLVER_VERSION = "slot-cp-1.0.0"
COST_SCALE = 100


def _compatible(sku: SkuInput, location: LocationInput, blocked: set[str]) -> bool:
    if location.blocked or location.id in blocked:
        return False
    if sku.weight_kg > location.max_weight_kg:
        return False
    if sku.volume_m3 > location.max_volume_m3:
        return False
    if location.equipment not in sku.allowed_equipment:
        return False
    if sku.allowed_zones and location.zone not in sku.allowed_zones:
        return False
    return True


def _assignment_cost(
    sku: SkuInput,
    location: LocationInput,
    request: SolveRequest,
) -> int:
    weights = request.weights
    picking = location.expected_pick_sec * sku.picks_per_day * weights.picking_time
    replenishment = (
        sku.replenishments_per_day
        * location.distance_to_dock_m
        * 2
        * weights.replenishment
    )
    congestion = (
        location.congestion_score
        * location.expected_pick_sec
        * sku.picks_per_day
        * weights.congestion
    )
    relocation = (
        900 * weights.move_cost
        if sku.current_location_id and sku.current_location_id != location.id
        else 0
    )
    ergonomics = (
        sku.picks_per_day * 3 * weights.ergonomics if not location.golden_zone else 0
    )
    return max(0, round((picking + replenishment + congestion + relocation + ergonomics) * COST_SCALE))


def _direct_infeasible(
    request: SolveRequest,
    reasons: List[str],
    excluded: List[str],
    diagnostics: Dict[str, int],
) -> SolveResponse:
    options: List[str] = []
    if any("uygun lokasyon" in reason for reason in reasons):
        options.append("Kapasite, ekipman veya zon kısıtlarını gözden geçir")
    if any("kilit" in reason.lower() for reason in reasons):
        options.append("Çakışan kilitleri kaldır veya hedef gözleri değiştir")
    if any("göz" in reason and "fazla" in reason for reason in reasons):
        options.append("Plan kapsamını daralt veya ek pick gözü tanımla")
    return SolveResponse(
        run_id=request.run_id,
        status="infeasible",
        solution_quality="none",
        solver_version=SOLVER_VERSION,
        solve_duration_ms=0,
        excluded_sku_ids=excluded,
        infeasibility_reasons=reasons,
        relaxation_options=options,
        diagnostics=diagnostics,
    )


def solve_slotting(request: SolveRequest) -> SolveResponse:
    started = time.perf_counter()
    excluded = set(request.excluded_sku_ids)
    plan_skus = [sku for sku in request.skus if sku.id not in excluded]
    locations = {location.id: location for location in request.locations}
    skus = {sku.id: sku for sku in plan_skus}
    blocked = set(request.blocked_location_ids)

    diagnostics: Dict[str, int] = {
        "inputSkuCount": len(request.skus),
        "plannedSkuCount": len(plan_skus),
        "locationCount": len(request.locations),
        "excludedSkuCount": len(excluded),
    }
    direct_reasons: List[str] = []
    if len(plan_skus) > len(request.locations):
        direct_reasons.append(
            f"Planlanacak {len(plan_skus)} SKU için yalnız {len(request.locations)} göz var; SKU sayısı göz sayısından fazla."
        )

    candidate_locations: Dict[str, List[str]] = {}
    cost: Dict[Tuple[str, str], int] = {}
    for sku in plan_skus:
        candidates = [
            location.id
            for location in request.locations
            if _compatible(sku, location, blocked)
        ]
        candidate_locations[sku.id] = candidates
        for location_id in candidates:
            cost[(sku.id, location_id)] = _assignment_cost(
                sku, locations[location_id], request
            )
        if not candidates:
            direct_reasons.append(
                f"{sku.id} için kapasite, ekipman, zon ve blokaj kurallarını geçen uygun lokasyon yok."
            )

    lock_by_sku = {lock.sku_id: lock.location_id for lock in request.locked_assignments}
    for sku_id, location_id in lock_by_sku.items():
        if sku_id not in skus:
            direct_reasons.append(f"Kilitli {sku_id} SKU'su plan kapsamında değil.")
        elif location_id not in candidate_locations[sku_id]:
            direct_reasons.append(
                f"{sku_id} kilidi {location_id} gözüne uygulanamaz; hedef hard constraint'leri geçmiyor."
            )

    if direct_reasons:
        return _direct_infeasible(
            request, direct_reasons, sorted(excluded), diagnostics
        )

    model = cp_model.CpModel()
    variables: Dict[Tuple[str, str], cp_model.IntVar] = {}
    for sku in plan_skus:
        for location_id in candidate_locations[sku.id]:
            variables[(sku.id, location_id)] = model.new_bool_var(
                f"x__{sku.id}__{location_id}"
            )

    for sku in plan_skus:
        model.add_exactly_one(
            variables[(sku.id, location_id)]
            for location_id in candidate_locations[sku.id]
        )
    for location_id in locations:
        at_location = [
            variable
            for (sku_id, candidate_id), variable in variables.items()
            if candidate_id == location_id
        ]
        if at_location:
            model.add_at_most_one(at_location)

    assumptions: Dict[int, Tuple[str, str]] = {}

    def assumption(code: str, message: str) -> cp_model.IntVar:
        literal = model.new_bool_var(f"assume__{code}")
        model.add_assumption(literal)
        assumptions[literal.index] = (code, message)
        return literal

    for sku_id, location_id in sorted(lock_by_sku.items()):
        literal = assumption(
            f"lock__{sku_id}", f"{sku_id} → {location_id} kilidi diğer kısıtlarla çakışıyor."
        )
        model.add(variables[(sku_id, location_id)] == 1).only_enforce_if(literal)

    location_zone = {location.id: location.zone for location in request.locations}
    for sku in plan_skus:
        if (
            sku.current_location_id
            and location_zone.get(sku.current_location_id) in request.frozen_zones
        ):
            if sku.current_location_id not in candidate_locations[sku.id]:
                return _direct_infeasible(
                    request,
                    [
                        f"{sku.id} donmuş zonda ancak mevcut {sku.current_location_id} gözü hard constraint'leri geçmiyor."
                    ],
                    sorted(excluded),
                    diagnostics,
                )
            literal = assumption(
                f"freeze__{sku.id}",
                f"{sku.id} için {location_zone[sku.current_location_id]} freeze-zone kuralı çakışıyor.",
            )
            model.add(
                variables[(sku.id, sku.current_location_id)] == 1
            ).only_enforce_if(literal)

        if sku.fixed_location_id:
            if sku.fixed_location_id not in candidate_locations[sku.id]:
                return _direct_infeasible(
                    request,
                    [
                        f"{sku.id} fixed-slot hedefi {sku.fixed_location_id} hard constraint'leri geçmiyor."
                    ],
                    sorted(excluded),
                    diagnostics,
                )
            literal = assumption(
                f"fixed__{sku.id}",
                f"{sku.id} fixed-slot kuralı {sku.fixed_location_id} hedefinde çakışıyor.",
            )
            model.add(variables[(sku.id, sku.fixed_location_id)] == 1).only_enforce_if(
                literal
            )

    move_terms = []
    for sku in plan_skus:
        if not sku.current_location_id:
            continue
        move_terms.extend(
            variable
            for (sku_id, location_id), variable in variables.items()
            if sku_id == sku.id and location_id != sku.current_location_id
        )
    move_assumption = assumption(
        "move_budget",
        f"Move budget {request.move_budget} görevle uygulanabilir plan için yetersiz.",
    )
    model.add(sum(move_terms) <= request.move_budget).only_enforce_if(move_assumption)

    objective_terms = [
        assignment_cost * variables[(sku_id, location_id)]
        for (sku_id, location_id), assignment_cost in cost.items()
    ]
    total_cost = sum(objective_terms)

    baseline = 0
    for sku in plan_skus:
        current = sku.current_location_id
        if current in candidate_locations[sku.id]:
            baseline += cost[(sku.id, current)]
        else:
            baseline += min(cost[(sku.id, location_id)] for location_id in candidate_locations[sku.id])

    if request.min_net_benefit_pct > 0 and baseline > 0:
        benefit_assumption = assumption(
            "minimum_benefit",
            f"Minimum net fayda %{request.min_net_benefit_pct:g} mevcut kısıtlarla sağlanamıyor.",
        )
        maximum_cost = math.floor(
            baseline * (1 - request.min_net_benefit_pct / 100)
        )
        model.add(total_cost <= maximum_cost).only_enforce_if(benefit_assumption)

    model.minimize(total_cost)

    # Warm start: mevcut plan mümkün olduğu ölçüde başlangıç çözümüdür.
    for sku in plan_skus:
        for location_id in candidate_locations[sku.id]:
            model.add_hint(
                variables[(sku.id, location_id)],
                1 if sku.current_location_id == location_id else 0,
            )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = request.time_limit_ms / 1000
    solver.parameters.random_seed = request.seed
    solver.parameters.num_search_workers = 1
    solver.parameters.log_search_progress = False

    status_code = solver.solve(model)
    duration_ms = round((time.perf_counter() - started) * 1000)

    if status_code == cp_model.INFEASIBLE:
        core = solver.sufficient_assumptions_for_infeasibility()
        reasons = [
            assumptions[index][1]
            for index in core
            if index in assumptions
        ]
        if not reasons:
            reasons = ["Hard constraint kümesi birlikte uygulanabilir değil."]
        options = []
        codes = {assumptions[index][0] for index in core if index in assumptions}
        if "move_budget" in codes:
            options.append("Move budget'ı artır")
        if "minimum_benefit" in codes:
            options.append("Minimum net fayda eşiğini düşür")
        if any(code.startswith("lock__") for code in codes):
            options.append("Kilitli atamaları incele")
        if any(code.startswith("freeze__") for code in codes):
            options.append("Freeze zone kapsamını daralt")
        return SolveResponse(
            run_id=request.run_id,
            status="infeasible",
            solution_quality="none",
            solver_version=SOLVER_VERSION,
            solve_duration_ms=duration_ms,
            baseline_objective=baseline / COST_SCALE,
            excluded_sku_ids=sorted(excluded),
            infeasibility_reasons=reasons,
            relaxation_options=options,
            diagnostics=diagnostics,
        )

    if status_code not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        status = "timeout" if status_code == cp_model.UNKNOWN else "failed"
        return SolveResponse(
            run_id=request.run_id,
            status=status,
            solution_quality="none",
            solver_version=SOLVER_VERSION,
            solve_duration_ms=duration_ms,
            baseline_objective=baseline / COST_SCALE,
            excluded_sku_ids=sorted(excluded),
            infeasibility_reasons=[
                "Zaman sınırı içinde uygulanabilir çözüm bulunamadı."
                if status == "timeout"
                else "Solver modeli geçersiz veya çalıştırma başarısız."
            ],
            relaxation_options=["Zaman sınırını artır"] if status == "timeout" else [],
            diagnostics=diagnostics,
        )

    objective_value = solver.objective_value
    best_bound = solver.best_objective_bound
    gap_pct = (
        abs(objective_value - best_bound) / max(1, abs(objective_value)) * 100
    )
    assignments: List[AssignmentResult] = []
    for sku in sorted(plan_skus, key=lambda item: item.id):
        target_id = next(
            location_id
            for location_id in candidate_locations[sku.id]
            if solver.value(variables[(sku.id, location_id)]) == 1
        )
        alternatives = sorted(
            (
                (cost[(sku.id, location_id)], location_id)
                for location_id in candidate_locations[sku.id]
                if location_id != target_id
            ),
            key=lambda item: (item[0], item[1]),
        )[:3]
        assignments.append(
            AssignmentResult(
                sku_id=sku.id,
                source_location_id=sku.current_location_id,
                target_location_id=target_id,
                moved=bool(
                    sku.current_location_id and sku.current_location_id != target_id
                ),
                cost=cost[(sku.id, target_id)] / COST_SCALE,
                expected_pick_sec=locations[target_id].expected_pick_sec,
                alternatives=[location_id for _, location_id in alternatives],
            )
        )

    move_count = sum(assignment.moved for assignment in assignments)
    objective_delta_pct = (
        (baseline - objective_value) / baseline * 100 if baseline > 0 else 0
    )
    diagnostics["candidateVariableCount"] = len(variables)
    diagnostics["moveCount"] = move_count
    return SolveResponse(
        run_id=request.run_id,
        status="optimal" if status_code == cp_model.OPTIMAL else "feasible",
        solution_quality="optimal" if status_code == cp_model.OPTIMAL else "feasible",
        solver_version=SOLVER_VERSION,
        solve_duration_ms=duration_ms,
        objective_value=objective_value / COST_SCALE,
        baseline_objective=baseline / COST_SCALE,
        objective_delta_pct=round(objective_delta_pct, 3),
        gap_pct=round(gap_pct, 3),
        hard_violations=0,
        move_count=move_count,
        assignments=assignments,
        excluded_sku_ids=sorted(excluded),
        diagnostics=diagnostics,
    )
