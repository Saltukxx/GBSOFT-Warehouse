import { describe, expect, it } from "vitest";
import {
  computeWeightDistribution,
  DEFAULT_VEHICLE_TEMPLATES,
  validateTruckLoadPlan,
  type TruckLoadPlan,
  type TruckLoadPosition,
  type TruckLoadUnit,
  type VehicleTemplate,
} from "./truckLoad.js";

const VEHICLE: VehicleTemplate = {
  code: "TEST-TRUCK",
  name: "Test kamyonu",
  kind: "rigid-truck",
  internalLengthM: 7.2,
  internalWidthM: 2.4,
  internalHeightM: 2.5,
  rearDoor: { widthM: 2.35, heightM: 2.4, sillHeightM: 1 },
  maxPayloadKg: 8_000,
  axleGroups: [
    { code: "F", label: "Ön aks", positionX: 1.2, emptyLoadKg: 2_000, maxLoadKg: 7_000 },
    { code: "R", label: "Arka aks", positionX: 5.8, emptyLoadKg: 2_000, maxLoadKg: 9_000 },
  ],
  obstacles: [],
  cogEnvelope: { minX: 1, maxX: 6.4, minY: 0.5, maxY: 1.9, maxZ: 1.4 },
  rulesVersion: "test-v1",
  geometrySource: "measured",
};

function unit(code: string, stopSeq: number, overrides: Partial<TruckLoadUnit> = {}): TruckLoadUnit {
  return {
    code,
    lengthM: 1.2,
    widthM: 0.8,
    heightM: 1.4,
    grossWeightKg: 1_000,
    stopCode: `S${stopSeq}`,
    stopSeq,
    rotation: "yaw",
    floorOnly: true,
    ...overrides,
  };
}

function position(
  unitCode: string,
  x: number,
  seq: number,
  overrides: Partial<TruckLoadPosition> = {},
): TruckLoadPosition {
  return {
    unitCode,
    x,
    y: 0.8,
    z: 0,
    lengthM: 1.2,
    widthM: 0.8,
    heightM: 1.4,
    seq,
    ...overrides,
  };
}

function validPlan(): TruckLoadPlan {
  return {
    vehicle: VEHICLE,
    units: [unit("FIRST", 1), unit("MIDDLE", 2), unit("LAST", 3)],
    // Son durak önde/derinde ve önce yüklenir; ilk durak arka kapıya yakındır.
    positions: [
      position("LAST", 1.0, 1),
      position("MIDDLE", 2.4, 2),
      position("FIRST", 3.8, 3),
    ],
  };
}

describe("araç şablonları", () => {
  it("üç golden araç ailesini açık varsayım etiketiyle sağlar", () => {
    expect(DEFAULT_VEHICLE_TEMPLATES).toHaveLength(3);
    expect(new Set(DEFAULT_VEHICLE_TEMPLATES.map((vehicle) => vehicle.kind))).toEqual(
      new Set(["rigid-truck", "semi-trailer", "iso-container"]),
    );
    expect(
      DEFAULT_VEHICLE_TEMPLATES.every(
        (vehicle) => vehicle.geometrySource === "golden-assumption",
      ),
    ).toBe(true);
  });
});

