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
  /**
   * Bu grup yere basmaz.
   *
   * Yarı römorkun ön mesnedi bir dingil değil, kingpin'dir: yükü beşinci
   * teker üzerinden çekiciye aktarır. Buradaki kuvvet bir dingil yükü gibi
   * denetlenemez — çekicinin yönlendirme ve tahrik dingillerine dağılır ve
   * asıl yasal sınırlar orada uygulanır. `maxLoadKg` bu grupta beşinci
   * tekerin düşey kapasitesidir.
   */
  coupling?: boolean;
};

/**
 * Çekicinin bir dingil grubu.
 *
 * Konum, römorkun kendi x ekseninde ifade edilir: 0 römorkun ön duvarıdır ve
 * çekici önde durduğu için yönlendirme dingili negatif çıkar. Tek eksen
 * kullanmak iki kademeli hesabı doğrudan yapılabilir kılıyor.
 */
export type TractorAxle = {
  code: string;
  label: string;
  positionX: number;
  /** Çekicinin kendi darasından bu dingile düşen pay. */
  tareLoadKg: number;
  maxLoadKg: number;
  /** Tahrikli dingil; asgari tahrik payı kuralı buna uygulanır. */
  driven: boolean;
  /** Yönlendirme dingili; asgari yönlendirme payı kuralı buna uygulanır. */
  steering: boolean;
};

/**
 * Yarı römorku çeken birim.
 *
 * Rijit araçta ve şasi üstü konteynerde yoktur; o durumda `axleGroups`
 * doğrudan yere basan dingillerdir.
 */
export type TractorSpec = {
  code: string;
  label: string;
  axles: TractorAxle[];
  /** Boş çekicinin toplam ağırlığı; dingil paylarının toplamı olmalıdır. */
  tareKg: number;
};

/**
 * Yasal eşikler.
 *
 * Değerler 96/53/AT ve Karayolları Trafik Yönetmeliği'nin ortak
 * uygulamasından alınmıştır ve şablon varsayılanıdır: gerçek sefer ruhsat,
 * dingil mesafesi ve ülke istisnalarına göre değişir.
 */
