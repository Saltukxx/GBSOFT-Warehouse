"""Deterministik, rota-duyarlı araç yükleme sezgiseli.

Her durak kendi boyuna bandını alır. Son durak bandı aracın önünde,
ilk durak bandı arka kapıya yakındır. Bu yapı, sonraki durak yükünü
indirmeden önceki durağa erişimi ve ters yükleme sırasını doğrudan
sağlar. Sonuç yine de TypeScript alan doğrulayıcısından geçmeden onaylanmaz.

Bu bir optimumluk kanıtı değildir; `solution_quality` daima feasible/none'dır.
"""

from __future__ import annotations

import time
import math
from dataclasses import dataclass
from typing import List, Optional, Tuple

from .models import (
    LoadPositionResult,
    LoadUnitInput,
    TruckLoadRequest,
    TruckLoadResponse,
)

SOLVER_VERSION = "truck-load-route-band-1.1.0"
EPS = 1e-6


@dataclass
class Packed:
    unit: LoadUnitInput
    x: float
    y: float
    length_m: float
    width_m: float


def _orientations(unit: LoadUnitInput) -> List[Tuple[float, float]]:
    values = [(unit.length_m, unit.width_m)]
    if unit.rotation == "yaw" and abs(unit.length_m - unit.width_m) > EPS:
        values.append((unit.width_m, unit.length_m))
    return values


def _intersects(a: Packed, obstacle, offset_x: float) -> bool:
    return (
        min(a.x + offset_x + a.length_m, obstacle.x + obstacle.length_m)
        - max(a.x + offset_x, obstacle.x)
        > EPS
        and min(a.y + a.width_m, obstacle.y + obstacle.width_m)
        - max(a.y, obstacle.y)
        > EPS
        and min(a.unit.height_m, obstacle.z + obstacle.height_m) - max(0.0, obstacle.z)
        > EPS
    )



def _fill_shelf(
    remaining: List[LoadUnitInput],
    internal_width_m: float,
    prefer_index: int,
) -> Tuple[List[Tuple[LoadUnitInput, float, float]], float, float, List[LoadUnitInput]]:
    """Bir rafı, ilk birimin yönelimi verilmişken doldurur."""
    shelf: List[Tuple[LoadUnitInput, float, float]] = []
    used_width = 0.0
    shelf_length = 0.0
    deferred: List[LoadUnitInput] = []

    for unit in remaining:
        options = _orientations(unit)
        if not shelf and prefer_index < len(options):
            # Rafın yönelimini ilk birim belirler; sonrakiler ona uyar.
            options = [options[prefer_index]]
        candidates = [
            (length, width)
            for length, width in options
            if used_width + width <= internal_width_m + EPS
        ]
        if not candidates:
            deferred.append(unit)
            continue
        length, width = min(
            candidates,
            key=lambda value: (max(shelf_length, value[0]), value[1], value[0]),
        )
        shelf.append((unit, length, width))
        used_width += width
        shelf_length = max(shelf_length, length)

    return shelf, used_width, shelf_length, deferred


def _pack_group(
    units: List[LoadUnitInput],
    internal_width_m: float,
) -> Optional[List[Tuple[List[Tuple[LoadUnitInput, float, float]], float, float]]]:
    """Bir durak bloğunu en az boyuna yer kaplayacak yönelimle raflara böler.

    Yönelim kararı raf raf verilemez. 1,2 × 0,8 m paletin iki yönelimi de
    metre başına aynı yoğunluğu verir; farkı artan birim yapar. 2,48 m
    genişliğe boyuna 3 palet sığar ve 27 palet 9 tam raf eder (10,8 m);
    yanlamasına 2 sığar ve 13,5 raf eder, yani yarım raf boşa gider (11,2 m).

    Kaybedilen 0,4 m yalnız hacim değil: boyuna oyun, çözücünün dingil
    limitlerini sağlamak için yükü kaydırabildiği payın kendisidir. Yönelim
    açgözlü seçilince gerçek bir sefer imkânsız hâle geliyordu.
    """
    best: Optional[Tuple[Tuple[float, int], List[Tuple[List[Tuple[LoadUnitInput, float, float]], float, float]]]] = None

    for prefer_index in range(2):
        shelves: List[Tuple[List[Tuple[LoadUnitInput, float, float]], float, float]] = []
        remaining = list(units)
        total_length = 0.0
        ok = True

        while remaining:
            shelf, used_width, shelf_length, deferred = _fill_shelf(
                remaining, internal_width_m, prefer_index
            )
            if not shelf:
                ok = False
                break
            shelves.append((shelf, used_width, shelf_length))
            total_length += shelf_length
            remaining = deferred

        if not ok or not shelves:
            continue
        key = (round(total_length, 6), prefer_index)
        if best is None or key < best[0]:
            best = (key, shelves)

    return None if best is None else best[1]