describe("truck-load bağımsız doğrulayıcı", () => {
  it("rota sırasına göre erişilebilir ve dengeli planı kabul eder", () => {
    const result = validateTruckLoadPlan(validPlan());

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.payloadKg).toBe(3_000);
    expect(result.rehandlingRiskCount).toBe(0);
    expect(result.axleLoads).toHaveLength(2);
    expect(
      result.axleLoads.reduce((sum, axle) => sum + axle.payloadLoadKg, 0),
    ).toBeCloseTo(3_000, 1);
  });

  it("sonraki durağın yükü ilk durağı kapıda bloklarsa reddeder", () => {
    const plan = validPlan();
    plan.positions = [
      position("FIRST", 1.0, 3),
      position("MIDDLE", 2.4, 2),
      position("LAST", 3.8, 1),
    ];

    const result = validateTruckLoadPlan(plan);

    expect(result.violations.map((violation) => violation.code)).toContain(
      "stop-access-blocked",
    );
    expect(result.rehandlingRiskCount).toBeGreaterThan(0);
  });

  it("durak precedence sırasını bağımsız kontrol eder", () => {
    const plan = validPlan();
    plan.positions[0].seq = 3; // Son durak en son yüklenmiş.

    const result = validateTruckLoadPlan(plan);

    expect(result.violations.map((violation) => violation.code)).toContain(
      "stop-precedence",
    );
  });

  it("araç sınırı, çakışma ve engel ihlallerini yakalar", () => {
    const plan = validPlan();
    plan.vehicle = {
      ...VEHICLE,
      obstacles: [
        {
          code: "WHEEL",
          label: "Teker yuvası",
          x: 1,
          y: 0.8,
          z: 0,
          lengthM: 1,
          widthM: 0.5,
          heightM: 0.3,
        },
      ],
    };
    plan.positions[1].x = 1.4; // LAST ile çakışır.
    plan.positions[2].x = 6.5; // Araç dışına taşar.

    const codes = validateTruckLoadPlan(plan).violations.map(
      (violation) => violation.code,
    );
    expect(codes).toContain("obstacle-overlap");
    expect(codes).toContain("load-overlap");
    expect(codes).toContain("out-of-bounds");
  });

  it("kayıp, mükerrer ve bilinmeyen birimleri sessizce geçmez", () => {
    const plan = validPlan();
    plan.positions = [
      position("FIRST", 3.8, 3),
      position("FIRST", 5.2, 4),
      position("UNKNOWN", 1, 1),
    ];

    const codes = validateTruckLoadPlan(plan).violations.map(
      (violation) => violation.code,
    );
    expect(codes).toContain("duplicate-unit");
    expect(codes).toContain("unplaced-unit");
    expect(codes).toContain("unknown-unit");
  });

  it("toplam yük ve aks limitlerini hard constraint sayar", () => {
    const plan = validPlan();
    plan.vehicle = {
      ...VEHICLE,
      maxPayloadKg: 2_000,
      axleGroups: VEHICLE.axleGroups.map((axle) => ({ ...axle, maxLoadKg: 2_500 })),
    };

    const codes = validateTruckLoadPlan(plan).violations.map(
      (violation) => violation.code,
    );
    expect(codes).toContain("over-payload");
    expect(codes).toContain("axle-overload");
  });

  it("ağırlık merkezi güvenli zarfını uygular", () => {
    const plan = validPlan();
    plan.vehicle = {
      ...VEHICLE,
      cogEnvelope: { ...VEHICLE.cogEnvelope, maxX: 2 },
    };

    expect(
      validateTruckLoadPlan(plan).violations.map((violation) => violation.code),
    ).toContain("cog-outside-envelope");
  });

  it("kapı açıklığını, yönelimi ve floor-only kuralını kontrol eder", () => {
    const plan = validPlan();
    plan.units[0] = unit("FIRST", 1, { rotation: "fixed" });
    plan.positions[2] = position("FIRST", 3.8, 3, {
      lengthM: 0.8,
      widthM: 1.2,
      heightM: 2.45,
      z: 0.1,
    });

    const codes = validateTruckLoadPlan(plan).violations.map(
      (violation) => violation.code,
    );
    expect(codes).toContain("invalid-orientation");
    expect(codes).toContain("door-clearance");
    expect(codes).toContain("floor-only");
  });

  it("geçersiz aks geometrisini açıkça reddeder", () => {
    const plan = validPlan();
    plan.vehicle = { ...VEHICLE, axleGroups: [VEHICLE.axleGroups[0]] };

    const result = validateTruckLoadPlan(plan);
    expect(result.axleLoads).toEqual([]);
    expect(result.violations.map((violation) => violation.code)).toContain(
      "invalid-axle-layout",
    );
  });

  it("yükleme sırasının pozitif ve benzersiz olmasını ister", () => {
    const plan = validPlan();
    plan.positions[0].seq = 0;
    plan.positions[1].seq = plan.positions[2].seq;

    const codes = validateTruckLoadPlan(plan).violations.map(
      (violation) => violation.code,
    );
    expect(codes).toContain("invalid-load-sequence");
  });

  it("aynı girdi için deterministiktir", () => {
    const plan = validPlan();
    expect(JSON.stringify(validateTruckLoadPlan(plan))).toBe(
      JSON.stringify(validateTruckLoadPlan(plan)),
    );
  });
});

/* ------------------------------------------------------------------ */
/* İki kademeli ağırlık zinciri                                        */
/* ------------------------------------------------------------------ */

