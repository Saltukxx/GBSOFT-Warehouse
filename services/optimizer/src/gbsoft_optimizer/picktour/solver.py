"""Toplama turu çözücüsü — kapasiteli araç rotalama (Faz 6.5).

Neden CP-SAT değil de OR-Tools Routing? Kapasiteli çok araçlı turlama tam
olarak routing kütüphanesinin problemidir; CP-SAT'ta elle modellemek hem
yavaş hem kırılgan olurdu. İkisi de aynı `ortools` paketindedir.

Dürüstlük: routing kanıtlanmış optimum vermez. Bu modül hiçbir koşulda
"optimal" demez; `feasible` döner ve makespan için gerçek bir alt sınır
raporlar. Faz 4'te slotting için konan kural buraya da geçerlidir.

Determinizm: yerel arama duvar saatiyle değil **çözüm sayısıyla** durdurulur.
Duvar saati sınırı yalnız emniyet supabıdır; ona takılırsa yanıt bunu
`stopped_by: time-limit` ile söyler ve tekrar üretilebilirlik iddia edilmez.
"""

from __future__ import annotations

import time
from typing import List

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from .models import (
    PickTourRequest,
    PickTourResponse,
    TourResult,
    TourStopResult,
)

SOLVER_VERSION = "pick-tour-routing-1.0.0"

#: Süreler tam sayıya ölçeklenir; routing yalnız tam sayı maliyetle çalışır.
#: Milisaniye çözünürlük depo ölçeğinde fazlasıyla yeterli.
TIME_SCALE = 1_000
#: Hacim m³ → mm³ mertebesinde tam sayı.
VOLUME_SCALE = 1_000_000
#: Ağırlık kg → g.
WEIGHT_SCALE = 1_000


def _travel_sec(request: PickTourRequest, i: int, j: int) -> float:
    return request.distance_m[i][j] / request.speed_mps


def _congestion_sec(request: PickTourRequest, i: int, j: int) -> float:
    """Yoğunluk yalnız bir durağa **giden** bacakta uygulanır.

    Dock'a dönüş dolu araçla yapılan bir omurga hareketidir ve koridor
    trafiğinden bağımsız sayılır — alan modelindeki kuralın aynısı.
    """
    if j == 0:
        return 0.0
    stop = request.stops[j - 1]
    return _travel_sec(request, i, j) * stop.congestion_score * request.congestion_factor


def _service_sec(request: PickTourRequest, j: int) -> float:
    """Durakta geçen süre: toplama + bırakmanın birim başına değişen kısmı."""
    if j == 0:
        return 0.0
    stop = request.stops[j - 1]
    return stop.pick_sec + request.deposit_per_unit_sec * stop.quantity


def _fixed_sec(request: PickTourRequest) -> float:
    """Tur başına sabit yük: araç hazırlığı + dock'a bırakmanın sabit kısmı."""
    return request.setup_sec + request.deposit_sec


def _leg_cost_sec(request: PickTourRequest, i: int, j: int) -> float:
    """Bir bacağın toplam maliyeti (sn).

    Dock'tan çıkan ilk bacağa turun sabit yükü eklenir; böylece zaman
    boyutundaki bitiş değeri turun gerçek süresine eşit olur.
    """
    cost = _travel_sec(request, i, j) + _congestion_sec(request, i, j) + _service_sec(request, j)
    if i == 0:
        cost += _fixed_sec(request)
    return cost


def _lower_bound_sec(request: PickTourRequest) -> float:
    """Makespan için geçerli bir alt sınır.

    İki bariz sınırın büyüğü:
      1. Bütün durak servislerini araçlara eşit paylaştırsak bile bir tur en
         az bu kadar sürer.
      2. Tek bir durağa gidip dönmek bile en az bu kadar sürer.

    Kanıtlanmış optimum değildir; çözümün kalitesini okumaya yarar.
    """
    fixed = _fixed_sec(request)
    total_service = sum(_service_sec(request, j) for j in range(1, len(request.stops) + 1))
    by_workload = total_service / request.vehicle_count + fixed
    by_farthest = max(
        (
            _travel_sec(request, 0, j)
            + _congestion_sec(request, 0, j)
            + _service_sec(request, j)
            + _travel_sec(request, j, 0)
            + fixed
        )
        for j in range(1, len(request.stops) + 1)
    )
    return round(max(by_workload, by_farthest), 1)