def _distribute(
    positions: List[float], points: List[tuple]
) -> List[float]:
    """Ağırlıkları mesnetlere statik denge ile dağıtır.

    `packages/domain/src/truckLoad.ts` içindeki `distributeOntoSupports` ile
    birebir aynı kuraldır. İki uygulamanın ayrışması, çözücünün doğrulayıcının
    reddedeceği planlar üretmesi demek olurdu.

    İki mesnette çözüm kesindir ve konsol yükünü de doğru verir; mesnet
    dışındaki kütlede reaksiyon negatife döner, çünkü arka dingilin arkasına
    konan yük kingpin'i kaldırır.
    """
    loads = [0.0 for _ in positions]
    if not positions:
        return loads
    if len(positions) == 1:
        return [sum(weight for _, weight in points)]

    if len(positions) == 2:
        span = positions[1] - positions[0]
        for point_x, weight in points:
            front = weight * (positions[1] - point_x) / span
            loads[0] += front
            loads[1] += weight - front
        return loads

    for point_x, weight in points:
        if point_x <= positions[0]:
            loads[0] += weight
            continue
        if point_x >= positions[-1]:
            loads[-1] += weight
            continue
        right = next(index for index, value in enumerate(positions) if value >= point_x)
        left = right - 1
        span = positions[right] - positions[left]
        right_share = (point_x - positions[left]) / span
        loads[left] += weight * (1 - right_share)
        loads[right] += weight * right_share
    return loads


def _axle_check(
    request: TruckLoadRequest, packed: List[Packed], offset_x: float
) -> bool:
    """Yükten yere kadar ağırlık zincirinin yasal sınırlar içinde olup olmadığı.

    Yarı römorkta yük doğrudan dingillere binmez: önce kingpin ile römork
    dingil grubuna, sonra kingpin kuvveti çekicinin yönlendirme ve tahrik
    dingillerine dağılır. Tahrik dingili sınırı pratikte çoğu seferde
    bağlayıcı olan kısıttır ve tek kademeli model onu hiç görmüyordu.
    """
    vehicle = request.vehicle
    groups = sorted(vehicle.axle_groups, key=lambda axle: axle.position_x)
    points = [
        (item.x + offset_x + item.length_m / 2, item.unit.gross_weight_kg)
        for item in packed
    ]
    payload = sum(weight for _, weight in points)
    trailer_loads = _distribute([axle.position_x for axle in groups], points)

    coupling_index = next(
        (index for index, axle in enumerate(groups) if axle.coupling), None
    )
    grounded: List[float] = []

    for index, axle in enumerate(groups):
        total = axle.empty_load_kg + trailer_loads[index]
        if total > axle.max_load_kg + EPS:
            return False
        if index != coupling_index:
            grounded.append(total)

    trailer_tare = sum(axle.empty_load_kg for axle in groups)
    tractor_tare = 0.0
    tractor_laden = None
    drive_total = None
    steer_total = None

    if vehicle.tractor is not None and coupling_index is not None:
        coupling = groups[coupling_index]
        coupling_load = coupling.empty_load_kg + trailer_loads[coupling_index]
        axles = sorted(vehicle.tractor.axles, key=lambda axle: axle.position_x)
        shares = _distribute(
            [axle.position_x for axle in axles], [(coupling.position_x, coupling_load)]
        )
        tractor_tare = sum(axle.tare_load_kg for axle in axles)
        tractor_laden = tractor_tare + coupling_load
        drive_total = 0.0
        steer_total = 0.0
        for axle, share in zip(axles, shares):
            total = axle.tare_load_kg + share
            if total > axle.max_load_kg + EPS:
                return False
            grounded.append(total)
            if axle.driven:
                drive_total += total
            if axle.steering:
                steer_total += total

    combination = payload + trailer_tare + tractor_tare
    regulation = vehicle.regulation
    if regulation is not None:
        if combination > regulation.max_combination_weight_kg + EPS:
            return False
        if combination > 0 and payload > 0:
            # Tahrik payı katara göre ölçülür (96/53/AT Ek I 4.1).
            if (
                regulation.min_drive_axle_share is not None
                and drive_total is not None
                and drive_total / combination < regulation.min_drive_axle_share - EPS
            ):
                return False
            # Yönlendirme payı ise çekicinin kendi yüklü ağırlığına göre;
            # katara göre ölçmek fiziksel olarak yanlış olurdu.
            if (
                regulation.min_steer_axle_share is not None
                and steer_total is not None
                and tractor_laden is not None
                and tractor_laden > 0
                and steer_total / tractor_laden < regulation.min_steer_axle_share - EPS
            ):
                return False
    return True