describe("computeWeightDistribution", () => {
  const SEMI = DEFAULT_VEHICLE_TEMPLATES.find((item) => item.code === "SEMI-13M6")!;

  it("kingpin kuvvetini çekici dingillerine kaldıraç oranıyla dağıtır", () => {
    // Tek bir nokta yük, kingpin ile tridem tam ortasında: pay yarı yarıya.
    const midX = (1.3 + 11.2) / 2;
    const { axleLoads, report } = computeWeightDistribution(SEMI, [
      { x: midX, weightKg: 10_000 },
    ]);

    const by = (code: string) => axleLoads.find((axle) => axle.code === code)!;
    expect(by("KINGPIN").payloadLoadKg).toBeCloseTo(5_000, 1);
    expect(by("TRIDEM").payloadLoadKg).toBeCloseTo(5_000, 1);

    // Kaplin kuvveti = römork darasının kingpin payı + yükün kingpin payı.
    const coupling = 4_500 + 5_000;
    expect(report.couplingLoadKg).toBeCloseTo(coupling, 1);

    // Çekici kirişi: kingpin 1,3 · yönlendirme −2,0 · tahrik 1,7.
    // Tahrik payı = (1,3 − (−2,0)) / (1,7 − (−2,0)) = 3,3 / 3,7.
    const driveShare = 3.3 / 3.7;
    expect(by("DRIVE").payloadLoadKg).toBeCloseTo(coupling * driveShare, 1);
    expect(by("STEER").payloadLoadKg).toBeCloseTo(coupling * (1 - driveShare), 1);
    expect(by("DRIVE").totalLoadKg).toBeCloseTo(2_800 + coupling * driveShare, 1);
    expect(by("STEER").totalLoadKg).toBeCloseTo(4_600 + coupling * (1 - driveShare), 1);
  });

  it("katar ağırlığını çekici ve römork darasıyla birlikte toplar", () => {
    const { report } = computeWeightDistribution(SEMI, [{ x: 6, weightKg: 12_000 }]);
    // Römork darası 4.500 + 3.000; çekici darası 4.600 + 2.800.
    expect(report.trailerTareKg).toBeCloseTo(7_500, 1);
    expect(report.tractorTareKg).toBeCloseTo(7_400, 1);
    expect(report.combinationKg).toBeCloseTo(12_000 + 7_500 + 7_400, 1);
    expect(report.maxCombinationKg).toBe(40_000);
  });

  it("yere basan dingillerin toplamı katar ağırlığına eşittir", () => {
    // Korunum kontrolü: kaplin yere basmaz, iki kez sayılmamalı.
    const { axleLoads, report } = computeWeightDistribution(SEMI, [
      { x: 4, weightKg: 6_000 },
      { x: 9, weightKg: 9_000 },
    ]);
    const grounded = axleLoads
      .filter((axle) => axle.kind !== "coupling")
      .reduce((sum, axle) => sum + axle.totalLoadKg, 0);
    expect(grounded).toBeCloseTo(report.combinationKg, 0);
  });

  it("çekicisiz araçta dingiller doğrudan yere basar", () => {
    const rigid = DEFAULT_VEHICLE_TEMPLATES.find((item) => item.code === "RIGID-12T")!;
    const { axleLoads, report } = computeWeightDistribution(rigid, [
      { x: 3, weightKg: 4_000 },
    ]);
    expect(axleLoads.every((axle) => axle.kind === "trailer-axle")).toBe(true);
    expect(report.couplingLoadKg).toBeNull();
    expect(report.driveAxleSharePct).toBeNull();
  });
});

describe("dingil regülasyonu", () => {
  const SEMI = DEFAULT_VEHICLE_TEMPLATES.find((item) => item.code === "SEMI-13M6")!;

  function semiPlan(unitX: number, weightKg: number): TruckLoadPlan {
    return {
      vehicle: SEMI,
      units: [
        {
          code: "U1",
          lengthM: 1.2,
          widthM: 0.8,
          heightM: 1.45,
          grossWeightKg: weightKg,
          stopCode: "S1",
          stopSeq: 1,
          rotation: "yaw",
          floorOnly: true,
        },
      ],
      positions: [
        {
          unitCode: "U1",
          x: unitX,
          y: 0.8,
          z: 0,
          lengthM: 1.2,
          widthM: 0.8,
          heightM: 1.45,
          seq: 1,
        },
      ],
    };
  }

  it("yük öne yığıldığında tahrik dingilini aşırı yükler", () => {
    // Kingpin'e yakın ağır yük kaplin kuvvetini büyütür; kuvvetin %89'u
    // tahrik dingiline gider ve 11.500 kg sınırını aşar.
    const codes = validateTruckLoadPlan(semiPlan(1.4, 12_000)).violations.map(
      (violation) => violation.code,
    );
    expect(codes).toContain("axle-overload");
  });

  it("yük tamamen arkaya kaydığında tahrik payını asgarinin altına düşürür", () => {
    // Eski model bunu göremezdi: dingil sınırları rahattı, ama çekiş yok.
    const result = validateTruckLoadPlan(semiPlan(11.5, 14_000));
    expect(result.violations.map((violation) => violation.code)).toContain(
      "drive-axle-underload",
    );
    expect(result.weightDistribution.driveAxleSharePct).toBeLessThan(25);
  });

  it("kaplin aşımını dingil aşımından ayrı bildirir", () => {
    const vehicle: VehicleTemplate = {
      ...SEMI,
      axleGroups: SEMI.axleGroups.map((group) =>
        group.coupling ? { ...group, maxLoadKg: 6_000 } : group,
      ),
    };
    const plan = { ...semiPlan(2, 9_000), vehicle };
    expect(validateTruckLoadPlan(plan).violations.map((v) => v.code)).toContain(
      "fifth-wheel-overload",
    );
  });

  it("katar yasal ağırlığını aşan yükü bildirir", () => {
    const codes = validateTruckLoadPlan(semiPlan(6, 26_000)).violations.map(
      (violation) => violation.code,
    );
    expect(codes).toContain("over-combination-weight");
  });
});
