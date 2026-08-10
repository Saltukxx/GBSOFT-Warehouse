"""Rota-duyarlı araç yükleme solver davranış testleri."""

from gbsoft_optimizer.truckload import TruckLoadRequest, solve_truck_load


VEHICLE = {
    "code": "TEST-TRUCK",
    "internal_length_m": 7.2,
    "internal_width_m": 2.4,
    "internal_height_m": 2.5,
    "rear_door": {"width_m": 2.35, "height_m": 2.4, "sill_height_m": 1.0},
    "max_payload_kg": 8000,
    "axle_groups": [
        {"code": "F", "label": "Ön", "position_x": 1.2, "empty_load_kg": 2000, "max_load_kg": 7000},
        {"code": "R", "label": "Arka", "position_x": 5.8, "empty_load_kg": 2000, "max_load_kg": 9000},
    ],
    "obstacles": [],
    "cog_envelope": {"min_x": 1.0, "max_x": 6.4, "min_y": 0.5, "max_y": 1.9, "max_z": 1.4},
}


def units(count=9):
    return [
        {
            "hu_code": f"HU-{index + 1:03d}",
            "length_m": 1.2,
            "width_m": 0.8,
            "height_m": 1.4,
            "gross_weight_kg": 300,
            "stop_code": f"S{index % 3 + 1}",
            "stop_seq": index % 3 + 1,
            "rotation": "yaw",
            "floor_only": True,
        }
        for index in range(count)
    ]


def request(items=None, vehicle=None):
    return TruckLoadRequest(
        run_id="test-run",
        vehicle=vehicle or VEHICLE,
        units=items or units(),
    )


def overlaps(a, b):
    return (
        min(a.x + a.length_m, b.x + b.length_m) - max(a.x, b.x) > 1e-6
        and min(a.y + a.width_m, b.y + b.width_m) - max(a.y, b.y) > 1e-6
    )


def test_butun_birimleri_rotaya_gore_yerlestirir():
    value = request()
    result = solve_truck_load(value)

    assert result.status == "feasible"
    assert result.solution_quality == "feasible"
    assert len(result.positions) == len(value.units)
    assert result.unplaced_hu_codes == []
    assert not any(
        overlaps(a, b)
        for index, a in enumerate(result.positions)
        for b in result.positions[index + 1 :]
    )


def test_son_durak_derinde_ve_once_yuklenir():
    value = request()
    result = solve_truck_load(value)
    by_code = {unit.hu_code: unit for unit in value.units}

    stop_x = {}
    stop_seq = {}
    for position in result.positions:
        unit = by_code[position.hu_code]
        stop_x.setdefault(unit.stop_seq, []).append(position.x)
        stop_seq.setdefault(unit.stop_seq, []).append(position.seq)

    assert max(stop_x[3]) < min(stop_x[1])
    assert max(stop_seq[3]) < min(stop_seq[1])


def test_ayni_girdi_deterministik_sonuc_verir():
    value = request()
    first = solve_truck_load(value)
    second = solve_truck_load(value)
    assert [p.model_dump() for p in first.positions] == [p.model_dump() for p in second.positions]


def test_payload_asiminda_neden_ve_gevsetme_doner():
    small = {**VEHICLE, "max_payload_kg": 500}
    result = solve_truck_load(request(vehicle=small))
    assert result.status == "infeasible"
    assert "kapasitesi" in result.infeasibility_reasons[0]
    assert result.relaxation_options


def test_kapidan_gecmeyen_birimi_reddeder():
    items = units(1)
    items[0] = {**items[0], "width_m": 2.5, "rotation": "fixed"}
    result = solve_truck_load(request(items=items))
    assert result.status == "infeasible"
    assert result.unplaced_hu_codes == ["HU-001"]


def test_boyuna_kapasite_yetmezse_sessizce_birim_atmaz():
    short = {**VEHICLE, "internal_length_m": 1.5}
    short["axle_groups"] = [
        {**VEHICLE["axle_groups"][0], "position_x": 0.3},
        {**VEHICLE["axle_groups"][1], "position_x": 1.2},
    ]
    short["cog_envelope"] = {**VEHICLE["cog_envelope"], "max_x": 1.4}
    result = solve_truck_load(request(vehicle=short))
    assert result.status == "infeasible"
    assert result.positions == []


def test_optimal_iddia_etmez():
    assert solve_truck_load(request()).solution_quality != "optimal"


def test_sabit_yerlesimi_aynen_korur():
    value = request()
    initial = solve_truck_load(value)
    selected = initial.positions[0]
    payload = value.model_dump()
    payload["fixed_placements"] = [
        {
            "hu_code": selected.hu_code,
            "x": selected.x,
            "y": selected.y,
            "z": selected.z,
            "length_m": selected.length_m,
            "width_m": selected.width_m,
            "height_m": selected.height_m,
        }
    ]
    locked_request = TruckLoadRequest.model_validate(payload)
    result = solve_truck_load(locked_request)
    preserved = next(item for item in result.positions if item.hu_code == selected.hu_code)
    assert (preserved.x, preserved.y, preserved.z) == (selected.x, selected.y, selected.z)