def _safe_offset(
    request: TruckLoadRequest,
    packed: List[Packed],
    used_length: float,
    preferred_offset: Optional[float] = None,
) -> Optional[float]:
    vehicle = request.vehicle
    payload = sum(item.unit.gross_weight_kg for item in packed)
    base_cog_x = sum(
        (item.x + item.length_m / 2) * item.unit.gross_weight_kg for item in packed
    ) / payload
    max_offset = min(
        vehicle.internal_length_m - used_length,
        vehicle.cog_envelope.max_x - base_cog_x,
    )
    min_offset = max(0.0, vehicle.cog_envelope.min_x - base_cog_x)
    if min_offset > max_offset + EPS:
        return None

    # Kapıya en yakın, fakat aks/CoG/engel bakımından güvenli konumu ara.
    upper_cm = math.floor((max_offset + EPS) * 100)
    lower_cm = math.ceil(max(0.0, min_offset - EPS) * 100)
    candidates = [cm / 100 for cm in range(upper_cm, lower_cm - 1, -1)]
    if (
        preferred_offset is not None
        and min_offset - EPS <= preferred_offset <= max_offset + EPS
    ):
        candidates = [preferred_offset] + [
            value for value in candidates if abs(value - preferred_offset) > EPS
        ]
    for offset in candidates:
        if any(_intersects(item, obstacle, offset) for item in packed for obstacle in vehicle.obstacles):
            continue
        if not _axle_check(request, packed, offset):
            continue
        return offset
    return None


def _infeasible(
    request: TruckLoadRequest,
    started: float,
    reasons: List[str],
    options: List[str],
    unplaced: Optional[List[str]] = None,
) -> TruckLoadResponse:
    return TruckLoadResponse(
        run_id=request.run_id,
        status="infeasible",
        solution_quality="none",
        solver_version=SOLVER_VERSION,
        solve_duration_ms=int((time.perf_counter() - started) * 1000),
        unplaced_hu_codes=unplaced or [unit.hu_code for unit in request.units],
        infeasibility_reasons=reasons,
        relaxation_options=options,
        diagnostics={"units": len(request.units), "stops": len({u.stop_seq for u in request.units})},
    )


def _fixed_error(request: TruckLoadRequest) -> Optional[str]:
    unit_by_code = {unit.hu_code: unit for unit in request.units}
    vehicle = request.vehicle
    for fixed in request.fixed_placements:
        unit = unit_by_code[fixed.hu_code]
        allowed = any(
            abs(length - fixed.length_m) <= EPS
            and abs(width - fixed.width_m) <= EPS
            and abs(unit.height_m - fixed.height_m) <= EPS
            for length, width in _orientations(unit)
        )
        if not allowed:
            return f"{fixed.hu_code} sabit yerleşiminin yönelimi paket profiline uymuyor."
        if unit.floor_only and fixed.z > EPS:
            return f"{fixed.hu_code} yalnız araç tabanında sabitlenebilir."
        if (
            fixed.x + fixed.length_m > vehicle.internal_length_m + EPS
            or fixed.y + fixed.width_m > vehicle.internal_width_m + EPS
            or fixed.z + fixed.height_m > vehicle.internal_height_m + EPS
        ):
            return f"{fixed.hu_code} sabit yerleşimi araç zarfını aşıyor."
    return None


