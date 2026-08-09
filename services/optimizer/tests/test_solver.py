from __future__ import annotations

from gbsoft_optimizer.models import (
    LocationInput,
    LockedAssignment,
    SkuInput,
    SolveRequest,
)
from gbsoft_optimizer.solver import solve_slotting


def location(index: int, *, blocked: bool = False, capacity: float = 100) -> LocationInput:
    return LocationInput(
        id=f"L-{index:03d}",
        zone="A" if index < 48 else "B",
        max_weight_kg=capacity,
        max_volume_m3=2,
        equipment="manual",
        blocked=blocked,
        distance_to_dock_m=10 + index,
        expected_pick_sec=40 + index / 2,
        congestion_score=(index % 8) / 10,
        golden_zone=index % 3 == 0,
    )


def sku(index: int, current: str | None) -> SkuInput:
    return SkuInput(
        id=f"SKU-{index:03d}",
        weight_kg=2,
        volume_m3=0.1,
        allowed_equipment=["manual"],
        current_location_id=current,
        picks_per_day=max(1, 100 - index),
        replenishments_per_day=0.2,
    )


def golden_request(**patch) -> SolveRequest:
    locations = [location(index) for index in range(96)]
    active = [sku(index, locations[index].id) for index in range(90)]
    reserve = [sku(index, None) for index in range(90, 184)]
    values = dict(
        run_id="RUN-1",
        seed=42,
        time_limit_ms=5000,
        move_budget=30,
        min_net_benefit_pct=0,
        skus=active + reserve,
        locations=locations,
        excluded_sku_ids=[item.id for item in reserve],
    )
    values.update(patch)
    return SolveRequest(**values)


def test_golden_snapshot_is_feasible_under_five_seconds():
    result = solve_slotting(golden_request())
    assert result.status in ("optimal", "feasible")
    assert result.solve_duration_ms < 5000
    assert result.hard_violations == 0
    assert len(result.assignments) == 90
    assert len({assignment.target_location_id for assignment in result.assignments}) == 90
    assert result.move_count <= 30


def test_same_seed_is_deterministic_and_lock_is_preserved():
    request = golden_request(
        locked_assignments=[LockedAssignment(sku_id="SKU-010", location_id="L-020")]
    )
    first = solve_slotting(request)
    second = solve_slotting(request)
    assert first.status in ("optimal", "feasible")
    assert [(a.sku_id, a.target_location_id) for a in first.assignments] == [
        (a.sku_id, a.target_location_id) for a in second.assignments
    ]
    locked = next(item for item in first.assignments if item.sku_id == "SKU-010")
    assert locked.target_location_id == "L-020"


def test_blocked_and_capacity_incompatible_locations_are_never_selected():
    locations = [
        location(0, blocked=True),
        location(1, capacity=1),
        location(2),
    ]
    request = SolveRequest(
        run_id="RUN-HARD",
        move_budget=1,
        skus=[sku(0, "L-002")],
        locations=locations,
    )
    result = solve_slotting(request)
    assert result.status in ("optimal", "feasible")
    assert result.assignments[0].target_location_id == "L-002"


def test_conflicting_locks_return_actionable_infeasibility_core():
    request = SolveRequest(
        run_id="RUN-INF",
        move_budget=2,
        skus=[sku(0, "L-000"), sku(1, "L-001")],
        locations=[location(0), location(1)],
        locked_assignments=[
            LockedAssignment(sku_id="SKU-000", location_id="L-000"),
            LockedAssignment(sku_id="SKU-001", location_id="L-000"),
        ],
    )
    result = solve_slotting(request)
    assert result.status == "infeasible"
    assert result.solution_quality == "none"
    assert any("kilidi" in reason for reason in result.infeasibility_reasons)
    assert "Kilitli atamaları incele" in result.relaxation_options


def test_freeze_zone_keeps_current_assignment():
    request = SolveRequest(
        run_id="RUN-FREEZE",
        move_budget=2,
        frozen_zones=["A"],
        skus=[sku(0, "L-001")],
        locations=[location(0), location(1)],
    )
    result = solve_slotting(request)
    assert result.status in ("optimal", "feasible")
    assert result.assignments[0].target_location_id == "L-001"
