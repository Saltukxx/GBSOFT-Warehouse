"""Rota-duyarlı araç yükleme istek/yanıt sözleşmesi (Faz 8.2)."""

from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class RearDoorInput(BaseModel):
    width_m: float = Field(gt=0)
    height_m: float = Field(gt=0)
    sill_height_m: float = Field(ge=0)


class AxleGroupInput(BaseModel):
    code: str
    label: str
    position_x: float = Field(ge=0)
    empty_load_kg: float = Field(ge=0)
    max_load_kg: float = Field(gt=0)
    #: Yere basmayan mesnet: kingpin yükü beşinci teker üzerinden çekiciye
    #: aktarır ve asıl yasal sınırlar orada uygulanır.
    coupling: bool = False


class TractorAxleInput(BaseModel):
    code: str
    label: str
    #: Römorkun x ekseninde; yönlendirme dingili ön duvarın önünde olduğu
    #: için negatif olabilir.
    position_x: float
    tare_load_kg: float = Field(ge=0)
    max_load_kg: float = Field(gt=0)
    driven: bool = False
    steering: bool = False


class TractorInput(BaseModel):
    code: str
    label: str
    tare_kg: float = Field(ge=0)
    axles: List[TractorAxleInput] = Field(min_length=2)


class RegulationInput(BaseModel):
    max_combination_weight_kg: float = Field(gt=0)
    min_drive_axle_share: Optional[float] = None
    min_steer_axle_share: Optional[float] = None


class ObstacleInput(BaseModel):
    code: str
    label: str
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    z: float = Field(ge=0)
    length_m: float = Field(gt=0)
    width_m: float = Field(gt=0)
    height_m: float = Field(gt=0)


class CogEnvelopeInput(BaseModel):
    min_x: float = Field(ge=0)
    max_x: float = Field(gt=0)
    min_y: float = Field(ge=0)
    max_y: float = Field(gt=0)
    max_z: float = Field(gt=0)


class VehicleInput(BaseModel):
    code: str
    internal_length_m: float = Field(gt=0)
    internal_width_m: float = Field(gt=0)
    internal_height_m: float = Field(gt=0)
    rear_door: RearDoorInput
    max_payload_kg: float = Field(gt=0)
    axle_groups: List[AxleGroupInput] = Field(min_length=2)
    tractor: Optional[TractorInput] = None
    regulation: Optional[RegulationInput] = None
    obstacles: List[ObstacleInput] = Field(default_factory=list)
    cog_envelope: CogEnvelopeInput


class LoadUnitInput(BaseModel):
    hu_code: str
    length_m: float = Field(gt=0)
    width_m: float = Field(gt=0)
    height_m: float = Field(gt=0)
    gross_weight_kg: float = Field(gt=0)
    stop_code: str
    stop_seq: int = Field(ge=1)
    rotation: Literal["fixed", "yaw"] = "yaw"
    floor_only: bool = True


class FixedLoadPlacementInput(BaseModel):
    hu_code: str
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    z: float = Field(ge=0)
    length_m: float = Field(gt=0)
    width_m: float = Field(gt=0)
    height_m: float = Field(gt=0)


class TruckLoadRequest(BaseModel):
    run_id: str
    seed: int = 42
    time_limit_ms: int = Field(10_000, ge=100, le=120_000)
    vehicle: VehicleInput
    units: List[LoadUnitInput] = Field(min_length=1)
    fixed_placements: List[FixedLoadPlacementInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def unique_units(self) -> "TruckLoadRequest":
        codes = [unit.hu_code for unit in self.units]
        if len(codes) != len(set(codes)):
            raise ValueError("Elleçleme birimi kodları benzersiz olmalı")
        fixed_codes = [placement.hu_code for placement in self.fixed_placements]
        if len(fixed_codes) != len(set(fixed_codes)):
            raise ValueError("Sabit yerleşim kodları benzersiz olmalı")
        unknown = sorted(set(fixed_codes) - set(codes))
        if unknown:
            raise ValueError("Sabit yerleşimde bilinmeyen birim: " + ", ".join(unknown[:10]))
        return self


class LoadPositionResult(BaseModel):
    hu_code: str
    x: float
    y: float
    z: float
    length_m: float
    width_m: float
    height_m: float
    seq: int


class TruckLoadResponse(BaseModel):
    run_id: str
    status: Literal["feasible", "infeasible", "failed"]
    solution_quality: Literal["feasible", "none"]
    solver_version: str
    solve_duration_ms: int
    positions: List[LoadPositionResult] = Field(default_factory=list)
    unplaced_hu_codes: List[str] = Field(default_factory=list)
    infeasibility_reasons: List[str] = Field(default_factory=list)
    relaxation_options: List[str] = Field(default_factory=list)
    diagnostics: Dict[str, float] = Field(default_factory=dict)
