"""Palet paketleme çözücüsü — extreme-point yerleştirme (Faz 7).

Klasik 3B bin-packing sezgiseli: her yerleştirmeden sonra üç yeni aday nokta
(sağ, üst, arka) doğar; sonraki kutu, kısıtları sağlayan adaylar içinden en
alttakine ve en sol-öndekine konur. Deterministiktir — rastgelelik yoktur,
aynı girdi aynı planı verir.

Kısıtlar burada **yerleştirme sırasında** uygulanır: sınırlar, çakışma, destek
oranı, istiflenebilirlik, kırılganlık, üst yük, ağırlık, sıcaklık ve ayrım.
Ama üretilen plan yine de `@gbsoft/domain`'deki bağımsız doğrulayıcıdan
geçmek zorundadır; bir çözücünün kendi çözümünü kendi kısıtlarıyla onaylaması
yeterli bir güvence değildir.

`solution_quality` hiçbir koşulda "optimal" olmaz: sezgisel yöntem optimum
kanıtlamaz. Kullanılan palet sayısı için hacim ve ağırlıktan türeyen gerçek
bir alt sınır raporlanır.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .models import (
    ItemInput,
    PackageProfile,
    PalletizeRequest,
    PalletizeResponse,
    PalletResult,
    PlacementResult,
)

SOLVER_VERSION = "pallet-extreme-point-1.1.0"

#: Ölçü karşılaştırma toleransı (m) — alan modelindeki değerle aynı.
EPSILON = 1e-4


@dataclass
class Placed:
    hu_code: str
    package_type_code: str
    x: float
    y: float
    z: float
    length_m: float
    width_m: float
    height_m: float
    gross_weight_kg: float
    seq: int
    #: Bu kutunun taşıdığı üst yük; yerleştirme ilerledikçe birikir.
    carried_kg: float = 0.0
    locked: bool = False

    @property
    def top(self) -> float:
        return self.y + self.height_m


@dataclass
class Pallet:
    placements: List[Placed] = field(default_factory=list)
    #: Aday konumlar (x, y, z).
    points: List[Tuple[float, float, float]] = field(
        default_factory=lambda: [(0.0, 0.0, 0.0)]
    )
    weight_kg: float = 0.0
    #: Kilitli paletin sıra numarası yeniden çözmede korunur.
    seq_hint: int = 0


def _orientations(profile: PackageProfile) -> List[Tuple[float, float, float]]:
    """İzin verilen dış ölçüler. Alan modelindeki `allowedFootprints` ile aynı."""
    l, w, h = profile.length_m, profile.width_m, profile.height_m
    if profile.rotation == "fixed":
        candidates = [(l, w, h)]
    elif profile.rotation == "yaw":
        candidates = [(l, w, h)] if abs(l - w) < EPSILON else [(l, w, h), (w, l, h)]
    else:
        candidates = [
            (l, w, h),
            (w, l, h),
            (l, h, w),
            (h, l, w),
            (w, h, l),
            (h, w, l),
        ]

    seen: set = set()
    unique: List[Tuple[float, float, float]] = []
    for candidate in candidates:
        key = tuple(round(value, 6) for value in candidate)
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def _overlap_area(
    ax: float, az: float, al: float, aw: float,
    bx: float, bz: float, bl: float, bw: float,
) -> float:
    dx = min(ax + al, bx + bl) - max(ax, bx)
    dz = min(az + aw, bz + bw) - max(az, bz)
    return dx * dz if dx > EPSILON and dz > EPSILON else 0.0


def _intersects(
    x: float, y: float, z: float, l: float, w: float, h: float, other: Placed
) -> bool:
    dy = min(y + h, other.top) - max(y, other.y)
    if dy <= EPSILON:
        return False
    return _overlap_area(x, z, l, w, other.x, other.z, other.length_m, other.width_m) > EPSILON


def _supporters(
    x: float, y: float, l: float, w: float, z: float, pallet: Pallet
) -> List[Tuple[Placed, float]]:
    """Bu konumu destekleyen kutular ve oturma alanları."""
    result: List[Tuple[Placed, float]] = []
    for placed in pallet.placements:
        if abs(placed.top - y) > EPSILON:
            continue
        area = _overlap_area(x, z, l, w, placed.x, placed.z, placed.length_m, placed.width_m)
        if area > EPSILON:
            result.append((placed, area))
    return result


def _can_place(
    request: PalletizeRequest,
    pallet: Pallet,
    profile: PackageProfile,
    weight_kg: float,
    x: float,
    y: float,
    z: float,
    l: float,
    w: float,
    h: float,
) -> bool:
    base = request.base
    max_load_height = base.max_height_m - base.deck_height_m

    if x < -EPSILON or z < -EPSILON or y < -EPSILON:
        return False
    if x + l > base.length_m + EPSILON:
        return False
    if z + w > base.width_m + EPSILON:
        return False
    if y + h > max_load_height + EPSILON:
        return False
    if pallet.weight_kg + weight_kg > base.max_weight_kg + EPSILON:
        return False

    for placed in pallet.placements:
        if _intersects(x, y, z, l, w, h, placed):
            return False

    if y <= EPSILON:
        return True  # güverteye oturuyor

    supporters = _supporters(x, y, l, w, z, pallet)
    if not supporters:
        return False

    footprint = l * w
    supported = sum(area for _, area in supporters)
    if supported / footprint + EPSILON < profile.min_support_ratio:
        return False

    profiles = {p.code: p for p in request.package_types}
    total_support = supported
    for placed, area in supporters:
        under = profiles[placed.package_type_code]
        if not under.stackable or under.fragile:
            return False
        share = area / total_support
        # Yük zinciri boyunca aşağı iner; her destekleyicinin kendi sınırı var.
        if not _bearable(pallet, profiles, placed, weight_kg * share):
            return False

    return True


def _bearable(
    pallet: Pallet,
    profiles: Dict[str, PackageProfile],
    placed: Placed,
    extra_kg: float,
) -> bool:
    """Ek yük, bu kutu ve altındaki zincir tarafından taşınabilir mi?"""
    profile = profiles[placed.package_type_code]
    if placed.carried_kg + extra_kg > profile.max_top_load_kg + EPSILON:
        return False

    supporters = _supporters(
        placed.x, placed.y, placed.length_m, placed.width_m, placed.z, pallet
    )
    if not supporters:
        return True
    total = sum(area for _, area in supporters)
    for under, area in supporters:
        if not _bearable(pallet, profiles, under, extra_kg * (area / total)):
            return False
    return True


def _apply_load(
    pallet: Pallet,
    placed_at: Tuple[float, float, float],
    l: float,
    w: float,
    load_kg: float,
) -> None:
    """Yeni kutunun ağırlığını destekleyici zincire dağıtır."""
    x, y, z = placed_at
    supporters = _supporters(x, y, l, w, z, pallet)
    if not supporters:
        return
    total = sum(area for _, area in supporters)
    for placed, area in supporters:
        share = load_kg * (area / total)
        placed.carried_kg += share
        _apply_load(
            pallet,
            (placed.x, placed.y, placed.z),
            placed.length_m,
            placed.width_m,
            share,
        )


def _lower_bound_pallets(request: PalletizeRequest) -> int:
    """Hacim ve ağırlıktan türeyen palet sayısı alt sınırı."""
    profiles = {p.code: p for p in request.package_types}
    base = request.base
    envelope = base.length_m * base.width_m * (base.max_height_m - base.deck_height_m)

    total_volume = 0.0
    total_weight = 0.0
    for item in request.items:
        profile = profiles[item.package_type_code]
        total_volume += profile.length_m * profile.width_m * profile.height_m
        total_weight += item.gross_weight_kg

    by_volume = math.ceil(total_volume / envelope) if envelope > 0 else 1
    by_weight = math.ceil(total_weight / base.max_weight_kg)
    return max(1, by_volume, by_weight)


def _sort_key(item: ItemInput, profiles: Dict[str, PackageProfile]):
    """Yerleştirme sırası: ağır ve istiflenemez yükler alta.

    Deterministik olmak için son kırıcı `hu_code`'dur.
    """
    profile = profiles[item.package_type_code]
    volume = profile.length_m * profile.width_m * profile.height_m
    return (
        0 if not profile.stackable or profile.fragile else 1,
        -item.gross_weight_kg,
        -volume,
        item.hu_code,
    )


def _group_key(profile: PackageProfile) -> Tuple[str, str]:
    """Aynı palete konabilecek yükler. Grupsuz yük kendi grubudur."""
    return (profile.temperature_class, profile.segregation_group or "(grupsuz)")


def solve_palletize(request: PalletizeRequest) -> PalletizeResponse:
    started = time.perf_counter()
    profiles = {profile.code: profile for profile in request.package_types}
    base = request.base
    max_load_height = base.max_height_m - base.deck_height_m

    # Kilitli yerleşimler önce tam koordinatlarında kurulur. Sonraki adaylar
    # bunları normal birer hacim ve destekleyici olarak görür.
    item_by_code = {item.hu_code: item for item in request.items}
    fixed_codes = {placement.hu_code for placement in request.fixed_placements}
    fixed_pallets: Dict[int, Pallet] = {}
    fixed_group: Dict[int, Tuple[str, str]] = {}
    fixed_errors: List[str] = []

    for fixed in sorted(
        request.fixed_placements,
        key=lambda placement: (placement.pallet_seq, placement.y, placement.seq),
    ):
        item = item_by_code[fixed.hu_code]
        profile = profiles[item.package_type_code]
        group = _group_key(profile)
        existing_group = fixed_group.setdefault(fixed.pallet_seq, group)
        if existing_group != group:
            fixed_errors.append(
                f"Palet {fixed.pallet_seq} kilitleri farklı ayrım/sıcaklık gruplarında."
            )
            continue

        orientation = (fixed.length_m, fixed.width_m, fixed.height_m)
        allowed = any(
            all(abs(a - b) <= EPSILON for a, b in zip(orientation, candidate))
            for candidate in _orientations(profile)
        )
        if not allowed:
            fixed_errors.append(f"{fixed.hu_code} kilidi izin verilmeyen yönelimde.")
            continue

        pallet = fixed_pallets.setdefault(
            fixed.pallet_seq, Pallet(seq_hint=fixed.pallet_seq)
        )
        if not _can_place(
            request,
            pallet,
            profile,
            item.gross_weight_kg,
            fixed.x,
            fixed.y,
            fixed.z,
            fixed.length_m,
            fixed.width_m,
            fixed.height_m,
        ):
            fixed_errors.append(
                f"{fixed.hu_code} kilidi sınır, çakışma, destek veya kapasite kuralını bozuyor."
            )
            continue
        _place_at(
            pallet,
            item,
            (fixed.x, fixed.y, fixed.z),
            orientation,
            fixed.seq,
            locked=True,
        )

    if fixed_errors:
        duration_ms = int((time.perf_counter() - started) * 1000)
        return PalletizeResponse(
            run_id=request.run_id,
            status="infeasible",
            solution_quality="none",
            solver_version=SOLVER_VERSION,
            solve_duration_ms=duration_ms,
            unplaced_hu_codes=sorted(fixed_codes),
            lower_bound_pallets=_lower_bound_pallets(request),
            infeasibility_reasons=fixed_errors,
            relaxation_options=["Çakışan kilitleri kaldırın veya editörde düzeltin."],
            diagnostics={"items": len(request.items), "fixed": len(fixed_codes)},
        )

    # Sıcaklık sınıfı ve ayrım grubu farklı olan yükler aynı palete konamaz;
    # her kombinasyon kendi palet kümesini alır.
    groups: Dict[Tuple[str, str], List[ItemInput]] = {}
    for item in request.items:
        if item.hu_code in fixed_codes:
            continue
        groups.setdefault(_group_key(profiles[item.package_type_code]), []).append(item)

    pallets: List[Pallet] = list(fixed_pallets.values())
    unplaced: List[str] = []
    seq = max((placement.seq for pallet in pallets for placement in pallet.placements), default=0)
    next_pallet_seq = max(fixed_pallets, default=0)

    for key in sorted(groups.keys()):
        items = sorted(groups[key], key=lambda item: _sort_key(item, profiles))
        group_pallets = [
            pallet
            for pallet_seq, pallet in fixed_pallets.items()
            if fixed_group.get(pallet_seq) == key
        ]

        for item in items:
            profile = profiles[item.package_type_code]
            orientations = _orientations(profile)

            # Tek başına palete sığmayan yük hiçbir yere sığmaz.
            fits_anywhere = any(
                l <= base.length_m + EPSILON
                and w <= base.width_m + EPSILON
                and h <= max_load_height + EPSILON
                for l, w, h in orientations
            )
            if not fits_anywhere or item.gross_weight_kg > base.max_weight_kg + EPSILON:
                unplaced.append(item.hu_code)
                continue

            placed = False
            for pallet in group_pallets:
                spot = _best_spot(request, pallet, profile, item, orientations)
                if spot is None:
                    continue
                seq += 1
                _place(pallet, item, profile, spot, seq)
                placed = True
                break

            if not placed:
                next_pallet_seq += 1
                pallet = Pallet(seq_hint=next_pallet_seq)
                spot = _best_spot(request, pallet, profile, item, orientations)
                if spot is None:
                    unplaced.append(item.hu_code)
                    continue
                seq += 1
                _place(pallet, item, profile, spot, seq)
                group_pallets.append(pallet)

        pallets.extend(pallet for pallet in group_pallets if pallet not in pallets)

    # Yükü ortalamak yerleştirme bittikten sonra yapılır: rijit öteleme
    # göreli geometriyi bozmaz ama kısmen dolu paletin devrilme zarfını
    # düzeltir.
    for pallet in pallets:
        if not any(placement.locked for placement in pallet.placements):
            _center_load(pallet, request)

    duration_ms = int((time.perf_counter() - started) * 1000)
    ordered_pallets = sorted(pallets, key=lambda pallet: pallet.seq_hint)
    results = [_to_result(pallet.seq_hint, pallet, request) for pallet in ordered_pallets]

    if not results:
        reasons, options = _infeasibility(request, unplaced)
        return PalletizeResponse(
            run_id=request.run_id,
            status="infeasible",
            solution_quality="none",
            solver_version=SOLVER_VERSION,
            solve_duration_ms=duration_ms,
            unplaced_hu_codes=unplaced,
            lower_bound_pallets=_lower_bound_pallets(request),
            infeasibility_reasons=reasons,
            relaxation_options=options,
        )

    reasons, options = ([], []) if not unplaced else _infeasibility(request, unplaced)

    return PalletizeResponse(
        run_id=request.run_id,
        status="feasible",
        # Sezgisel paketleme optimum kanıtlamaz.
        solution_quality="feasible",
        solver_version=SOLVER_VERSION,
        solve_duration_ms=duration_ms,
        pallets=results,
        unplaced_hu_codes=unplaced,
        lower_bound_pallets=_lower_bound_pallets(request),
        infeasibility_reasons=reasons,
        relaxation_options=options,
        diagnostics={
            "items": len(request.items),
            "pallets": len(results),
            "unplaced": len(unplaced),
            "fixed": len(fixed_codes),
        },
    )


def _best_spot(
    request: PalletizeRequest,
    pallet: Pallet,
    profile: PackageProfile,
    item: ItemInput,
    orientations: List[Tuple[float, float, float]],
) -> Optional[Tuple[Tuple[float, float, float], Tuple[float, float, float]]]:
    """En alttaki, sonra en sol-öndeki geçerli konum ve yönelim.

    Deterministik: aday noktalar ve yönelimler sabit sırayla taranır, seçim
    ölçütü tam sıralıdır.
    """
    best: Optional[Tuple[Tuple[float, float, float], Tuple[float, float, float]]] = None
    best_key: Optional[Tuple[float, float, float]] = None

    for point in sorted(pallet.points):
        x, y, z = point
        for orientation in orientations:
            l, w, h = orientation
            if not _can_place(
                request, pallet, profile, item.gross_weight_kg, x, y, z, l, w, h
            ):
                continue
            key = (round(y, 6), round(x, 6), round(z, 6))
            if best_key is None or key < best_key:
                best_key = key
                best = (point, orientation)

    return best


def _place(
    pallet: Pallet,
    item: ItemInput,
    profile: PackageProfile,
    spot: Tuple[Tuple[float, float, float], Tuple[float, float, float]],
    seq: int,
) -> None:
    (x, y, z), (l, w, h) = spot

    _place_at(pallet, item, (x, y, z), (l, w, h), seq)


def _place_at(
    pallet: Pallet,
    item: ItemInput,
    point: Tuple[float, float, float],
    orientation: Tuple[float, float, float],
    seq: int,
    locked: bool = False,
) -> None:
    """Birimi verilen noktaya işler; kilitler de aynı fizik zincirini kullanır."""
    x, y, z = point
    l, w, h = orientation

    _apply_load(pallet, (x, y, z), l, w, item.gross_weight_kg)

    pallet.placements.append(
        Placed(
            hu_code=item.hu_code,
            package_type_code=item.package_type_code,
            x=round(x, 4),
            y=round(y, 4),
            z=round(z, 4),
            length_m=round(l, 4),
            width_m=round(w, 4),
            height_m=round(h, 4),
            gross_weight_kg=item.gross_weight_kg,
            seq=seq,
            locked=locked,
        )
    )
    pallet.weight_kg += item.gross_weight_kg

    if point in pallet.points:
        pallet.points.remove(point)
    for candidate in ((x + l, y, z), (x, y + h, z), (x, y, z + w)):
        rounded = tuple(round(value, 4) for value in candidate)
        if rounded not in pallet.points:
            pallet.points.append(rounded)  # type: ignore[arg-type]


def _center_load(pallet: Pallet, request: PalletizeRequest) -> None:
    """Yükü palet tabanına ortalar.

    Extreme-point yerleştirme kutuları sol-ön köşeden doldurur. Palet tam
    dolduğunda bu sorun değildir, ama yarım dolu bir palette bütün yük bir
    köşeye yığılır ve ağırlık merkezi devrilme zarfının dışına çıkar —
    bağımsız doğrulayıcı bunu `cog-outside-envelope` olarak yakalar.

    Çözüm rijit bir ötelemedir: bütün kutular aynı miktarda kaydırılır.
    Göreli geometri bozulmaz, dolayısıyla çakışma, destek oranı ve üst yük
    hesapları aynen geçerli kalır.

    Bu, ağırlık dağılımı asimetrik olan yükleri düzeltmez; onlar için
    doğrulayıcı yine ihlal döner ve plan yayınlanamaz.
    """
    if not pallet.placements:
        return

    base = request.base
    min_x = min(placed.x for placed in pallet.placements)
    max_x = max(placed.x + placed.length_m for placed in pallet.placements)
    min_z = min(placed.z for placed in pallet.placements)
    max_z = max(placed.z + placed.width_m for placed in pallet.placements)

    shift_x = (base.length_m - (max_x - min_x)) / 2 - min_x
    shift_z = (base.width_m - (max_z - min_z)) / 2 - min_z

    for placed in pallet.placements:
        placed.x = round(placed.x + shift_x, 4)
        placed.z = round(placed.z + shift_z, 4)


def _to_result(seq: int, pallet: Pallet, request: PalletizeRequest) -> PalletResult:
    base = request.base
    max_load_height = base.max_height_m - base.deck_height_m

    # Katman numarası farklı kot seviyelerinden türer; aynı kottaki kutular
    # aynı katmandadır.
    levels = sorted({round(placed.y, 4) for placed in pallet.placements})
    layer_of = {level: index + 1 for index, level in enumerate(levels)}

    placements = [
        PlacementResult(
            hu_code=placed.hu_code,
            package_type_code=placed.package_type_code,
            x=placed.x,
            y=placed.y,
            z=placed.z,
            length_m=placed.length_m,
            width_m=placed.width_m,
            height_m=placed.height_m,
            gross_weight_kg=placed.gross_weight_kg,
            layer=layer_of[round(placed.y, 4)],
            seq=placed.seq,
        )
        for placed in sorted(pallet.placements, key=lambda p: p.seq)
    ]

    used_height = max((placed.top for placed in pallet.placements), default=0.0)
    load_volume = sum(
        placed.length_m * placed.width_m * placed.height_m
        for placed in pallet.placements
    )
    envelope = base.length_m * base.width_m * max(EPSILON, max_load_height)
    ground = sum(
        placed.length_m * placed.width_m
        for placed in pallet.placements
        if abs(placed.y) <= EPSILON
    )

    return PalletResult(
        seq=seq,
        placements=placements,
        used_height_m=round(used_height, 4),
        used_weight_kg=round(pallet.weight_kg, 3),
        volume_utilization_pct=round(load_volume / envelope * 100, 1),
        footprint_utilization_pct=round(
            ground / (base.length_m * base.width_m) * 100, 1
        ),
    )


def _infeasibility(
    request: PalletizeRequest, unplaced: List[str]
) -> Tuple[List[str], List[str]]:
    profiles = {profile.code: profile for profile in request.package_types}
    base = request.base
    max_load_height = base.max_height_m - base.deck_height_m
    reasons: List[str] = []
    options: List[str] = []

    by_code = {item.hu_code: item for item in request.items}
    oversized: List[str] = []
    overweight: List[str] = []

    for code in unplaced:
        item = by_code.get(code)
        if not item:
            continue
        profile = profiles[item.package_type_code]
        fits = any(
            l <= base.length_m + EPSILON
            and w <= base.width_m + EPSILON
            and h <= max_load_height + EPSILON
            for l, w, h in _orientations(profile)
        )
        if not fits:
            oversized.append(code)
        elif item.gross_weight_kg > base.max_weight_kg + EPSILON:
            overweight.append(code)

    if oversized:
        reasons.append(
            "Şu birimler palet zarfına hiçbir yönelimde sığmıyor: "
            + ", ".join(oversized[:5])
            + ("…" if len(oversized) > 5 else "")
        )
        options.append("Daha büyük palet tipi seçin veya birimi bölün.")
    if overweight:
        reasons.append(
            "Şu birimler tek başına palet kapasitesini aşıyor: "
            + ", ".join(overweight[:5])
        )
        options.append("Palet ağırlık limitini gözden geçirin.")

    remaining = [
        code for code in unplaced if code not in oversized and code not in overweight
    ]
    if remaining:
        reasons.append(
            f"{len(remaining)} birim kısıtlar altında hiçbir palete yerleştirilemedi."
        )
        options.append(
            "İstiflenebilirlik, üst yük veya destek oranı kurallarını gözden geçirin."
        )

    if not reasons:
        reasons.append("Verilen kısıtlarla palet planı üretilemedi.")
        options.append("Palet ölçülerini ve paket profillerini kontrol edin.")

    return reasons, options
