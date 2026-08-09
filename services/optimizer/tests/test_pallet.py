"""Palet paketleme çözücüsünün davranış testleri.

Buradaki kontroller `@gbsoft/domain`'deki bağımsız doğrulayıcının kurallarını
tekrar eder. İki taraf ayrı ayrı yazıldığı için, biri kısıtı yanlış modellerse
diğeri yakalar — asıl amaç budur.
"""

from __future__ import annotations

from gbsoft_optimizer.pallet import PalletizeRequest, solve_palletize

EPS = 1e-4

EURO_BASE = {
    "package_type_code": "PALLET-EUR",
    "length_m": 1.2,
    "width_m": 0.8,
    "deck_height_m": 0.144,
    "max_height_m": 1.8,
    "max_weight_kg": 1000.0,
}

CASE_STD = {
    "code": "CASE-STD",
    "length_m": 0.6,
    "width_m": 0.4,
    "height_m": 0.3,
    "rotation": "yaw",
    "max_top_load_kg": 120.0,
    "min_support_ratio": 0.75,
    "stackable": True,
    "fragile": False,
    "temperature_class": "ambient",
}


def request(items, package_types=None, base=None) -> PalletizeRequest:
    return PalletizeRequest(
        run_id="test",
        base=base or EURO_BASE,
        package_types=package_types or [CASE_STD],
        items=items,
    )


def cases(count: int, weight: float = 10.0, code: str = "CASE-STD"):
    return [
        {
            "hu_code": f"HU-{index + 1:03d}",
            "package_type_code": code,
            "gross_weight_kg": weight,
        }
        for index in range(count)
    ]


def all_placements(result):
    return [p for pallet in result.pallets for p in pallet.placements]


def overlap_area(a, b) -> float:
    dx = min(a.x + a.length_m, b.x + b.length_m) - max(a.x, b.x)
    dz = min(a.z + a.width_m, b.z + b.width_m) - max(a.z, b.z)
    return dx * dz if dx > EPS and dz > EPS else 0.0


def test_butun_birimleri_yerlestirir():
    result = solve_palletize(request(cases(8)))

    assert result.status == "feasible"
    assert result.unplaced_hu_codes == []
    assert len(all_placements(result)) == 8


def test_optimal_iddia_etmez():
    result = solve_palletize(request(cases(12)))
    assert result.solution_quality == "feasible"


def test_ayni_girdi_ayni_plani_uretir():
    first = solve_palletize(request(cases(20)))
    second = solve_palletize(request(cases(20)))

    def shape(result):
        return [
            [(p.hu_code, p.x, p.y, p.z, p.length_m) for p in pallet.placements]
            for pallet in result.pallets
        ]

    assert shape(first) == shape(second)


def test_kutular_cakismaz_ve_palet_disina_tasmaz():
    result = solve_palletize(request(cases(24)))

    for pallet in result.pallets:
        for placement in pallet.placements:
            assert placement.x >= -EPS
            assert placement.z >= -EPS
            assert placement.x + placement.length_m <= EURO_BASE["length_m"] + EPS
            assert placement.z + placement.width_m <= EURO_BASE["width_m"] + EPS
            assert (
                placement.y + placement.height_m
                <= EURO_BASE["max_height_m"] - EURO_BASE["deck_height_m"] + EPS
            )

        for i, a in enumerate(pallet.placements):
            for b in pallet.placements[i + 1 :]:
                dy = min(a.y + a.height_m, b.y + b.height_m) - max(a.y, b.y)
                if dy > EPS:
                    assert overlap_area(a, b) <= EPS, f"{a.hu_code} ↔ {b.hu_code}"


def test_hicbir_kutu_bosllukta_durmaz():
    result = solve_palletize(request(cases(24)))

    for pallet in result.pallets:
        for placement in pallet.placements:
            if placement.y <= EPS:
                continue
            supported = sum(
                overlap_area(placement, other)
                for other in pallet.placements
                if other is not placement and abs(other.y + other.height_m - placement.y) <= EPS
            )
            footprint = placement.length_m * placement.width_m
            assert supported / footprint >= CASE_STD["min_support_ratio"] - EPS


def test_destekleyen_kutu_once_yerlestirilir():
    result = solve_palletize(request(cases(24)))

    for pallet in result.pallets:
        for placement in pallet.placements:
            if placement.y <= EPS:
                continue
            for other in pallet.placements:
                if other is placement:
                    continue
                if (
                    abs(other.y + other.height_m - placement.y) <= EPS
                    and overlap_area(placement, other) > EPS
                ):
                    assert other.seq < placement.seq


def test_agirlik_kapasitesi_asilmaz_ve_yeni_palet_acilir():
    # Her koli 300 kg; Euro palet 1000 kg → palet başına en fazla 3 koli.
    result = solve_palletize(request(cases(7, weight=300.0)))

    assert result.status == "feasible"
    assert result.unplaced_hu_codes == []
    for pallet in result.pallets:
        assert pallet.used_weight_kg <= EURO_BASE["max_weight_kg"] + EPS
        assert len(pallet.placements) <= 3
    assert len(result.pallets) >= 3