export type VehicleRegulation = {
  /** Kombinasyonun yasal azami yüklü ağırlığı (kg). */
  maxCombinationWeightKg: number;
  /**
   * Tahrikli dingil(ler) kombinasyonun en az bu oranını taşımalı.
   *
   * 96/53/AT Ek I 4.1: yüklü ağırlığın %25'i. Yükü tamamen arkaya kaydırmak
   * dingil sınırlarını rahatlatır ama çekişi bitirir; kısıtı iki taraflı
   * yapan kural budur.
   */
  minDriveAxleShare?: number;
  /**
   * Yönlendirme dingili **çekicinin kendi yüklü ağırlığının** en az bu
   * oranını taşımalı.
   *
   * Referans bilerek katar değil çekicidir. Katara göre ölçmek fiziksel
   * olarak yanlış: 32 t'lik bir katarın %20'si 6,4 t eder ve bu, 7,5 t
   * sınırlı bir yönlendirme dingilinin neredeyse tamamıdır — gerçekte yüklü
   * bir çekicide ön dingil katarın ~%17'sini taşır ve bu normaldir. Kural
   * direksiyon hâkimiyetiyle ilgilidir ve çeken aracın kendi dengesine bakar.
   */
  minSteerAxleShare?: number;
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
  /** Yarı römorkta çeken birim; rijit araçta ve konteynerde yok. */
  tractor?: TractorSpec;
  regulation?: VehicleRegulation;
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
  | "fifth-wheel-overload"
  | "drive-axle-underload"
  | "steer-axle-underload"
  | "over-combination-weight"
  | "cog-outside-envelope"
  | "stop-access-blocked"
  | "stop-precedence";

export type TruckLoadViolation = {
  code: TruckLoadViolationCode;
  unitCodes: string[];
  message: string;
};

/**
 * Bir mesnedin türü.
 *
 * Rapor bunları ayırmak zorunda: `coupling` yere basmaz ve yasal dingil
 * sınırına tabi değildir, `tractor-axle` ise römorkun değil çekicinin
 * ruhsatındadır.
 */
export type AxleLoadKind = "trailer-axle" | "coupling" | "tractor-axle";

export type AxleLoadReport = {
  code: string;
  label: string;
  kind: AxleLoadKind;
  positionX: number;
  emptyLoadKg: number;
  payloadLoadKg: number;
  totalLoadKg: number;
  maxLoadKg: number;
  utilizationPct: number;
};

/**
 * Ağırlık dağılımının okunabilir dökümü.
 *
 * Bir dingil yükü tek başına anlamsızdır: hangi kütleden, hangi kaldıraçtan
 * geldiği bilinmeden ne düzeltileceği de bilinmez. Bu rapor zinciri taşır.
 */
export type WeightDistributionReport = {
  payloadKg: number;
  trailerTareKg: number;
  tractorTareKg: number;
  /** Çekici + römork + yük. */
  combinationKg: number;
  maxCombinationKg: number | null;
  /** Beşinci tekere binen düşey kuvvet; çekicisiz araçta boş. */
  couplingLoadKg: number | null;
  couplingCapacityKg: number | null;
  /** Çekicinin kendi yüklü ağırlığı: darası + kaplin kuvveti. */
  tractorLadenKg: number | null;
  /** Tahrikli dingillerin **katar** içindeki payı (96/53/AT Ek I 4.1). */
  driveAxleSharePct: number | null;
  minDriveAxleSharePct: number | null;
  /** Yönlendirme dingilinin **çekicinin yüklü ağırlığı** içindeki payı. */
  steerAxleSharePct: number | null;
  minSteerAxleSharePct: number | null;
};

export type TruckLoadValidation = {
  valid: boolean;
  violations: TruckLoadViolation[];
  payloadKg: number;
  volumeUtilizationPct: number;
  centerOfGravity: { x: number; y: number; z: number };
  axleLoads: AxleLoadReport[];
  weightDistribution: WeightDistributionReport;
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
  weightDistribution: WeightDistributionReport;
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
 * Ağırlıkları mesnetlere statik denge ile dağıtır.
 *
 * İki mesnette çözüm kesindir ve konsol yükünü de doğru verir:
 *
 *   R_a = W · (x_b − x) / (x_b − x_a),  R_b = W − R_a
 *
 * Mesnetlerin dışına düşen kütlede bu bağıntı **negatif** reaksiyon üretir ve
 * bu fiziksel gerçektir: arka dingil grubunun arkasına konan yük kingpin'i
 * kaldırır. Önceki uygulama böyle bir yükü en yakın mesnede kırpıyordu; bu,
 * kingpin kuvvetini olduğundan büyük, römork dingil yükünü olduğundan küçük
 * gösteriyordu. Tam da "arkaya yığma" davranışının tehlikesi buradan gelir,
 * yani kırpma modeli riski gizliyordu.
 *
 * İkiden çok mesnette sistem statik olarak belirsizdir; komşu mesnetler
 * arasında doğrusal paylaştırma yapılır ve uçlarda kırpılır. Bu bir
 * yaklaşımdır ve süspansiyon dengelemesini modellemez.
 */
function distributeOntoSupports(
  supports: ReadonlyArray<{ positionX: number }>,
  weightedPoints: ReadonlyArray<{ x: number; weightKg: number }>,
): number[] {
  const loads = supports.map(() => 0);
  if (supports.length === 0) return loads;
  if (supports.length === 1) {
    for (const point of weightedPoints) loads[0] += point.weightKg;
    return loads;
  }

  if (supports.length === 2) {
    const span = supports[1].positionX - supports[0].positionX;
    for (const point of weightedPoints) {
      const front = (point.weightKg * (supports[1].positionX - point.x)) / span;
      loads[0] += front;
      loads[1] += point.weightKg - front;
    }
    return loads;
  }

  for (const point of weightedPoints) {
    if (point.x <= supports[0].positionX) {
      loads[0] += point.weightKg;
      continue;
    }
    if (point.x >= supports[supports.length - 1].positionX) {
      loads[loads.length - 1] += point.weightKg;
      continue;
    }
    const rightIndex = supports.findIndex((support) => support.positionX >= point.x);
    const leftIndex = rightIndex - 1;
    const span = supports[rightIndex].positionX - supports[leftIndex].positionX;
    const rightShare = (point.x - supports[leftIndex].positionX) / span;
    loads[leftIndex] += point.weightKg * (1 - rightShare);
    loads[rightIndex] += point.weightKg * rightShare;
  }
  return loads;
}

/**
 * Yükten yere kadar ağırlık zinciri.
 *
 * Yarı römorkta yük doğrudan dingillere binmez. Zincir iki kademelidir:
 *
 *   1. Römork, kingpin ve dingil grubuna oturan bir kiriştir. Yük bu iki
 *      mesnede dağılır.
 *   2. Kingpin'e düşen kuvvet beşinci teker üzerinden çekiciye geçer ve
 *      orada yönlendirme ile tahrik dingiline dağılır.
 *
 * Eski model kingpin'i bir dingil sayıyordu; bu, çekicinin ruhsatındaki asıl
 * yasal sınırları hiç görmemek demekti. Tahrik dingili sınırı pratikte çoğu
 * seferde bağlayıcı olan kısıttır.
 */
export function computeWeightDistribution(
  vehicle: VehicleTemplate,
  weightedPoints: ReadonlyArray<{ x: number; weightKg: number }>,
): { axleLoads: AxleLoadReport[]; report: WeightDistributionReport } {
  const trailerGroups = [...vehicle.axleGroups].sort(
    (a, b) => a.positionX - b.positionX,
  );
  const payloadKg = weightedPoints.reduce((sum, point) => sum + point.weightKg, 0);
  const trailerPayload = distributeOntoSupports(trailerGroups, weightedPoints);

  const trailerReports: AxleLoadReport[] = trailerGroups.map((group, index) => {
    const totalLoadKg = group.emptyLoadKg + trailerPayload[index];
    return {
      code: group.code,
      label: group.label,
      kind: group.coupling ? "coupling" : "trailer-axle",
      positionX: group.positionX,
      emptyLoadKg: round(group.emptyLoadKg, 1),
      payloadLoadKg: round(trailerPayload[index], 1),
      totalLoadKg: round(totalLoadKg, 1),
      maxLoadKg: group.maxLoadKg,
      utilizationPct: round((totalLoadKg / group.maxLoadKg) * 100, 1),
    };
  });

  const trailerTareKg = trailerGroups.reduce(
    (sum, group) => sum + group.emptyLoadKg,
    0,
  );
  const couplingIndex = trailerGroups.findIndex((group) => group.coupling);
  const coupling = couplingIndex >= 0 ? trailerGroups[couplingIndex] : null;
  const couplingLoadKg =
    coupling === null
      ? null
      : coupling.emptyLoadKg + trailerPayload[couplingIndex];

  const tractor = vehicle.tractor;
  const tractorReports: AxleLoadReport[] = [];
  let tractorTareKg = 0;

  if (tractor && coupling && couplingLoadKg !== null) {
    const tractorAxles = [...tractor.axles].sort((a, b) => a.positionX - b.positionX);
    // Kaplin kuvveti çekici üzerinde tek bir noktasal yüktür.
    const fromCoupling = distributeOntoSupports(tractorAxles, [
      { x: coupling.positionX, weightKg: couplingLoadKg },
    ]);
    tractorTareKg = tractorAxles.reduce((sum, axle) => sum + axle.tareLoadKg, 0);

    tractorAxles.forEach((axle, index) => {
      const totalLoadKg = axle.tareLoadKg + fromCoupling[index];
      tractorReports.push({
        code: axle.code,
        label: axle.label,
        kind: "tractor-axle",
        positionX: axle.positionX,
        emptyLoadKg: round(axle.tareLoadKg, 1),
        payloadLoadKg: round(fromCoupling[index], 1),
        totalLoadKg: round(totalLoadKg, 1),
        maxLoadKg: axle.maxLoadKg,
        utilizationPct: round((totalLoadKg / axle.maxLoadKg) * 100, 1),
      });
    });
  }

  // Rapor sırası fiziksel sıradır: yönlendirme dingilinden arka kapıya.
  const axleLoads = [...tractorReports, ...trailerReports].sort(
    (a, b) => a.positionX - b.positionX,
  );

  const combinationKg = payloadKg + trailerTareKg + tractorTareKg;
  const drivenTotal = tractor
    ? tractorReports
        .filter((report) =>
          tractor.axles.some((axle) => axle.code === report.code && axle.driven),
        )
        .reduce((sum, report) => sum + report.totalLoadKg, 0)
    : null;
  const steerTotal = tractor
    ? tractorReports
        .filter((report) =>
          tractor.axles.some((axle) => axle.code === report.code && axle.steering),
        )
        .reduce((sum, report) => sum + report.totalLoadKg, 0)
    : null;

  const tractorLadenKg =
    couplingLoadKg === null || !tractor ? null : tractorTareKg + couplingLoadKg;
  const share = (load: number | null, base: number | null) =>
    load === null || base === null || base <= 0 ? null : round((load / base) * 100, 1);

  return {
    axleLoads,
    report: {
      payloadKg: round(payloadKg, 1),
      trailerTareKg: round(trailerTareKg, 1),
      tractorTareKg: round(tractorTareKg, 1),
      combinationKg: round(combinationKg, 1),
      maxCombinationKg: vehicle.regulation?.maxCombinationWeightKg ?? null,
      couplingLoadKg: couplingLoadKg === null ? null : round(couplingLoadKg, 1),
      couplingCapacityKg: coupling?.maxLoadKg ?? null,
      tractorLadenKg: tractorLadenKg === null ? null : round(tractorLadenKg, 1),
      driveAxleSharePct: share(drivenTotal, combinationKg),
      minDriveAxleSharePct:
        vehicle.regulation?.minDriveAxleShare === undefined
          ? null
          : round(vehicle.regulation.minDriveAxleShare * 100, 1),
      steerAxleSharePct: share(steerTotal, tractorLadenKg),
      minSteerAxleSharePct:
        vehicle.regulation?.minSteerAxleShare === undefined
          ? null
          : round(vehicle.regulation.minSteerAxleShare * 100, 1),
    },
  };
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

  let axleLoads: AxleLoadReport[] = [];
  let weightDistribution: WeightDistributionReport = {
    payloadKg: round(payloadKg, 1),
    trailerTareKg: 0,
    tractorTareKg: 0,
    combinationKg: round(payloadKg, 1),
    maxCombinationKg: vehicle.regulation?.maxCombinationWeightKg ?? null,
    couplingLoadKg: null,
    couplingCapacityKg: null,
    tractorLadenKg: null,
    driveAxleSharePct: null,
    minDriveAxleSharePct: null,
    steerAxleSharePct: null,
    minSteerAxleSharePct: null,
  };

  const sortedAxles = [...vehicle.axleGroups].sort((a, b) => a.positionX - b.positionX);
  if (
    sortedAxles.length < 2 ||
    sortedAxles.some(
      (axle, index) =>
        axle.positionX < 0 ||
        axle.positionX > vehicle.internalLengthM ||
        (index > 0 && Math.abs(axle.positionX - sortedAxles[index - 1].positionX) <= EPSILON),
    ) ||
    // Çekicisi olan araçta kaplin işaretlenmiş olmalı; aksi hâlde kingpin
    // kuvveti bir dingil yükü sanılır ve çekici hiç hesaba girmez.
    (vehicle.tractor !== undefined &&
      (sortedAxles.filter((axle) => axle.coupling).length !== 1 ||
        vehicle.tractor.axles.length < 2))
  ) {
    add(
      "invalid-axle-layout",
      [],
      "Araç şablonunda en az iki farklı dingil konumu, çekicili araçta tek bir kaplin ve en az iki çekici dingili olmalı.",
    );
  } else {
    const distribution = computeWeightDistribution(
      vehicle,
      knownPositions.map((entry) => ({
        x: entry.position.x + entry.position.lengthM / 2,
        weightKg: entry.unit.grossWeightKg,
      })),
    );
    axleLoads = distribution.axleLoads;
    weightDistribution = distribution.report;
    const unitCodes = knownPositions.map((entry) => entry.unit.code);

    for (const axle of axleLoads) {
      if (axle.totalLoadKg <= axle.maxLoadKg + EPSILON) continue;
      // Kaplin aşımı bir dingil aşımı değildir: beşinci tekerin düşey
      // kapasitesi aşılıyor demektir ve çözümü de farklıdır.
      if (axle.kind === "coupling") {
        add(
          "fifth-wheel-overload",
          unitCodes,
          `${axle.label} ${axle.totalLoadKg} kg ile beşinci tekerin ${axle.maxLoadKg} kg düşey kapasitesini aşıyor.`,
        );
      } else {
        add(
          "axle-overload",
          unitCodes,
          `${axle.label} ${axle.totalLoadKg} kg ile ${axle.maxLoadKg} kg sınırını aşıyor.`,
        );
      }
    }

    const report = weightDistribution;
    if (
      report.maxCombinationKg !== null &&
      report.combinationKg > report.maxCombinationKg + EPSILON
    ) {
      add(
        "over-combination-weight",
        unitCodes,
        `Katar ağırlığı ${report.combinationKg} kg ile yasal ${report.maxCombinationKg} kg sınırını aşıyor.`,
      );
    }

    // Asgari paylar yalnız yük varken anlamlı: boş araçta dağılım aracın
    // kendi darasından gelir ve bu bir yükleme kararı değildir.
    if (knownPositions.length > 0) {
      if (
        report.driveAxleSharePct !== null &&
        report.minDriveAxleSharePct !== null &&
        report.driveAxleSharePct < report.minDriveAxleSharePct - EPSILON
      ) {
        add(
          "drive-axle-underload",
          unitCodes,
          `Tahrikli dingil payı %${report.driveAxleSharePct}; asgari %${report.minDriveAxleSharePct} altında kaldığı için çekiş yetersiz.`,
        );
      }
      if (
        report.steerAxleSharePct !== null &&
        report.minSteerAxleSharePct !== null &&
        report.steerAxleSharePct < report.minSteerAxleSharePct - EPSILON
      ) {
        add(
          "steer-axle-underload",
          unitCodes,
          `Yönlendirme dingili çekicinin yüklü ağırlığının %${report.steerAxleSharePct}'ini taşıyor; asgari %${report.minSteerAxleSharePct} altında kaldığı için direksiyon hâkimiyeti düşer.`,
        );
      }
    }
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
    weightDistribution,
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
    // Rijit araçta çekici yok: dingiller doğrudan yere basar, tahrik ve
    // yönlendirme payı kuralları uygulanmaz.
    regulation: { maxCombinationWeightKg: 12_000 },
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
      {
        code: "KINGPIN",
        label: "Kingpin / beşinci teker",
        positionX: 1.3,
        emptyLoadKg: 4_500,
        // Standart 2" kingpin ve beşinci tekerin düşey taşıma kapasitesi.
        // Bu bir dingil sınırı değildir; yasal sınırlar çekicidedir.
        maxLoadKg: 12_000,
        coupling: true,
      },
      { code: "TRIDEM", label: "Römork üçlü aks", positionX: 11.2, emptyLoadKg: 3_000, maxLoadKg: 24_000 },
    ],
    /*
     * Tipik 4x2 çekici. Konumlar römorkun x ekseninde: yönlendirme dingili
     * römorkun ön duvarının önünde kaldığı için negatiftir.
     *
     * Beşinci teker, tahrik dingilinin 0,4 m önüne oturur (fifth wheel lead);
     * çekici dingil aralığı 3,7 m'dir. Bu geometri kaplin kuvvetinin
     * yaklaşık %89'unu tahrik dingiline taşır — yükü arkaya kaydırmanın
     * çekişi neden hızla düşürdüğü buradan gelir.
     */
    tractor: {
      code: "TRACTOR-4X2",
      label: "4x2 çekici",
      tareKg: 7_400,
      axles: [
        {
          code: "STEER",
          label: "Çekici yönlendirme dingili",
          positionX: -2.0,
          tareLoadKg: 4_600,
          maxLoadKg: 7_500,
          driven: false,
          steering: true,
        },
        {
          code: "DRIVE",
          label: "Çekici tahrik dingili",
          positionX: 1.7,
          tareLoadKg: 2_800,
          maxLoadKg: 11_500,
          driven: true,
          steering: false,
        },
      ],
    },
    regulation: {
      maxCombinationWeightKg: 40_000,
      minDriveAxleShare: 0.25,
      minSteerAxleShare: 0.2,
    },
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
      {
        code: "KINGPIN",
        label: "Kingpin / beşinci teker",
        positionX: 1.25,
        emptyLoadKg: 3_800,
        maxLoadKg: 12_000,
        coupling: true,
      },
      { code: "TRIDEM", label: "Şasi üçlü aks", positionX: 10.15, emptyLoadKg: 3_200, maxLoadKg: 24_000 },
    ],
    // Konteyner şasisi de yarı römorktur; aynı çekici geometrisi geçerlidir.
    tractor: {
      code: "TRACTOR-4X2",
      label: "4x2 çekici",
      tareKg: 7_400,
      axles: [
        {
          code: "STEER",
          label: "Çekici yönlendirme dingili",
          positionX: -2.05,
          tareLoadKg: 4_600,
          maxLoadKg: 7_500,
          driven: false,
          steering: true,
        },
        {
          code: "DRIVE",
          label: "Çekici tahrik dingili",
          positionX: 1.65,
          tareLoadKg: 2_800,
          maxLoadKg: 11_500,
          driven: true,
          steering: false,
        },
      ],
    },
    regulation: {
      maxCombinationWeightKg: 40_000,
      minDriveAxleShare: 0.25,
      minSteerAxleShare: 0.2,
    },
    obstacles: [],
    cogEnvelope: { minX: 2.6, maxX: 9.6, minY: 0.68, maxY: 1.67, maxZ: 1.55 },
    rulesVersion: "golden-vehicle-rules-v1",
    geometrySource: "golden-assumption",
  },
];
