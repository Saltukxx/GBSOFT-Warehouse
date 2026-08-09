from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


Equipment = Literal["manual", "cart", "forklift"]


class ObjectiveWeights(BaseModel):
    picking_time: float = Field(1.0, ge=0)
    replenishment: float = Field(0.55, ge=0)
    congestion: float = Field(0.7, ge=0)
    move_cost: float = Field(0.25, ge=0)
    ergonomics: float = Field(0.2, ge=0)


class LocationInput(BaseModel):
    id: str
    zone: str
    max_weight_kg: float = Field(gt=0)
    max_volume_m3: float = Field(gt=0)
    equipment: Equipment
    blocked: bool = False
    distance_to_dock_m: float = Field(ge=0)
    expected_pick_sec: float = Field(gt=0)
    congestion_score: float = Field(ge=0, le=1)
    golden_zone: bool = False


class SkuInput(BaseModel):
    id: str
    weight_kg: float = Field(gt=0)
    volume_m3: float = Field(gt=0)
    allowed_equipment: List[Equipment] = Field(min_length=1)
    allowed_zones: List[str] = Field(default_factory=list)
    current_location_id: Optional[str] = None
    fixed_location_id: Optional[str] = None
    picks_per_day: float = Field(ge=0)
    replenishments_per_day: float = Field(ge=0)


class LockedAssignment(BaseModel):
    sku_id: str
    location_id: str


class SolveRequest(BaseModel):
    run_id: str
    seed: int = 42
    time_limit_ms: int = Field(5000, ge=50, le=120_000)
    move_budget: int = Field(30, ge=0)
    min_net_benefit_pct: float = Field(0, ge=0, le=100)
    weights: ObjectiveWeights = Field(default_factory=ObjectiveWeights)
    skus: List[SkuInput] = Field(min_length=1)
    locations: List[LocationInput] = Field(min_length=1)
    locked_assignments: List[LockedAssignment] = Field(default_factory=list)
    excluded_sku_ids: List[str] = Field(default_factory=list)
    blocked_location_ids: List[str] = Field(default_factory=list)
    frozen_zones: List[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def unique_ids(self) -> "SolveRequest":
        sku_ids = [sku.id for sku in self.skus]
        location_ids = [location.id for location in self.locations]
        if len(sku_ids) != len(set(sku_ids)):
            raise ValueError("SKU kimlikleri benzersiz olmalı")
        if len(location_ids) != len(set(location_ids)):
            raise ValueError("Lokasyon kimlikleri benzersiz olmalı")
        return self


class AssignmentResult(BaseModel):
    sku_id: str
    source_location_id: Optional[str]
    target_location_id: str
    moved: bool
    cost: float
    expected_pick_sec: float
    alternatives: List[str] = Field(default_factory=list)


class SolveResponse(BaseModel):
    run_id: str
    status: Literal["optimal", "feasible", "infeasible", "timeout", "failed"]
    solution_quality: Literal["optimal", "feasible", "none"]
    solver_version: str
    solve_duration_ms: int
    objective_value: Optional[float] = None
    baseline_objective: Optional[float] = None
    objective_delta_pct: float = 0
    gap_pct: Optional[float] = None
    hard_violations: int = 0
    move_count: int = 0
    assignments: List[AssignmentResult] = Field(default_factory=list)
    excluded_sku_ids: List[str] = Field(default_factory=list)
    infeasibility_reasons: List[str] = Field(default_factory=list)
    relaxation_options: List[str] = Field(default_factory=list)
    diagnostics: Dict[str, int] = Field(default_factory=dict)
