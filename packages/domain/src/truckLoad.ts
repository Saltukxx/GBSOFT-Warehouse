/**
 * Rota-duyarlı araç yükleme alan modeli ve solver'dan bağımsız doğrulayıcı.
 *
 * Koordinat sistemi araç yerelidir:
 *   x → ön duvardan arka kapıya, y → soldan sağa, z → tabandan yukarı.
 * Ölçüler metre, ağırlıklar kilogramdır. Bu modül I/O ve solver bilmez;
 * solver çıktısını güvenlik kurallarıyla sıfırdan yeniden hesaplar.
 */

export type VehicleKind = "rigid-truck" | "semi-trailer" | "iso-container";

export type VehicleObstacle = {
  code: string;
  label: string;
  x: number;
  y: number;
  z: number;
  lengthM: number;
  widthM: number;
  heightM: number;
};

export type VehicleAxleGroup = {
  code: string;
  label: string;
  /** Ön duvardan itibaren boyuna konum. */
  positionX: number;
  /** Boş aracın bu gruptaki statik yükü. */
  emptyLoadKg: number;
  maxLoadKg: number;
};

export type VehicleTemplate = {
  code: string;
  name: string;
  kind: VehicleKind;
  internalLengthM: number;
  internalWidthM: number;
  internalHeightM: number;
  rearDoor: {
    widthM: number;
    heightM: number;
    sillHeightM: number;
  };
  maxPayloadKg: number;
  axleGroups: VehicleAxleGroup[];
  obstacles: VehicleObstacle[];
  /** Güvenli yük ağırlık merkezi zarfı, araç yerelinde. */
  cogEnvelope: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    maxZ: number;
  };
  rulesVersion: string;
  geometrySource: "measured" | "manufacturer" | "golden-assumption";
};

export type TruckLoadUnit = {
  code: string;
  lengthM: number;
  widthM: number;
  heightM: number;
  grossWeightKg: number;
  stopCode: string;
  /** 1 ilk teslimat durağıdır. */
  stopSeq: number;
  rotation: "fixed" | "yaw";
  /** Palet gibi yalnız araç tabanında taşınabilen kök birim. */
  floorOnly: boolean;
};

export type TruckLoadPosition = {
  unitCode: string;
  /** Sol-ön-alt köşe. */
  x: number;
  y: number;
  z: number;
  lengthM: number;
  widthM: number;
  heightM: number;
  /** Fiziksel yükleme sırası; 1 ilk araca giren birimdir. */
  seq: number;
  locked?: boolean;
};

export type TruckLoadPlan = {
  vehicle: VehicleTemplate;
  units: TruckLoadUnit[];
  positions: TruckLoadPosition[];
};

export type TruckLoadViolationCode =
  | "unknown-unit"
  | "unplaced-unit"
  | "duplicate-unit"
  | "invalid-load-sequence"
  | "invalid-orientation"
  | "door-clearance"
  | "out-of-bounds"
  | "obstacle-overlap"
  | "load-overlap"
  | "floor-only"
  | "over-payload"
  | "invalid-axle-layout"
  | "axle-overload"
  | "cog-outside-envelope"
  | "stop-access-blocked"
  | "stop-precedence";

export type TruckLoadViolation = {
  code: TruckLoadViolationCode;
  unitCodes: string[];
  message: string;
};

export type TruckLoadValidation = {
  valid: boolean;
  violations: TruckLoadViolation[];
  payloadKg: number;
  volumeUtilizationPct: number;
  centerOfGravity: { x: number; y: number; z: number };
  axleLoads: Array<{
    code: string;
    emptyLoadKg: number;
    payloadLoadKg: number;
    totalLoadKg: number;
    maxLoadKg: number;
    utilizationPct: number;
  }>;
  rehandlingRiskCount: number;
};

export type TruckLoadPlanView = {
  id: string;
  code: string;
  runId: string;
  state: "draft" | "validated" | "rejected" | "published";
  vehicle: VehicleTemplate;
  payloadKg: number;
  volumeUtilizationPct: number;
  centerOfGravity: { x: number; y: number; z: number };
  axleLoads: TruckLoadValidation["axleLoads"];
  rehandlingRiskCount: number;
  violations: TruckLoadViolation[];
  placements: Array<
    TruckLoadPosition & {
      skuCode: string | null;
      stopCode: string;
      stopSeq: number;
      grossWeightKg: number;
    }
  >;
  createdAt: string;
};