def _infeasibility(request: PickTourRequest) -> tuple[List[str], List[str]]:
    """Çözüm bulunamadığında kullanıcı dilinde neden ve gevşetme seçenekleri."""
    reasons: List[str] = []
    options: List[str] = []

    oversized = [
        stop.id
        for stop in request.stops
        if stop.volume_m3 > request.capacity_volume_m3
        or stop.weight_kg > request.capacity_weight_kg
    ]
    if oversized:
        reasons.append(
            "Şu satırlar tek başına araç kapasitesini aşıyor: "
            + ", ".join(oversized[:5])
            + ("…" if len(oversized) > 5 else "")
        )
        options.append("Satırı böl veya daha büyük kapasiteli ekipman seç.")

    total_volume = sum(stop.volume_m3 for stop in request.stops)
    total_weight = sum(stop.weight_kg for stop in request.stops)
    volume_capacity = request.capacity_volume_m3 * request.vehicle_count
    weight_capacity = request.capacity_weight_kg * request.vehicle_count

    if total_volume > volume_capacity:
        reasons.append(
            f"Toplam hacim {total_volume:.2f} m³, {request.vehicle_count} aracın "
            f"kapasitesi {volume_capacity:.2f} m³."
        )
        options.append("Toplayıcı sayısını artır.")
    if total_weight > weight_capacity:
        reasons.append(
            f"Toplam ağırlık {total_weight:.1f} kg, {request.vehicle_count} aracın "
            f"kapasitesi {weight_capacity:.1f} kg."
        )
        options.append("Toplayıcı sayısını artır veya siparişi böl.")

    if not reasons:
        reasons.append(
            "Verilen araç sayısı ve kapasiteyle geçerli bir tur kümesi bulunamadı."
        )
        options.append("Toplayıcı sayısını artır veya süre sınırını yükselt.")

    return reasons, options


def solve_pick_tour(request: PickTourRequest) -> PickTourResponse:
    started = time.perf_counter()
    node_count = len(request.stops) + 1

    manager = pywrapcp.RoutingIndexManager(node_count, request.vehicle_count, 0)
    routing = pywrapcp.RoutingModel(manager)

    def transit(from_index: int, to_index: int) -> int:
        i = manager.IndexToNode(from_index)
        j = manager.IndexToNode(to_index)
        return int(round(_leg_cost_sec(request, i, j) * TIME_SCALE))

    transit_index = routing.RegisterTransitCallback(transit)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_index)

    # --- Kapasite ---------------------------------------------------------
    def volume_demand(from_index: int) -> int:
        node = manager.IndexToNode(from_index)
        if node == 0:
            return 0
        return int(round(request.stops[node - 1].volume_m3 * VOLUME_SCALE))

    def weight_demand(from_index: int) -> int:
        node = manager.IndexToNode(from_index)
        if node == 0:
            return 0
        return int(round(request.stops[node - 1].weight_kg * WEIGHT_SCALE))

    routing.AddDimensionWithVehicleCapacity(
        routing.RegisterUnaryTransitCallback(volume_demand),
        0,
        [int(round(request.capacity_volume_m3 * VOLUME_SCALE))] * request.vehicle_count,
        True,
        "Volume",
    )
    routing.AddDimensionWithVehicleCapacity(
        routing.RegisterUnaryTransitCallback(weight_demand),
        0,
        [int(round(request.capacity_weight_kg * WEIGHT_SCALE))] * request.vehicle_count,
        True,
        "Weight",
    )

    # --- Zaman ve makespan ------------------------------------------------
    horizon = int(
        round(
            (
                sum(_leg_cost_sec(request, 0, j) for j in range(1, node_count))
                + sum(_travel_sec(request, j, 0) for j in range(1, node_count))
                + _fixed_sec(request)
            )
            * TIME_SCALE
        )
    ) + TIME_SCALE
    routing.AddDimension(transit_index, 0, horizon, True, "Time")
    time_dimension = routing.GetDimensionOrDie("Time")

    if request.objective == "makespan":
        # En geç biten turu küçültür. «En hızlı yükleme» sorusunun doğru
        # hedefi budur: toplayıcılar paralel çalışır, sipariş son tur bitince
        # hazırdır. Toplam süreyi küçültmek tek bir toplayıcıya bütün işi
        # yükleyen çözümleri ödüllendirirdi.
        time_dimension.SetGlobalSpanCostCoefficient(100)

    parameters = pywrapcp.DefaultRoutingSearchParameters()
    parameters.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    parameters.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    # Determinizm çözüm sayısından gelir; süre sınırı emniyet supabıdır.
    parameters.solution_limit = request.solution_limit
    parameters.time_limit.FromMilliseconds(request.time_limit_ms)

    assignment = routing.SolveWithParameters(parameters)
    duration_ms = int((time.perf_counter() - started) * 1000)

    if assignment is None:
        reasons, options = _infeasibility(request)
        return PickTourResponse(
            run_id=request.run_id,
            status="infeasible",
            solution_quality="none",
            solver_version=SOLVER_VERSION,
            solve_duration_ms=duration_ms,
            lower_bound_sec=_lower_bound_sec(request),
            infeasibility_reasons=reasons,
            relaxation_options=options,
            diagnostics={"stops": len(request.stops), "vehicles": request.vehicle_count},
        )

    tours = _read_tours(request, manager, routing, assignment)
    visited = {stop.location_id for tour in tours for stop in tour.stops}
    unassigned = [stop.id for stop in request.stops if stop.id not in visited]

    makespan = max((tour.total_sec for tour in tours), default=0.0)
    total = sum(tour.total_sec for tour in tours)

    return PickTourResponse(
        run_id=request.run_id,
        status="feasible",
        # Routing optimum kanıtlamaz — burada asla "optimal" yazmıyoruz.
        solution_quality="feasible",
        solver_version=SOLVER_VERSION,
        solve_duration_ms=duration_ms,
        makespan_sec=round(makespan, 1),
        total_sec=round(total, 1),
        lower_bound_sec=_lower_bound_sec(request),
        tours=tours,
        unassigned_stop_ids=unassigned,
        diagnostics={
            "stops": len(request.stops),
            "vehicles": request.vehicle_count,
            "usedVehicles": len(tours),
        },
        stopped_by=(
            "time-limit" if duration_ms >= request.time_limit_ms else "solution-limit"
        ),
    )


