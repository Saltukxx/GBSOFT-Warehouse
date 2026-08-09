import { describe, expect, it } from "vitest";
import {
  DEFAULT_PICK_TIME_PARAMETERS,
  estimateLocationPickTimeSec,
} from "./picking.js";
import {
  DEFAULT_PICK_TOUR_PARAMETERS,
  estimatePickTourSec,
  pickStopSec,
  tourMakespanSec,
  type PickTourStopInput,
} from "./pickTour.js";

function stop(overrides: Partial<PickTourStopInput> = {}): PickTourStopInput {
  return {
    locationCode: "A-03-02",
    skuCode: "SKU-184",
    quantity: 1,
    travelFromPreviousM: 30,
    goldenZone: true,
    congestionScore: 0,
    ...overrides,
  };
}

describe("toplama turu süre modeli", () => {
  it("satır bazlı modelle aynı sabit bileşenleri kullanır", () => {
    const p = DEFAULT_PICK_TIME_PARAMETERS;

    // Mesafesiz ve yoğunluksuz bir toplama, satır modelinde kuyruk + sabit
    // bileşenlerdir. Turda kuyruk hazırlığa taşındığı için aradaki tek fark
    // `queueSec` olmalı. İki model ayrışırsa bu test düşer.
    const line = estimateLocationPickTimeSec({
      distanceToDockM: 0,
      meanDistanceToDockM: 1,
      congestionScore: 0,
      goldenZone: false,
      parameters: p,
    });

    expect(pickStopSec({ quantity: 1, goldenZone: false }, p)).toBeCloseTo(
      line - p.queueSec,
      6,
    );
  });

  it("kuyruğu tur başına bir kez sayar", () => {
    const p = DEFAULT_PICK_TIME_PARAMETERS;
    const estimate = estimatePickTourSec({
      stops: [stop(), stop({ locationCode: "B-05-01" })],
      returnDistanceM: 20,
      equipment: "cart",
    });

    // Hazırlık = tur kurulumu + tek bir kuyruk; durak sayısıyla artmaz.
    expect(estimate.setupSec).toBeCloseTo(
      DEFAULT_PICK_TOUR_PARAMETERS.tourSetupSec + p.queueSec,
      6,
    );
  });

  it("duraklar arası mesafeyi ekipman hızıyla süreye çevirir", () => {
    const estimate = estimatePickTourSec({
      stops: [stop({ travelFromPreviousM: 60 })],
      returnDistanceM: 40,
      equipment: "cart",
    });

    // cart 1.0 m/sn: 60 m gidiş + 40 m dönüş.
    expect(estimate.travelSec).toBeCloseTo(100, 6);
    expect(estimate.totalDistanceM).toBeCloseTo(100, 6);
  });

  it("ekipman hızlandıkça travel süresi düşer, toplama süresi değişmez", () => {
    const base = { stops: [stop({ travelFromPreviousM: 90 })], returnDistanceM: 0 };
    const cart = estimatePickTourSec({ ...base, equipment: "cart" });
    const forklift = estimatePickTourSec({ ...base, equipment: "forklift" });

    expect(forklift.travelSec).toBeLessThan(cart.travelSec);
    expect(forklift.pickSec).toBeCloseTo(cart.pickSec, 6);
  });

  it("miktarı elleçleme süresine yansıtır", () => {
    const p = DEFAULT_PICK_TIME_PARAMETERS;
    const one = pickStopSec({ quantity: 1, goldenZone: true }, p);
    const four = pickStopSec({ quantity: 4, goldenZone: true }, p);

    expect(four - one).toBeCloseTo(p.handleSec * 3, 6);
  });

  it("altın bölge dışındaki gözde ergonomi cezası uygular", () => {
    const p = DEFAULT_PICK_TIME_PARAMETERS;
    const golden = pickStopSec({ quantity: 1, goldenZone: true }, p);
    const upper = pickStopSec({ quantity: 1, goldenZone: false }, p);

    expect(upper - golden).toBeCloseTo(p.nonGoldenPenaltySec, 6);
  });

  it("yoğunluğu yalnız gidiş bacaklarına uygular", () => {
    const clear = estimatePickTourSec({
      stops: [stop({ travelFromPreviousM: 50, congestionScore: 0 })],
      returnDistanceM: 50,
      equipment: "cart",
    });
    const busy = estimatePickTourSec({
      stops: [stop({ travelFromPreviousM: 50, congestionScore: 1 })],
      returnDistanceM: 50,
      equipment: "cart",
    });

    expect(clear.congestionSec).toBe(0);
    expect(busy.congestionSec).toBeCloseTo(
      50 * DEFAULT_PICK_TIME_PARAMETERS.congestionFactor,
      6,
    );
    // Dönüş bacağı yoğunluktan etkilenmez; travel ikisinde de aynı.
    expect(busy.travelSec).toBeCloseTo(clear.travelSec, 6);
  });

  it("kümülatif süre bileşenlerin toplamıyla tutarlıdır", () => {
    const estimate = estimatePickTourSec({
      stops: [
        stop({ locationCode: "A-01-01", travelFromPreviousM: 25 }),
        stop({ locationCode: "B-05-02", travelFromPreviousM: 40, quantity: 3 }),
        stop({ locationCode: "C-09-04", travelFromPreviousM: 35, goldenZone: false }),
      ],
      returnDistanceM: 55,
      equipment: "cart",
    });

    const last = estimate.stops[estimate.stops.length - 1];
    // Son durağın kümülatifi = toplam − dönüş traveli − bırakma.
    const returnSec = 55 / DEFAULT_PICK_TOUR_PARAMETERS.equipmentSpeedMps.cart;
    expect(last.cumulativeSec).toBeCloseTo(
      estimate.totalSec - returnSec - estimate.depositSec,
      0,
    );

    expect(estimate.totalSec).toBeCloseTo(
      estimate.setupSec +
        estimate.travelSec +
        estimate.congestionSec +
        estimate.pickSec +
        estimate.depositSec,
      0,
    );
  });

  it("bırakma süresi birim sayısıyla artar", () => {
    const few = estimatePickTourSec({
      stops: [stop({ quantity: 1 })],
      returnDistanceM: 0,
      equipment: "cart",
    });
    const many = estimatePickTourSec({
      stops: [stop({ quantity: 11 })],
      returnDistanceM: 0,
      equipment: "cart",
    });

    expect(many.depositSec - few.depositSec).toBeCloseTo(
      DEFAULT_PICK_TOUR_PARAMETERS.depositPerUnitSec * 10,
      6,
    );
  });

  it("makespan toplam değil, en geç biten turdur", () => {
    // Paralel toplayıcılarda sipariş son tur bitince hazırdır.
    expect(tourMakespanSec([{ totalSec: 300 }, { totalSec: 480 }, { totalSec: 210 }])).toBe(
      480,
    );
    expect(tourMakespanSec([])).toBe(0);
  });

  it("tanımsız ekipman hızıyla sessizce çalışmaz", () => {
    expect(() =>
      estimatePickTourSec({
        stops: [stop()],
        returnDistanceM: 0,
        equipment: "cart",
        parameters: {
          ...DEFAULT_PICK_TOUR_PARAMETERS,
          equipmentSpeedMps: { manual: 1.2, cart: 0, forklift: 1.8 },
        },
      }),
    ).toThrow(/hız/);
  });

  it("aynı girdi için deterministiktir", () => {
    const input = {
      stops: [stop(), stop({ locationCode: "D-12-03", quantity: 2 })],
      returnDistanceM: 30,
      equipment: "cart" as const,
    };
    expect(JSON.stringify(estimatePickTourSec(input))).toBe(
      JSON.stringify(estimatePickTourSec(input)),
    );
  });
});