export type LoadExecutionState =
  | "shadow-published"
  | "loading"
  | "deviated"
  | "completed";

export type LoadScanOutcome =
  | "confirmed"
  | "missing"
  | "damaged"
  | "out-of-sequence"
  | "unknown";

export type LoadScanEventView = {
  id: string;
  scannedCode: string;
  unitCode: string | null;
  expectedSeq: number | null;
  actualSeq: number | null;
  outcome: LoadScanOutcome;
  note: string | null;
  scannedAt: string;
};

export type LoadExecutionView = {
  id: string;
  planId: string;
  mode: "shadow";
  state: LoadExecutionState;
  currentSeq: number;
  loadedCount: number;
  totalCount: number;
  deviationCount: number;
  nextExpectedCode: string | null;
  replacementPlanId: string | null;
  publishedAt: string;
  completedAt: string | null;
  events: LoadScanEventView[];
};

export type LoadInstructionStep = {
  seq: number;
  unitCode: string;
  sscc: string | null;
  skuCode: string | null;
  stopCode: string;
  stopSeq: number;
  position: { x: number; y: number; z: number };
  dimensions: { lengthM: number; widthM: number; heightM: number };
  grossWeightKg: number;
};

export type LoadInstructionSheet = {
  planId: string;
  planCode: string;
  shipmentCode: string;
  vehicleCode: string;
  vehicleName: string;
  mode: "shadow";
  generatedAt: string;
  steps: LoadInstructionStep[];
};

const EPSILON = 1e-4;

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

type BoxLike = Pick<
  TruckLoadPosition,
  "x" | "y" | "z" | "lengthM" | "widthM" | "heightM"
>;

function overlap1d(a: number, aSize: number, b: number, bSize: number): number {
  return Math.min(a + aSize, b + bSize) - Math.max(a, b);
}

function boxesIntersect(a: BoxLike, b: BoxLike): boolean {
  return (
    overlap1d(a.x, a.lengthM, b.x, b.lengthM) > EPSILON &&
    overlap1d(a.y, a.widthM, b.y, b.widthM) > EPSILON &&
    overlap1d(a.z, a.heightM, b.z, b.heightM) > EPSILON
  );
}

function lateralOverlap(a: BoxLike, b: BoxLike): boolean {
  return overlap1d(a.y, a.widthM, b.y, b.widthM) > EPSILON;
}

function orientationAllowed(unit: TruckLoadUnit, position: TruckLoadPosition): boolean {
  const exact =
    Math.abs(unit.lengthM - position.lengthM) <= EPSILON &&
    Math.abs(unit.widthM - position.widthM) <= EPSILON &&
    Math.abs(unit.heightM - position.heightM) <= EPSILON;
  if (exact) return true;
  return (
    unit.rotation === "yaw" &&
    Math.abs(unit.widthM - position.lengthM) <= EPSILON &&
    Math.abs(unit.lengthM - position.widthM) <= EPSILON &&
    Math.abs(unit.heightM - position.heightM) <= EPSILON
  );
}

/**
 * Yükün boyuna ağırlığını komşu aks gruplarına doğrusal dağıtır.
 *
 * Bu bir tam süspansiyon modeli değildir; sabit araç şablonunun statik
 * reaksiyon hesabıdır. Canlı limitler uzman onaylı rule pack'ten gelmelidir.
 */
function axlePayloadLoads(
  vehicle: VehicleTemplate,
  weightedPoints: Array<{ x: number; weightKg: number }>,
): number[] {
  const axles = [...vehicle.axleGroups].sort((a, b) => a.positionX - b.positionX);
  const loads = axles.map(() => 0);

  for (const point of weightedPoints) {
    if (point.x <= axles[0].positionX) {
      loads[0] += point.weightKg;
      continue;
    }
    if (point.x >= axles[axles.length - 1].positionX) {
      loads[loads.length - 1] += point.weightKg;
      continue;
    }
    const rightIndex = axles.findIndex((axle) => axle.positionX >= point.x);
    const leftIndex = rightIndex - 1;
    const span = axles[rightIndex].positionX - axles[leftIndex].positionX;
    const rightShare = (point.x - axles[leftIndex].positionX) / span;
    loads[leftIndex] += point.weightKg * (1 - rightShare);
    loads[rightIndex] += point.weightKg * rightShare;
  }
  return loads;
}