def _read_tours(
    request: PickTourRequest,
    manager: "pywrapcp.RoutingIndexManager",
    routing: "pywrapcp.RoutingModel",
    assignment,
) -> List[TourResult]:
    """Çözümü tura ve duraklara çevirir; süreler alan modeliyle aynı formülle."""
    tours: List[TourResult] = []
    fixed = _fixed_sec(request)

    for vehicle in range(request.vehicle_count):
        index = routing.Start(vehicle)
        stops: List[TourStopResult] = []
        distance_m = 0.0
        travel_sec = 0.0
        congestion_sec = 0.0
        pick_sec = 0.0
        volume_m3 = 0.0
        weight_kg = 0.0
        units = 0
        # Kümülatif süre hazırlıkla başlar; bırakma turun sonundadır ve
        # duraklara dağıtılmaz — alan modelindeki sırayla aynı.
        cumulative = request.setup_sec
        seq = 0

        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            next_index = assignment.Value(routing.NextVar(index))
            next_node = manager.IndexToNode(next_index)

            leg_distance = request.distance_m[node][next_node]
            leg_travel = _travel_sec(request, node, next_node)
            leg_congestion = _congestion_sec(request, node, next_node)

            distance_m += leg_distance
            travel_sec += leg_travel
            congestion_sec += leg_congestion

            if next_node != 0:
                stop = request.stops[next_node - 1]
                seq += 1
                pick_sec += stop.pick_sec
                volume_m3 += stop.volume_m3
                weight_kg += stop.weight_kg
                units += stop.quantity
                cumulative += leg_travel + leg_congestion + stop.pick_sec
                stops.append(
                    TourStopResult(
                        seq=seq,
                        location_id=stop.id,
                        sku_id=stop.sku_id,
                        quantity=stop.quantity,
                        distance_m=round(leg_distance, 3),
                        travel_sec=round(leg_travel, 1),
                        congestion_sec=round(leg_congestion, 1),
                        pick_sec=round(stop.pick_sec, 1),
                        cumulative_sec=round(cumulative, 1),
                    )
                )
            else:
                cumulative += leg_travel

            index = next_index

        if not stops:
            continue

        deposit = request.deposit_sec + request.deposit_per_unit_sec * units
        total = request.setup_sec + travel_sec + congestion_sec + pick_sec + deposit

        tours.append(
            TourResult(
                seq=len(tours) + 1,
                stops=stops,
                distance_m=round(distance_m, 3),
                travel_sec=round(travel_sec, 1),
                congestion_sec=round(congestion_sec, 1),
                pick_sec=round(pick_sec, 1),
                setup_sec=round(request.setup_sec, 1),
                deposit_sec=round(deposit, 1),
                total_sec=round(total, 1),
                volume_m3=round(volume_m3, 4),
                weight_kg=round(weight_kg, 3),
            )
        )

    return tours
