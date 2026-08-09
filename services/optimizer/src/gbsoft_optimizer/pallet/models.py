"""Palet planlama isteği ve yanıtı (Faz 7).

Ölçüler metre, ağırlıklar kilogramdır — @gbsoft/domain ile aynı sözleşme.
Paket profilleri istekle birlikte gelir; çözücü kendi varsayılan tablosunu
tutmaz, aksi hâlde alan modeliyle iki ayrı gerçek doğardı.
"""

from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


RotationMode = Literal["fixed", "yaw", "any"]
TemperatureClass = Literal["ambient", "chilled", "frozen"]


class PackageProfile(BaseModel):
    code: str
    length_m: float = Field(gt=0)
    width_m: float = Field(gt=0)
    height_m: float = Field(gt=0)
    rotation: RotationMode = "yaw"
    max_top_load_kg: float = Field(0, ge=0)
    min_support_ratio: float = Field(0.75, ge=0, le=1)
    stackable: bool = True
    fragile: bool = False
    temperature_class: TemperatureClass = "ambient"
    segregation_group: Optional[str] = None


class ItemInput(BaseModel):
    hu_code: str
    package_type_code: str
    gross_weight_kg: float = Field(gt=0)
    #: Sevkiyat durağı — Faz 8'de araç içi yerleşimin girdisi.
    stop_code: Optional[str] = None


class PalletBaseInput(BaseModel):
    package_type_code: str
    length_m: float = Field(gt=0)
    width_m: float = Field(gt=0)
    deck_height_m: float = Field(0, ge=0)
    #: Palet + yük için izin verilen toplam yükseklik.
    max_height_m: float = Field(gt=0)
    #: Paletin taşıyabileceği net yük.
    max_weight_kg: float = Field(gt=0)


class PalletizeRequest(BaseModel):
    run_id: str
    seed: int = 42
    time_limit_ms: int = Field(10_000, ge=50, le=120_000)
    base: PalletBaseInput
    package_types: List[PackageProfile] = Field(min_length=1)
    items: List[ItemInput] = Field(min_length=1)

    @model_validator(mode="after")
    def check_references(self) -> "PalletizeRequest":
        known = {profile.code for profile in self.package_types}
        missing = sorted({item.package_type_code for item in self.items} - known)
        if missing:
            raise ValueError(f"Paket profili eksik: {', '.join(missing)}")
        codes = [item.hu_code for item in self.items]
        if len(codes) != len(set(codes)):
            raise ValueError("Elleçleme birimi kimlikleri benzersiz olmalı")
        return self


class PlacementResult(BaseModel):
    hu_code: str
    package_type_code: str
    x: float
    y: float
    z: float
    length_m: float
    width_m: float
    height_m: float
    gross_weight_kg: float
    layer: int
    #: Yerleştirme sırası. Destekleyen kutu üstündekinden önce gelir;
    #: yükleme talimatı ve Faz 8 precedence grafı bunu kullanır.
    seq: int


class PalletResult(BaseModel):
    seq: int
    placements: List[PlacementResult] = Field(default_factory=list)
    used_height_m: float
    used_weight_kg: float
    volume_utilization_pct: float
    footprint_utilization_pct: float


class PalletizeResponse(BaseModel):
    run_id: str
    status: Literal["feasible", "infeasible", "failed"]
    #: Sezgisel paketleme kanıtlanmış optimum vermez; bu alan asla
    #: "optimal" olmaz.
    solution_quality: Literal["feasible", "none"]
    solver_version: str
    solve_duration_ms: int
    pallets: List[PalletResult] = Field(default_factory=list)
    #: Hiçbir palete sığmayan birimler — sessizce düşürülmez.
    unplaced_hu_codes: List[str] = Field(default_factory=list)
    #: Kullanılan palet sayısı için geçerli bir alt sınır (hacim/ağırlık).
    lower_bound_pallets: int = 0
    infeasibility_reasons: List[str] = Field(default_factory=list)
    relaxation_options: List[str] = Field(default_factory=list)
    diagnostics: Dict[str, int] = Field(default_factory=dict)