/** Solver çıktısından bağımsız truck-load doğrulama kapısı. */
export function validateTruckLoadPlan(plan: TruckLoadPlan): TruckLoadValidation {
  const { vehicle } = plan;
  const unitByCode = new Map(plan.units.map((unit) => [unit.code, unit]));
  const violations: TruckLoadViolation[] = [];
  const add = (
    code: TruckLoadViolationCode,
    unitCodes: string[],
    message: string,
  ) => violations.push({ code, unitCodes, message });

  const positionCounts = new Map<string, number>();
  const sequenceCounts = new Map<number, number>();
  for (const position of plan.positions) {
    positionCounts.set(position.unitCode, (positionCounts.get(position.unitCode) ?? 0) + 1);
    sequenceCounts.set(position.seq, (sequenceCounts.get(position.seq) ?? 0) + 1);
    const unit = unitByCode.get(position.unitCode);
    if (!unit) {
      add("unknown-unit", [position.unitCode], `${position.unitCode} yük listesinde bulunmuyor.`);
      continue;
    }
    if (!orientationAllowed(unit, position)) {
      add(
        "invalid-orientation",
        [unit.code],
        `${unit.code} araç içinde izin verilmeyen yönde çevrilmiş.`,
      );
    }
    if (
      Math.min(position.lengthM, position.widthM) > vehicle.rearDoor.widthM + EPSILON ||
      position.heightM > vehicle.rearDoor.heightM + EPSILON
    ) {
      add(
        "door-clearance",
        [unit.code],
        `${unit.code} arka kapı açıklığından geçmiyor.`,
      );
    }
    if (
      position.x < -EPSILON ||
      position.y < -EPSILON ||
      position.z < -EPSILON ||
      position.x + position.lengthM > vehicle.internalLengthM + EPSILON ||
      position.y + position.widthM > vehicle.internalWidthM + EPSILON ||
      position.z + position.heightM > vehicle.internalHeightM + EPSILON
    ) {
      add("out-of-bounds", [unit.code], `${unit.code} araç iç hacminin dışına taşıyor.`);
    }
    if (unit.floorOnly && position.z > EPSILON) {
      add("floor-only", [unit.code], `${unit.code} yalnız araç tabanında taşınabilir.`);
    }
    for (const obstacle of vehicle.obstacles) {
      if (boxesIntersect(position, obstacle)) {
        add(
          "obstacle-overlap",
          [unit.code],
          `${unit.code}, ${obstacle.label} engeliyle çakışıyor.`,
        );
      }
    }
  }

  for (const [seq, count] of sequenceCounts) {
    if (!Number.isInteger(seq) || seq < 1 || count > 1) {
      add(
        "invalid-load-sequence",
        plan.positions.filter((position) => position.seq === seq).map((position) => position.unitCode),
        `Yükleme sırası pozitif ve benzersiz olmalı; ${seq} değeri ${count} kez kullanıldı.`,
      );
    }
  }

  for (const unit of plan.units) {
    const count = positionCounts.get(unit.code) ?? 0;
    if (count === 0) add("unplaced-unit", [unit.code], `${unit.code} araca yerleştirilmemiş.`);
    if (count > 1) add("duplicate-unit", [unit.code], `${unit.code} araçta ${count} kez yer alıyor.`);
  }

  for (let index = 0; index < plan.positions.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < plan.positions.length; otherIndex += 1) {
      const a = plan.positions[index];
      const b = plan.positions[otherIndex];
      if (boxesIntersect(a, b)) {
        add("load-overlap", [a.unitCode, b.unitCode], `${a.unitCode} ile ${b.unitCode} çakışıyor.`);
      }
    }
  }

  const knownPositions = plan.positions
    .map((position) => ({ position, unit: unitByCode.get(position.unitCode) }))
    .filter(
      (entry): entry is { position: TruckLoadPosition; unit: TruckLoadUnit } =>
        entry.unit !== undefined,
    );
  const payloadKg = knownPositions.reduce((sum, entry) => sum + entry.unit.grossWeightKg, 0);
  if (payloadKg > vehicle.maxPayloadKg + EPSILON) {
    add(
      "over-payload",
      knownPositions.map((entry) => entry.unit.code),
      `Toplam yük ${round(payloadKg, 1)} kg, araç kapasitesi ${vehicle.maxPayloadKg} kg.`,
    );
  }

  let rehandlingRiskCount = 0;
  for (const target of knownPositions) {
    for (const blocker of knownPositions) {
      if (target === blocker || target.unit.stopSeq >= blocker.unit.stopSeq) continue;
      const targetCenterX = target.position.x + target.position.lengthM / 2;
      const blockerCenterX = blocker.position.x + blocker.position.lengthM / 2;
      // Arka kapı x=internalLengthM'dedir. Sonraki durağın yükü hedef ile
      // kapı arasında ve aynı yanal koridordaysa hedef erişilemez.
      if (blockerCenterX > targetCenterX + EPSILON && lateralOverlap(target.position, blocker.position)) {
        rehandlingRiskCount += 1;
        add(
          "stop-access-blocked",
          [target.unit.code, blocker.unit.code],
          `${target.unit.code} (${target.unit.stopCode}) yüküne ${blocker.unit.code} kaldırılmadan erişilemiyor.`,
        );
      }
      // Sonraki durak yükü önce araca girmelidir; böylece derine yerleşir.
      if (blocker.position.seq > target.position.seq) {
        add(
          "stop-precedence",
          [blocker.unit.code, target.unit.code],
          `${blocker.unit.code} sonraki durağa ait ama ${target.unit.code}'den sonra yükleniyor.`,
        );
      }
    }
  }

  const totalWeight = payloadKg || 1;
  const centerOfGravity = {
    x: round(
      knownPositions.reduce(
        (sum, entry) =>
          sum +
          (entry.position.x + entry.position.lengthM / 2) * entry.unit.grossWeightKg,
        0,
      ) / totalWeight,
    ),
    y: round(
      knownPositions.reduce(
        (sum, entry) =>
          sum + (entry.position.y + entry.position.widthM / 2) * entry.unit.grossWeightKg,
        0,
      ) / totalWeight,
    ),
    z: round(
      knownPositions.reduce(
        (sum, entry) =>
          sum + (entry.position.z + entry.position.heightM / 2) * entry.unit.grossWeightKg,
        0,
      ) / totalWeight,
    ),
  };
  if (
    knownPositions.length > 0 &&
    (centerOfGravity.x < vehicle.cogEnvelope.minX - EPSILON ||
      centerOfGravity.x > vehicle.cogEnvelope.maxX + EPSILON ||
      centerOfGravity.y < vehicle.cogEnvelope.minY - EPSILON ||
      centerOfGravity.y > vehicle.cogEnvelope.maxY + EPSILON ||
      centerOfGravity.z > vehicle.cogEnvelope.maxZ + EPSILON)
  ) {
    add(
      "cog-outside-envelope",
      knownPositions.map((entry) => entry.unit.code),
      `Yük ağırlık merkezi güvenli zarfın dışında (x ${centerOfGravity.x}, y ${centerOfGravity.y}, z ${centerOfGravity.z} m).`,
    );
  }

  let axleLoads: TruckLoadValidation["axleLoads"] = [];
  const sortedAxles = [...vehicle.axleGroups].sort((a, b) => a.positionX - b.positionX);
  if (
    sortedAxles.length < 2 ||
    sortedAxles.some(
      (axle, index) =>
        axle.positionX < 0 ||
        axle.positionX > vehicle.internalLengthM ||
        (index > 0 && Math.abs(axle.positionX - sortedAxles[index - 1].positionX) <= EPSILON),
    )
  ) {
    add("invalid-axle-layout", [], "Araç şablonunda en az iki farklı ve geçerli aks konumu olmalı.");
  } else {
    const payloadLoads = axlePayloadLoads(
      vehicle,
      knownPositions.map((entry) => ({
        x: entry.position.x + entry.position.lengthM / 2,
        weightKg: entry.unit.grossWeightKg,
      })),
    );
    axleLoads = sortedAxles.map((axle, index) => {
      const totalLoadKg = axle.emptyLoadKg + payloadLoads[index];
      if (totalLoadKg > axle.maxLoadKg + EPSILON) {
        add(
          "axle-overload",
          knownPositions.map((entry) => entry.unit.code),
          `${axle.label} ${round(totalLoadKg, 1)} kg ile ${axle.maxLoadKg} kg sınırını aşıyor.`,
        );
      }
      return {
        code: axle.code,
        emptyLoadKg: round(axle.emptyLoadKg, 1),
        payloadLoadKg: round(payloadLoads[index], 1),
        totalLoadKg: round(totalLoadKg, 1),
        maxLoadKg: axle.maxLoadKg,
        utilizationPct: round((totalLoadKg / axle.maxLoadKg) * 100, 1),
      };
    });
  }

  const usedVolumeM3 = knownPositions.reduce(
    (sum, entry) =>
      sum + entry.position.lengthM * entry.position.widthM * entry.position.heightM,
    0,
  );
  const internalVolumeM3 =
    vehicle.internalLengthM * vehicle.internalWidthM * vehicle.internalHeightM;

  return {
    valid: violations.length === 0,
    violations,
    payloadKg: round(payloadKg, 1),
    volumeUtilizationPct: round((usedVolumeM3 / internalVolumeM3) * 100, 1),
    centerOfGravity,
    axleLoads,
    rehandlingRiskCount,
  };
}