def test_istiflenemez_yukun_ustune_bir_sey_konmaz():
    irregular = {
        **CASE_STD,
        "code": "IRREGULAR",
        "length_m": 1.0,
        "width_m": 0.7,
        "height_m": 0.65,
        "rotation": "fixed",
        "max_top_load_kg": 0.0,
        "stackable": False,
    }
    items = [
        {"hu_code": "IRR-1", "package_type_code": "IRREGULAR", "gross_weight_kg": 40.0},
        *cases(4),
    ]
    result = solve_palletize(request(items, package_types=[CASE_STD, irregular]))

    placements = all_placements(result)
    irr = next(p for p in placements if p.hu_code == "IRR-1")
    same_pallet = next(
        pallet for pallet in result.pallets
        if any(p.hu_code == "IRR-1" for p in pallet.placements)
    )
    for placement in same_pallet.placements:
        if placement.hu_code == "IRR-1":
            continue
        if abs(placement.y - (irr.y + irr.height_m)) <= EPS:
            assert overlap_area(placement, irr) <= EPS


def test_ust_yuk_siniri_asilmaz():
    # Koli 120 kg taşıyabilir; 100 kg'lık koliler üst üste en fazla iki katman.
    result = solve_palletize(request(cases(9, weight=100.0)))

    for pallet in result.pallets:
        carried = {p.hu_code: 0.0 for p in pallet.placements}
        for placement in sorted(pallet.placements, key=lambda p: -p.y):
            supporters = [
                other
                for other in pallet.placements
                if other is not placement
                and abs(other.y + other.height_m - placement.y) <= EPS
                and overlap_area(placement, other) > EPS
            ]
            if not supporters:
                continue
            total = sum(overlap_area(placement, other) for other in supporters)
            load = placement.gross_weight_kg + carried[placement.hu_code]
            for other in supporters:
                carried[other.hu_code] += load * overlap_area(placement, other) / total

        for hu_code, value in carried.items():
            assert value <= CASE_STD["max_top_load_kg"] + EPS, hu_code


def test_farkli_sicaklik_siniflari_ayri_paletlere_gider():
    chilled = {**CASE_STD, "code": "CASE-CHILLED", "temperature_class": "chilled"}
    items = [*cases(4), *[
        {**item, "hu_code": f"CH-{index}", "package_type_code": "CASE-CHILLED"}
        for index, item in enumerate(cases(4))
    ]]
    result = solve_palletize(request(items, package_types=[CASE_STD, chilled]))

    for pallet in result.pallets:
        classes = {
            "chilled" if p.package_type_code == "CASE-CHILLED" else "ambient"
            for p in pallet.placements
        }
        assert len(classes) == 1


def test_ayrim_gruplari_ayri_paletlere_gider():
    drum = {
        **CASE_STD,
        "code": "DRUM-200L",
        "length_m": 0.585,
        "width_m": 0.585,
        "height_m": 0.88,
        "rotation": "fixed",
        "segregation_group": "chemical",
        "max_top_load_kg": 250.0,
    }
    items = [
        *cases(4),
        *[
            {"hu_code": f"DR-{i}", "package_type_code": "DRUM-200L", "gross_weight_kg": 200.0}
            for i in range(2)
        ],
    ]
    result = solve_palletize(request(items, package_types=[CASE_STD, drum]))

    for pallet in result.pallets:
        groups = {
            "chemical" if p.package_type_code == "DRUM-200L" else "(grupsuz)"
            for p in pallet.placements
        }
        assert len(groups) == 1


def test_palete_sigmayan_birimi_gerekcesiyle_bildirir():
    huge = {
        **CASE_STD,
        "code": "HUGE",
        "length_m": 3.0,
        "width_m": 2.0,
        "height_m": 0.5,
        "rotation": "fixed",
    }
    items = [
        {"hu_code": "BIG-1", "package_type_code": "HUGE", "gross_weight_kg": 50.0},
        *cases(2),
    ]
    result = solve_palletize(request(items, package_types=[CASE_STD, huge]))

    assert "BIG-1" in result.unplaced_hu_codes
    assert any("sığmıyor" in reason for reason in result.infeasibility_reasons)
    assert result.relaxation_options


def test_alt_sinir_kullanilan_palet_sayisini_asmaz():
    result = solve_palletize(request(cases(30)))

    assert result.lower_bound_pallets >= 1
    assert result.lower_bound_pallets <= len(result.pallets)


def test_katman_numaralari_kotla_tutarli():
    result = solve_palletize(request(cases(16)))

    for pallet in result.pallets:
        by_layer = {}
        for placement in pallet.placements:
            by_layer.setdefault(placement.layer, set()).add(round(placement.y, 4))
        for layer, levels in by_layer.items():
            assert len(levels) == 1, f"katman {layer} birden çok kotta"


def test_yuk_palete_ortalanir():
    """Kısmen dolu palette yük köşeye yığılmaz.

    Extreme-point yerleştirme sol-ön köşeden doldurur; ortalama olmasa
    ağırlık merkezi devrilme zarfının dışına çıkar ve bağımsız doğrulayıcı
    planı reddeder.
    """
    result = solve_palletize(request(cases(2)))
    pallet = result.pallets[0]

    min_x = min(p.x for p in pallet.placements)
    max_x = max(p.x + p.length_m for p in pallet.placements)
    min_z = min(p.z for p in pallet.placements)
    max_z = max(p.z + p.width_m for p in pallet.placements)

    # Yükün iki yanındaki boşluk eşit olmalı.
    assert abs(min_x - (EURO_BASE["length_m"] - max_x)) < 1e-3
    assert abs(min_z - (EURO_BASE["width_m"] - max_z)) < 1e-3


def test_ortalama_sonrasi_palet_disina_tasilmaz():
    result = solve_palletize(request(cases(24)))

    for pallet in result.pallets:
        for placement in pallet.placements:
            assert placement.x >= -EPS
            assert placement.z >= -EPS
            assert placement.x + placement.length_m <= EURO_BASE["length_m"] + EPS
            assert placement.z + placement.width_m <= EURO_BASE["width_m"] + EPS
