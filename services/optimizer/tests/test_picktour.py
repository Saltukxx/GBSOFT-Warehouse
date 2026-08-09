"""Toplama turu çözücüsünün davranış testleri."""

from __future__ import annotations

import math

from gbsoft_optimizer.picktour import PickTourRequest, solve_pick_tour


def line_grid(count: int, spacing: float = 12.0) -> list[list[float]]:
    """Dock 0'da, duraklar bir doğru üzerinde eşit aralıklı — mesafe elle doğrulanabilir."""
    positions = [0.0] + [spacing * (i + 1) for i in range(count)]
    return [[abs(a - b) for b in positions] for a in positions]


def request(count: int = 4, **overrides) -> PickTourRequest:
    payload = {
        "run_id": "test",
        "equipment": "cart",
        "vehicle_count": 1,
        "capacity_volume_m3": 10.0,
        "capacity_weight_kg": 500.0,
        "speed_mps": 1.0,
        "setup_sec": 45.0,
        "deposit_sec": 60.0,
        "deposit_per_unit_sec": 1.5,
        "congestion_factor": 0.55,
        "distance_m": line_grid(count),
        "stops": [
            {
                "id": f"L-{i + 1}",
                "sku_id": f"SKU-{i + 1}",
                "quantity": 1,
                "volume_m3": 0.2,
                "weight_kg": 5.0,
                "pick_sec": 33.0,
                "congestion_score": 0.0,
            }
            for i in range(count)
        ],
    }
    payload.update(overrides)
    return PickTourRequest(**payload)


def test_butun_duraklari_atar():
    result = solve_pick_tour(request(5))

    assert result.status == "feasible"
    assert result.unassigned_stop_ids == []
    visited = [stop.location_id for tour in result.tours for stop in tour.stops]
    assert sorted(visited) == sorted(f"L-{i + 1}" for i in range(5))


def test_optimal_iddia_etmez():
    result = solve_pick_tour(request(6))

    # Routing kanıtlanmış optimum vermez; sözleşmede "optimal" değeri yoktur.
    assert result.solution_quality == "feasible"
    assert result.status != "optimal"


def test_ayni_girdi_ayni_turlari_uretir():
    first = solve_pick_tour(request(7))
    second = solve_pick_tour(request(7))

    def shape(result):
        return [
            [stop.location_id for stop in tour.stops] for tour in result.tours
        ]

    assert shape(first) == shape(second)
    assert first.makespan_sec == second.makespan_sec


def test_kapasite_asilmaz_ve_turlara_bolunur():
    # Araç 1 m³ alıyor, her satır 0.4 m³ → tek tura en fazla 2 satır sığar.
    result = solve_pick_tour(
        request(
            6,
            vehicle_count=3,
            capacity_volume_m3=1.0,
            stops=[
                {
                    "id": f"L-{i + 1}",
                    "sku_id": f"SKU-{i + 1}",
                    "quantity": 1,
                    "volume_m3": 0.4,
                    "weight_kg": 5.0,
                    "pick_sec": 33.0,
                    "congestion_score": 0.0,
                }
                for i in range(6)
            ],
        )
    )

    assert result.status == "feasible"
    assert len(result.tours) == 3
    for tour in result.tours:
        assert tour.volume_m3 <= 1.0 + 1e-6
        assert len(tour.stops) <= 2


def test_makespan_isi_toplayicilara_dagitir():
    balanced = solve_pick_tour(request(8, vehicle_count=4, objective="makespan"))

    assert balanced.status == "feasible"
    # Dört toplayıcı varken tek bir tura sekiz durak yüklenmemeli.
    assert max(len(tour.stops) for tour in balanced.tours) < 8
    # Makespan toplamdan küçüktür: turlar paralel çalışır.
    assert balanced.makespan_sec < balanced.total_sec


def test_makespan_alt_sinirin_altina_dusmez():
    result = solve_pick_tour(request(6, vehicle_count=2))

    assert result.lower_bound_sec > 0
    assert result.makespan_sec >= result.lower_bound_sec - 1e-6


def test_tur_suresi_bilesenlerin_toplamidir():
    result = solve_pick_tour(request(4))
    tour = result.tours[0]

    assert math.isclose(
        tour.total_sec,
        tour.setup_sec + tour.travel_sec + tour.congestion_sec + tour.pick_sec + tour.deposit_sec,
        abs_tol=0.3,
    )
    # Son durağın kümülatifi toplam süreyi aşamaz.
    assert tour.stops[-1].cumulative_sec <= tour.total_sec + 1e-6


def test_mesafe_matrisiyle_tutarli():
    # Dock → 12 → 24 → 36 → 48 → dock; 1 m/sn ile travel = 96 sn.
    result = solve_pick_tour(request(4))
    tour = result.tours[0]

    assert math.isclose(tour.distance_m, 96.0, abs_tol=1e-6)
    assert math.isclose(tour.travel_sec, 96.0, abs_tol=0.1)


def test_yogunluk_sureyi_artirir_mesafeyi_degil():
    clear = solve_pick_tour(request(4))
    busy = solve_pick_tour(
        request(
            4,
            stops=[
                {
                    "id": f"L-{i + 1}",
                    "sku_id": f"SKU-{i + 1}",
                    "quantity": 1,
                    "volume_m3": 0.2,
                    "weight_kg": 5.0,
                    "pick_sec": 33.0,
                    "congestion_score": 1.0,
                }
                for i in range(4)
            ],
        )
    )

    assert busy.tours[0].congestion_sec > 0
    assert clear.tours[0].congestion_sec == 0
    assert busy.makespan_sec > clear.makespan_sec
    assert math.isclose(busy.tours[0].distance_m, clear.tours[0].distance_m, abs_tol=1e-6)


def test_kapasiteye_sigmayan_satiri_gerekcesiyle_reddeder():
    result = solve_pick_tour(
        request(
            2,
            capacity_volume_m3=0.5,
            vehicle_count=1,
            stops=[
                {
                    "id": "L-1",
                    "sku_id": "SKU-1",
                    "quantity": 1,
                    "volume_m3": 3.0,
                    "weight_kg": 5.0,
                    "pick_sec": 33.0,
                    "congestion_score": 0.0,
                },
                {
                    "id": "L-2",
                    "sku_id": "SKU-2",
                    "quantity": 1,
                    "volume_m3": 0.2,
                    "weight_kg": 5.0,
                    "pick_sec": 33.0,
                    "congestion_score": 0.0,
                },
            ],
        )
    )

    assert result.status == "infeasible"
    assert result.solution_quality == "none"
    assert any("kapasitesini aşıyor" in reason for reason in result.infeasibility_reasons)
    assert result.relaxation_options


def test_200_satir_4_arac_zaman_sinirinda_cozulur():
    result = solve_pick_tour(
        request(
            200,
            vehicle_count=4,
            capacity_volume_m3=20.0,
            capacity_weight_kg=2000.0,
            time_limit_ms=10_000,
        )
    )

    assert result.status == "feasible"
    assert result.unassigned_stop_ids == []
    assert result.solve_duration_ms <= 12_000