/**
 * Başlangıç araçları yalnız golden senaryo içindir; canlı limit değildir.
 * Müşteri kurulumunda üretici/saha ölçümüyle değiştirilmeden yayın kapısı
 * açılamaz (`geometrySource: golden-assumption`).
 */
export const DEFAULT_VEHICLE_TEMPLATES: readonly VehicleTemplate[] = [
  {
    code: "RIGID-12T",
    name: "12 t kapalı kasa kamyon",
    kind: "rigid-truck",
    internalLengthM: 7.2,
    internalWidthM: 2.45,
    internalHeightM: 2.45,
    rearDoor: { widthM: 2.35, heightM: 2.35, sillHeightM: 1.05 },
    maxPayloadKg: 7_000,
    axleGroups: [
      { code: "FRONT", label: "Ön aks", positionX: 1.25, emptyLoadKg: 3_000, maxLoadKg: 6_500 },
      { code: "REAR", label: "Arka aks grubu", positionX: 5.35, emptyLoadKg: 2_000, maxLoadKg: 10_500 },
    ],
    obstacles: [
      { code: "WL", label: "Sol teker yuvası", x: 4.65, y: 0, z: 0, lengthM: 1.25, widthM: 0.28, heightM: 0.24 },
      { code: "WR", label: "Sağ teker yuvası", x: 4.65, y: 2.17, z: 0, lengthM: 1.25, widthM: 0.28, heightM: 0.24 },
    ],
    cogEnvelope: { minX: 1.4, maxX: 5.9, minY: 0.72, maxY: 1.73, maxZ: 1.45 },
    rulesVersion: "golden-vehicle-rules-v1",
    geometrySource: "golden-assumption",
  },
  {
    code: "SEMI-13M6",
    name: "13,6 m tenteli yarı römork",
    kind: "semi-trailer",
    internalLengthM: 13.6,
    internalWidthM: 2.48,
    internalHeightM: 2.7,
    rearDoor: { widthM: 2.46, heightM: 2.62, sillHeightM: 1.2 },
    maxPayloadKg: 24_000,
    axleGroups: [
      { code: "KINGPIN", label: "Kingpin reaksiyonu", positionX: 1.3, emptyLoadKg: 4_500, maxLoadKg: 12_000 },
      { code: "TRIDEM", label: "Römork üçlü aks", positionX: 11.2, emptyLoadKg: 3_000, maxLoadKg: 27_000 },
    ],
    obstacles: [],
    cogEnvelope: { minX: 3, maxX: 10.8, minY: 0.72, maxY: 1.76, maxZ: 1.55 },
    rulesVersion: "golden-vehicle-rules-v1",
    geometrySource: "golden-assumption",
  },
  {
    code: "ISO-40HC",
    name: "40 ft High Cube konteyner",
    kind: "iso-container",
    internalLengthM: 12.03,
    internalWidthM: 2.35,
    internalHeightM: 2.69,
    rearDoor: { widthM: 2.34, heightM: 2.58, sillHeightM: 1.2 },
    maxPayloadKg: 26_500,
    axleGroups: [
      { code: "FRONT-SUPPORT", label: "Ön şasi desteği", positionX: 1.25, emptyLoadKg: 3_800, maxLoadKg: 13_000 },
      { code: "REAR-SUPPORT", label: "Arka şasi aks grubu", positionX: 10.15, emptyLoadKg: 3_200, maxLoadKg: 27_000 },
    ],
    obstacles: [],
    cogEnvelope: { minX: 2.6, maxX: 9.6, minY: 0.68, maxY: 1.67, maxZ: 1.55 },
    rulesVersion: "golden-vehicle-rules-v1",
    geometrySource: "golden-assumption",
  },
];