def _positions_overlap(a: LoadPositionResult, b: LoadPositionResult) -> bool:
    return (
        min(a.x + a.length_m, b.x + b.length_m) - max(a.x, b.x) > EPS
        and min(a.y + a.width_m, b.y + b.width_m) - max(a.y, b.y) > EPS
        and min(a.z + a.height_m, b.z + b.height_m) - max(a.z, b.z) > EPS
    )


def _reflow_around_fixed(
    request: TruckLoadRequest,
    positions: List[LoadPositionResult],
) -> Optional[List[LoadPositionResult]]:
    """Sabit pozları oynatmadan kalan yükleri kapıya doğru kademeli iter.

    Birim çıkarılınca kompakt rota bantları birkaç santimetre kayabilir. Mutlak
    sabit pozun sonradan geri konması bu durumda sınırda çakışma üretir. Sabit
    yükler önce yerleştirilir; kilitsizler mevcut sıralarında, yalnız gerektiği
    kadar +x yönüne itilerek boşluğa oturtulur.
    """
    fixed_codes = {placement.hu_code for placement in request.fixed_placements}
    placed = [position for position in positions if position.hu_code in fixed_codes]
    movable = sorted(
        [position for position in positions if position.hu_code not in fixed_codes],
        key=lambda position: position.seq,
    )
    for original in movable:
        candidate = original
        for _ in range(len(positions) + len(request.vehicle.obstacles) + 2):
            blockers = [item for item in placed if _positions_overlap(candidate, item)]
            obstacle_ends = [
                obstacle.x + obstacle.length_m
                for obstacle in request.vehicle.obstacles
                if min(candidate.y + candidate.width_m, obstacle.y + obstacle.width_m)
                - max(candidate.y, obstacle.y)
                > EPS
                and min(candidate.z + candidate.height_m, obstacle.z + obstacle.height_m)
                - max(candidate.z, obstacle.z)
                > EPS
                and min(candidate.x + candidate.length_m, obstacle.x + obstacle.length_m)
                - max(candidate.x, obstacle.x)
                > EPS
            ]
            if not blockers and not obstacle_ends:
                break
            next_x = max(
                [item.x + item.length_m for item in blockers] + obstacle_ends
            )
            candidate = candidate.model_copy(update={"x": round(next_x, 4)})
            if candidate.x + candidate.length_m > request.vehicle.internal_length_m + EPS:
                return None
        else:
            return None
        placed.append(candidate)
    return sorted(placed, key=lambda position: position.seq)


def _rebalance_cog_x(
    request: TruckLoadRequest,
    positions: List[LoadPositionResult],
) -> List[LoadPositionResult]:
    """Reflow sonrası küçük +x CoG taşmasını kilitsiz yüklerle geri alır."""
    unit_by_code = {unit.hu_code: unit for unit in request.units}
    fixed_codes = {placement.hu_code for placement in request.fixed_placements}
    payload = sum(unit.gross_weight_kg for unit in request.units)
    moment = sum(
        (position.x + position.length_m / 2)
        * unit_by_code[position.hu_code].gross_weight_kg
        for position in positions
    )
    excess_moment = moment - request.vehicle.cog_envelope.max_x * payload
    if excess_moment <= EPS:
        return positions

    result = list(positions)
    candidates = sorted(
        [position for position in result if position.hu_code not in fixed_codes],
        key=lambda position: (
            -unit_by_code[position.hu_code].stop_seq,
            position.x,
            position.seq,
        ),
    )
    for position in candidates:
        if excess_moment <= EPS:
            break
        left_edges = [0.0]
        for other in result:
            if other.hu_code == position.hu_code:
                continue
            lateral = (
                min(position.y + position.width_m, other.y + other.width_m)
                - max(position.y, other.y)
                > EPS
            )
            vertical = (
                min(position.z + position.height_m, other.z + other.height_m)
                - max(position.z, other.z)
                > EPS
            )
            if lateral and vertical and other.x + other.length_m <= position.x + EPS:
                left_edges.append(other.x + other.length_m)
        for obstacle in request.vehicle.obstacles:
            lateral = (
                min(position.y + position.width_m, obstacle.y + obstacle.width_m)
                - max(position.y, obstacle.y)
                > EPS
            )
            vertical = (
                min(position.z + position.height_m, obstacle.z + obstacle.height_m)
                - max(position.z, obstacle.z)
                > EPS
            )
            if lateral and vertical and obstacle.x + obstacle.length_m <= position.x + EPS:
                left_edges.append(obstacle.x + obstacle.length_m)
        available = position.x - max(left_edges)
        if available <= EPS:
            continue
        weight = unit_by_code[position.hu_code].gross_weight_kg
        shift = min(available, excess_moment / weight + EPS)
        moved = position.model_copy(update={"x": round(position.x - shift, 4)})
        result = [moved if item.hu_code == position.hu_code else item for item in result]
        excess_moment -= shift * weight
    return sorted(result, key=lambda position: position.seq)