def test_sapmada_sabit_yuku_ankraj_yapip_cakisma_uretmez():
    value = request()
    initial = solve_truck_load(value)
    selected = initial.positions[0]
    removed = initial.positions[1].hu_code
    payload = value.model_dump()
    payload["units"] = [unit for unit in payload["units"] if unit["hu_code"] != removed]
    payload["fixed_placements"] = [{
        "hu_code": selected.hu_code,
        "x": selected.x,
        "y": selected.y,
        "z": selected.z,
        "length_m": selected.length_m,
        "width_m": selected.width_m,
        "height_m": selected.height_m,
    }]
    locked_request = TruckLoadRequest.model_validate(payload)
    result = solve_truck_load(locked_request)
    preserved = next(item for item in result.positions if item.hu_code == selected.hu_code)

    assert result.status == "feasible"
    assert (preserved.x, preserved.y, preserved.z) == (selected.x, selected.y, selected.z)
    assert not any(
        overlaps(a, b)
        for index, a in enumerate(result.positions)
        for b in result.positions[index + 1 :]
    )
    weight_by_code = {unit.hu_code: unit.gross_weight_kg for unit in locked_request.units}
    total_weight = sum(weight_by_code.values())
    cog_x = sum(
        (position.x + position.length_m / 2) * weight_by_code[position.hu_code]
        for position in result.positions
    ) / total_weight
    assert cog_x <= locked_request.vehicle.cog_envelope.max_x + 1e-4


def test_gecersiz_sabit_yerlesimi_reddeder():
    value = request()
    payload = value.model_dump()
    payload["fixed_placements"] = [{
        "hu_code": "HU-001",
        "x": 7.0,
        "y": 0.0,
        "z": 0.0,
        "length_m": 1.2,
        "width_m": 0.8,
        "height_m": 1.4,
    }]
    result = solve_truck_load(TruckLoadRequest.model_validate(payload))
    assert result.status == "infeasible"
    assert "zarfını" in result.infeasibility_reasons[0]


# --------------------------------------------------------------------
# İki kademeli ağırlık zinciri
# --------------------------------------------------------------------

SEMI = {
    "code": "SEMI-13M6",
    "internal_length_m": 13.6,
    "internal_width_m": 2.48,
    "internal_height_m": 2.7,
    "rear_door": {"width_m": 2.46, "height_m": 2.62, "sill_height_m": 1.2},
    "max_payload_kg": 24000,
    "axle_groups": [
        {
            "code": "KINGPIN",
            "label": "Kingpin",
            "position_x": 1.3,
            "empty_load_kg": 4500,
            "max_load_kg": 12000,
            "coupling": True,
        },
        {
            "code": "TRIDEM",
            "label": "Tridem",
            "position_x": 11.2,
            "empty_load_kg": 3000,
            "max_load_kg": 24000,
        },
    ],
    "tractor": {
        "code": "TRACTOR-4X2",
        "label": "4x2 çekici",
        "tare_kg": 7400,
        "axles": [
            {
                "code": "STEER",
                "label": "Yönlendirme",
                "position_x": -2.0,
                "tare_load_kg": 4600,
                "max_load_kg": 7500,
                "driven": False,
                "steering": True,
            },
            {
                "code": "DRIVE",
                "label": "Tahrik",
                "position_x": 1.7,
                "tare_load_kg": 2800,
                "max_load_kg": 11500,
                "driven": True,
                "steering": False,
            },
        ],
    },
    "regulation": {
        "max_combination_weight_kg": 40000,
        "min_drive_axle_share": 0.25,
        "min_steer_axle_share": 0.2,
    },
    "obstacles": [],
    "cog_envelope": {"min_x": 3.0, "max_x": 10.8, "min_y": 0.72, "max_y": 1.76, "max_z": 1.55},
}


def pallets(count, weight_kg=640):
    return [
        {
            "hu_code": f"PAL-{index + 1:03d}",
            "length_m": 1.2,
            "width_m": 0.8,
            "height_m": 1.45,
            "gross_weight_kg": weight_kg,
            "stop_code": f"S{index % 3 + 1}",
            "stop_seq": index % 3 + 1,
            "rotation": "yaw",
            "floor_only": True,
        }
        for index in range(count)
    ]


def test_dolu_yari_romork_cekici_dingillerini_asmadan_yerlesir():
    response = solve_truck_load(request(items=pallets(27), vehicle=SEMI))
    assert response.status == "feasible"
    assert len(response.positions) == 27


def test_cekici_tahrik_dingili_siniri_yerlesimi_geriye_iter():
    """Tek kademeli model bu kısıtı hiç görmüyordu.

    Kingpin kuvvetinin yaklaşık %89'u tahrik dingiline gider; yük öne
    yaslanırsa 11.500 kg sınırı aşılır. Çözücü bunu bildiği için bloğu
    arkaya kaydırmak zorundadır.
    """
    response = solve_truck_load(request(items=pallets(27), vehicle=SEMI))
    assert response.status == "feasible"
    front_edge = min(position.x for position in response.positions)
    assert front_edge > 0.5


def test_katar_yasal_agirligini_asan_yuk_infeasible_doner():
    heavy = dict(SEMI)
    heavy["regulation"] = {**SEMI["regulation"], "max_combination_weight_kg": 20000}
    response = solve_truck_load(request(items=pallets(20), vehicle=heavy))
    assert response.status == "infeasible"
