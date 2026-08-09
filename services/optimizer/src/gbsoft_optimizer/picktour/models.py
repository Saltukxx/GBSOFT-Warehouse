"""Toplama turu isteği ve yanıtı (Faz 6.5).

Sözleşme bilinçli olarak "süre" üzerine kuruludur, mesafe üzerine değil.
Kullanıcının sorusu «en hızlı yükleme» olduğu için maliyet fonksiyonu da
saniyedir. Mesafe yalnız raporlanır.
"""

from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


Equipment = Literal["manual", "cart", "forklift"]
TourObjective = Literal["makespan", "total"]


class TourStopInput(BaseModel):
    """Toplanacak tek satır."""

    id: str
    sku_id: str
    quantity: int = Field(ge=1)
    volume_m3: float = Field(ge=0)
    weight_kg: float = Field(ge=0)
    #: Durakta geçen toplama süresi — @gbsoft/domain'deki `pickStopSec` çıktısı.
    #: Solver bu sayıyı yeniden hesaplamaz; arayüzle aynı modeli kullanır.
    pick_sec: float = Field(gt=0)
    #: 0-1 arası; bu durağa giden bacağa uygulanır.
    congestion_score: float = Field(0, ge=0, le=1)


class PickTourRequest(BaseModel):
    run_id: str
    seed: int = 42
    time_limit_ms: int = Field(10_000, ge=50, le=120_000)
    #: Yerel arama bu kadar çözümde durur. Determinizmin kaynağı budur;
    #: duvar saati sınırı yalnız emniyet supabıdır.
    solution_limit: int = Field(80, ge=1, le=10_000)

    equipment: Equipment
    vehicle_count: int = Field(ge=1, le=64)
    capacity_volume_m3: float = Field(gt=0)
    capacity_weight_kg: float = Field(gt=0)
    speed_mps: float = Field(gt=0)
    objective: TourObjective = "makespan"

    #: Tur başına sabit yükler (sn).
    setup_sec: float = Field(0, ge=0)
    deposit_sec: float = Field(0, ge=0)
    deposit_per_unit_sec: float = Field(0, ge=0)
    congestion_factor: float = Field(0, ge=0)

    #: (n+1)x(n+1) graf mesafe matrisi (m). 0. indeks dock'tur.
    distance_m: List[List[float]]
    stops: List[TourStopInput] = Field(min_length=1)

    @model_validator(mode="after")
    def check_shape(self) -> "PickTourRequest":
        size = len(self.stops) + 1
        if len(self.distance_m) != size:
            raise ValueError(
                f"Mesafe matrisi {size}x{size} olmalı; {len(self.distance_m)} satır geldi"
            )
        for row in self.distance_m:
            if len(row) != size:
                raise ValueError("Mesafe matrisi kare olmalı")
        ids = [stop.id for stop in self.stops]
        if len(ids) != len(set(ids)):
            raise ValueError("Durak kimlikleri benzersiz olmalı")
        return self


class TourStopResult(BaseModel):
    seq: int
    location_id: str
    sku_id: str
    quantity: int
    distance_m: float
    travel_sec: float
    congestion_sec: float
    pick_sec: float
    #: Turun başından bu durak bitene kadar geçen süre.
    cumulative_sec: float


class TourResult(BaseModel):
    seq: int
    stops: List[TourStopResult] = Field(default_factory=list)
    distance_m: float
    travel_sec: float
    congestion_sec: float
    pick_sec: float
    setup_sec: float
    deposit_sec: float
    total_sec: float
    volume_m3: float
    weight_kg: float


class PickTourResponse(BaseModel):
    run_id: str
    status: Literal["feasible", "infeasible", "timeout", "failed"]
    #: Routing kanıtlanmış optimum vermez; bu alan hiçbir koşulda "optimal"
    #: olmaz. Faz 4'te slotting için konan dürüstlük kuralının aynısı.
    solution_quality: Literal["feasible", "none"]
    solver_version: str
    solve_duration_ms: int
    #: En geç biten turun süresi — «en hızlı yükleme»nin ölçüsü.
    makespan_sec: float = 0
    #: Bütün turların toplam süresi (iş gücü maliyeti).
    total_sec: float = 0
    #: Makespan için geçerli bir alt sınır. Optimum iddiası değildir;
    #: çözümün bu sınıra ne kadar yakın olduğunu göstermeye yarar.
    lower_bound_sec: float = 0
    tours: List[TourResult] = Field(default_factory=list)
    unassigned_stop_ids: List[str] = Field(default_factory=list)
    infeasibility_reasons: List[str] = Field(default_factory=list)
    relaxation_options: List[str] = Field(default_factory=list)
    diagnostics: Dict[str, int] = Field(default_factory=dict)
    stopped_by: Optional[Literal["solution-limit", "time-limit"]] = None