def solve_truck_load(request: TruckLoadRequest) -> TruckLoadResponse:
    started = time.perf_counter()
    vehicle = request.vehicle
    fixed_error = _fixed_error(request)
    if fixed_error:
        return _infeasible(
            request,
            started,
            [fixed_error],
            ["Kilidi kaldırın veya birimi geçerli konuma taşıyın."],
        )
    payload = sum(unit.gross_weight_kg for unit in request.units)
    if payload > vehicle.max_payload_kg + EPS:
        return _infeasible(
            request,
            started,
            [f"Toplam yük {payload:.1f} kg, araç kapasitesi {vehicle.max_payload_kg:.1f} kg."],
            ["Daha yüksek kapasiteli araç seçin veya sevkiyatı bölün."],
        )

    impossible = []
    for unit in request.units:
        fits = any(
            length <= vehicle.internal_length_m + EPS
            and width <= vehicle.internal_width_m + EPS
            and min(length, width) <= vehicle.rear_door.width_m + EPS
            and unit.height_m <= min(vehicle.internal_height_m, vehicle.rear_door.height_m) + EPS
            for length, width in _orientations(unit)
        )
        if not fits:
            impossible.append(unit.hu_code)
    if impossible:
        return _infeasible(
            request,
            started,
            ["Kapıdan geçmeyen veya araç zarfına sığmayan birimler: " + ", ".join(impossible[:10])],
            ["Daha büyük araç seçin veya yük birimini yeniden paketleyin."],
            impossible,
        )

    packed: List[Packed] = []
    cursor_x = 0.0
    # Son durak önce ve en derine. Kod, eşitliklerde deterministik tie-break'tir.
    stop_sequences = sorted({unit.stop_seq for unit in request.units}, reverse=True)
    for stop_seq in stop_sequences:
        remaining = sorted(
            [unit for unit in request.units if unit.stop_seq == stop_seq],
            key=lambda unit: (-max(unit.length_m, unit.width_m), -unit.gross_weight_kg, unit.hu_code),
        )
        shelves = _pack_group(remaining, vehicle.internal_width_m)
        if shelves is None:
            return _infeasible(
                request,
                started,
                ["Yükler araç genişliğinde geçerli bir rafa yerleştirilemedi."],
                ["Daha geniş araç seçin veya yük birimini yeniden paketleyin."],
                [unit.hu_code for unit in remaining],
            )
        for shelf, used_width, shelf_length in shelves:
            y = (vehicle.internal_width_m - used_width) / 2
            for unit, length, width in shelf:
                packed.append(Packed(unit=unit, x=cursor_x, y=y, length_m=length, width_m=width))
                y += width
            cursor_x += shelf_length

    if cursor_x > vehicle.internal_length_m + EPS:
        return _infeasible(
            request,
            started,
            [f"Rota bantları {cursor_x:.2f} m, araç iç uzunluğu {vehicle.internal_length_m:.2f} m."],
            ["Daha uzun araç seçin, sevkiyatı bölün veya istiflemeye izin verin."],
        )

    payload = sum(item.unit.gross_weight_kg for item in packed)
    cog_y = sum((item.y + item.width_m / 2) * item.unit.gross_weight_kg for item in packed) / payload
    cog_z = sum(item.unit.height_m / 2 * item.unit.gross_weight_kg for item in packed) / payload
    if not (
        vehicle.cog_envelope.min_y - EPS <= cog_y <= vehicle.cog_envelope.max_y + EPS
        and cog_z <= vehicle.cog_envelope.max_z + EPS
    ):
        return _infeasible(
            request,
            started,
            ["Yanal/dikey ağırlık merkezi araç güvenli zarfına girmiyor."],
            ["Yük dağılımını veya araç şablonunu değiştirin."],
        )

    fixed_by_code = {placement.hu_code: placement for placement in request.fixed_placements}
    packed_by_code = {item.unit.hu_code: item for item in packed}
    fixed_offsets = [
        fixed.x - packed_by_code[code].x
        for code, fixed in fixed_by_code.items()
        if code in packed_by_code
    ]
    preferred_offset = None
    if fixed_offsets and max(fixed_offsets) - min(fixed_offsets) <= EPS:
        # Yüklenmiş/sabit birim mutlak koordinatında kalırken kalan rota
        # bantlarının ona göre kayması, sonradan pozu geri koyup çakışma
        # üretmekten daha güvenlidir.
        preferred_offset = fixed_offsets[0]

    offset_x = _safe_offset(request, packed, cursor_x, preferred_offset)
    if offset_x is None:
        return _infeasible(
            request,
            started,
            ["Yük için aks, engel ve boyuna ağırlık merkezi limitlerini birlikte sağlayan konum bulunamadı."],
            ["Yük dağılımını değiştirin, sevkiyatı bölün veya başka araç seçin."],
        )

    # Fiziksel yükleme: son durak birimleri önce araca girer.
    ordered = sorted(packed, key=lambda item: (-item.unit.stop_seq, item.x, item.y, item.unit.hu_code))
    sequence = {item.unit.hu_code: index + 1 for index, item in enumerate(ordered)}
    positions = [
        LoadPositionResult(
            hu_code=item.unit.hu_code,
            x=round(item.x + offset_x, 4),
            y=round(item.y, 4),
            z=0.0,
            length_m=item.length_m,
            width_m=item.width_m,
            height_m=item.unit.height_m,
            seq=sequence[item.unit.hu_code],
        )
        for item in sorted(packed, key=lambda item: sequence[item.unit.hu_code])
    ]
    # Editör kilitleri mutlak koordinattır. Deterministik temel plan üretilir,
    # ardından yalnız kilitli birimlerin pozu geri konur. Bağımsız alan
    # doğrulayıcısı nihai birleşimi yeniden kontrol eder; çakışan kilit
    # sessizce oynatılmaz.
    positions = [
        position
        if position.hu_code not in fixed_by_code
        else position.model_copy(
            update={
                "x": fixed_by_code[position.hu_code].x,
                "y": fixed_by_code[position.hu_code].y,
                "z": fixed_by_code[position.hu_code].z,
                "length_m": fixed_by_code[position.hu_code].length_m,
                "width_m": fixed_by_code[position.hu_code].width_m,
                "height_m": fixed_by_code[position.hu_code].height_m,
            }
        )
        for position in positions
    ]
    positions = _reflow_around_fixed(request, positions)
    if positions is None:
        return _infeasible(
            request,
            started,
            ["Sabit yükler korunurken kalan birimler çakışmasız yerleştirilemedi."],
            ["Daha büyük araç seçin veya henüz yüklenmemiş bir kilidi kaldırın."],
        )
    positions = _rebalance_cog_x(request, positions)
    return TruckLoadResponse(
        run_id=request.run_id,
        status="feasible",
        solution_quality="feasible",
        solver_version=SOLVER_VERSION,
        solve_duration_ms=int((time.perf_counter() - started) * 1000),
        positions=positions,
        diagnostics={
            "units": len(request.units),
            "stops": len(stop_sequences),
            "used_length_m": round(cursor_x, 4),
            "rear_offset_m": round(offset_x, 4),
            "fixed_placements": len(request.fixed_placements),
        },
    )
