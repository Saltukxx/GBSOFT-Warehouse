import type { Prisma } from "@prisma/client";
import type {
  PickTimeBreakdown,
  PickTimeCalibrationResult,
  PickTimeModelParameters,
  PickTimeModelSnapshot,
  PickTimeTrainingSample,
  PickTimeVarianceRow,
  PickingTimeResponse,
} from "@gbsoft/domain";
import {
  DEFAULT_PICK_TIME_PARAMETERS,
  MIN_PICK_TIME_CALIBRATION_SAMPLES,
  calibratePickTimeModel,
} from "@gbsoft/domain";

type DbClient = Prisma.TransactionClient;

type ModelMetrics = {
  p50MaeSec?: number;
  minimumSampleSize?: number;
};

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function parametersOf(value: Prisma.JsonValue | undefined): PickTimeModelParameters {
  return {
    ...DEFAULT_PICK_TIME_PARAMETERS,
    ...((value ?? {}) as Partial<PickTimeModelParameters>),
  };
}

function nextVersion(current: string | undefined): string {
  if (!current) return "pick-time-1.0.1";
  const match = current.match(/^(.*?)(\d+)$/);
  if (!match) return `${current}.1`;
  return `${match[1]}${Number(match[2]) + 1}`;
}

async function facilityData(db: DbClient, tenantId: string, facilityCode: string) {
  const facility = await db.facility.findUnique({
    where: { tenantId_code: { tenantId, code: facilityCode } },
    select: { id: true, code: true },
  });
  if (!facility) throw new Error(`Tesis bulunamadı: ${facilityCode}`);

  const [layout, model, tasks, events] = await Promise.all([
    db.layoutVersion.findFirst({
      where: { tenantId, facilityId: facility.id, isActive: true },
      orderBy: { version: "desc" },
      include: {
        locations: {
          orderBy: { code: "asc" },
          select: {
            code: true,
            distanceToDockM: true,
            congestionScore: true,
            goldenZone: true,
          },
        },
      },
    }),
    db.pickTimeModel.findFirst({
      where: { tenantId, facilityId: facility.id, isActive: true },
      orderBy: { createdAt: "desc" },
    }),
    db.pickTask.findMany({
      where: { tenantId, wave: { facilityId: facility.id } },
      orderBy: { completedAt: "asc" },
      select: {
        id: true,
        locationCode: true,
        durationSec: true,
        startedAt: true,
        completedAt: true,
        exceptionCode: true,
      },
    }),
    db.event.findMany({
      where: {
        tenantId,
        facilityId: facility.id,
        eventType: { in: ["TASK_STARTED", "TASK_COMPLETED"] },
      },
      select: { eventTime: true, ingestTime: true },
    }),
  ]);

  return { facility, layout, model, tasks, events };
}

function trainingSamples(data: Awaited<ReturnType<typeof facilityData>>) {
  const locations = data.layout?.locations ?? [];
  const meanDistanceToDockM =
    locations.reduce((sum, location) => sum + location.distanceToDockM, 0) /
    Math.max(1, locations.length);
  const locationByCode = new Map(locations.map((location) => [location.code, location]));

  const samples: PickTimeTrainingSample[] = [];
  for (const task of data.tasks) {
    const location = locationByCode.get(task.locationCode);
    // v1 analitik model normal picking görevini kalibre eder. Exception
    // görevleri ayrı bileşendir ve eğitim etiketine karıştırılmaz.
    if (
      !location ||
      task.durationSec === null ||
      !task.startedAt ||
      !task.completedAt ||
      task.exceptionCode
    ) {
      continue;
    }
    samples.push({
      taskId: task.id,
      eventTime: task.completedAt.toISOString(),
      durationSec: task.durationSec,
      distanceToDockM: location.distanceToDockM,
      meanDistanceToDockM,
      congestionScore: location.congestionScore,
      goldenZone: location.goldenZone,
    });
  }
  return { samples, meanDistanceToDockM, locationByCode };
}

function expectedBreakdown(
  parameters: PickTimeModelParameters,
  locations: Array<{
    congestionScore: number;
    goldenZone: boolean;
  }>,
  exceptionRate: number,
): PickTimeBreakdown {
  const meanCongestion =
    locations.reduce((sum, location) => sum + location.congestionScore, 0) /
    Math.max(1, locations.length);
  const nonGoldenRate =
    locations.filter((location) => !location.goldenZone).length /
    Math.max(1, locations.length);
  const congestionSec = parameters.meanTravelSec * meanCongestion * parameters.congestionFactor;
  const reachScanSec = parameters.reachScanSec + parameters.nonGoldenPenaltySec * nonGoldenRate;
  const exceptionSec = exceptionRate * 18;
  const p50Sec =
    parameters.queueSec +
    parameters.meanTravelSec +
    parameters.searchSec +
    reachScanSec +
    parameters.handleSec +
    congestionSec +
    exceptionSec;

  return {
    queueSec: round(parameters.queueSec),
    travelSec: round(parameters.meanTravelSec),
    searchSec: round(parameters.searchSec),
    reachScanSec: round(reachScanSec),
    handleSec: round(parameters.handleSec),
    congestionSec: round(congestionSec),
    exceptionSec: round(exceptionSec),
    p50Sec: round(p50Sec),
    p90Sec: round(p50Sec * parameters.p90Multiplier + parameters.p90OffsetSec),
  };
}

function actualBreakdown(
  data: Awaited<ReturnType<typeof facilityData>>,
  parameters: PickTimeModelParameters,
  meanDistanceToDockM: number,
  locationByCode: Map<
    string,
    { distanceToDockM: number; congestionScore: number; goldenZone: boolean }
  >,
): PickTimeBreakdown | null {
  const attributed: Array<Omit<PickTimeBreakdown, "p50Sec" | "p90Sec"> & { total: number }> = [];
  for (const task of data.tasks) {
    if (task.durationSec === null || task.durationSec <= 0) continue;
    const location = locationByCode.get(task.locationCode);
    if (!location) continue;
    const ratio = meanDistanceToDockM > 0
      ? location.distanceToDockM / meanDistanceToDockM
      : 1;
    const travelSec = parameters.meanTravelSec * ratio;
    const expected = {
      queueSec: parameters.queueSec,
      travelSec,
      searchSec: parameters.searchSec,
      reachScanSec:
        parameters.reachScanSec + (location.goldenZone ? 0 : parameters.nonGoldenPenaltySec),
      handleSec: parameters.handleSec,
      congestionSec: travelSec * location.congestionScore * parameters.congestionFactor,
      exceptionSec: task.exceptionCode ? 18 : 0,
    };
    const expectedTotal = Object.values(expected).reduce((sum, value) => sum + value, 0);
    const scale = task.durationSec / Math.max(1, expectedTotal);
    attributed.push({
      queueSec: expected.queueSec * scale,
      travelSec: expected.travelSec * scale,
      searchSec: expected.searchSec * scale,
      reachScanSec: expected.reachScanSec * scale,
      handleSec: expected.handleSec * scale,
      congestionSec: expected.congestionSec * scale,
      exceptionSec: expected.exceptionSec * scale,
      total: task.durationSec,
    });
  }
  if (attributed.length === 0) return null;

  const p50Sec = quantile(attributed.map((row) => row.total), 0.5);
  const componentKeys = [
    "queueSec",
    "travelSec",
    "searchSec",
    "reachScanSec",
    "handleSec",
    "congestionSec",
    "exceptionSec",
  ] as const;
  const componentMeans = Object.fromEntries(
    componentKeys.map((key) => [
      key,
      attributed.reduce((sum, row) => sum + row[key], 0) / attributed.length,
    ]),
  ) as Record<(typeof componentKeys)[number], number>;
  const meanTotal = componentKeys.reduce((sum, key) => sum + componentMeans[key], 0);
  const component = (key: (typeof componentKeys)[number]) =>
    round((componentMeans[key] / Math.max(1, meanTotal)) * p50Sec);

  const result: PickTimeBreakdown = {
    queueSec: component("queueSec"),
    travelSec: component("travelSec"),
    searchSec: component("searchSec"),
    reachScanSec: component("reachScanSec"),
    handleSec: component("handleSec"),
    congestionSec: component("congestionSec"),
    exceptionSec: component("exceptionSec"),
    p50Sec: round(p50Sec),
    p90Sec: round(quantile(attributed.map((row) => row.total), 0.9)),
  };
  // Yuvarlama farkını toplamın P50 ile birebir olacağı biçimde exception'a yaz.
  const roundedTotal = componentKeys.reduce((sum, key) => sum + result[key], 0);
  result.exceptionSec = round(result.exceptionSec + result.p50Sec - roundedTotal);
  return result;
}

function varianceRows(
  expected: PickTimeBreakdown,
  actual: PickTimeBreakdown | null,
): PickTimeVarianceRow[] {
  if (!actual) return [];
  const specs: Array<{
    key: PickTimeVarianceRow["key"];
    label: string;
    field: keyof PickTimeBreakdown;
    cause: string;
  }> = [
    { key: "travel", label: "Travel", field: "travelSec", cause: "Graf mesafesi / rota" },
    { key: "search", label: "Search", field: "searchSec", cause: "SKU bulunabilirliği" },
    { key: "reachScan", label: "Reach/Scan", field: "reachScanSec", cause: "Ergonomi / tarama" },
    { key: "handle", label: "Handle", field: "handleSec", cause: "Ürün elleçleme" },
    { key: "congestion", label: "Congestion", field: "congestionSec", cause: "Koridor yoğunluğu" },
  ];
  return specs.map((spec) => {
    const expectedValue = expected[spec.field];
    const actualValue = actual[spec.field];
    const delta = round(actualValue - expectedValue);
    return {
      key: spec.key,
      component: spec.label,
      expected: expectedValue,
      actual: actualValue,
      delta,
      rootCause: Math.abs(delta) > 1 ? spec.cause : "Model aralığında",
      causeTone: Math.abs(delta) > 1 ? "attention" : "normal",
    };
  });
}

function snapshot(
  data: Awaited<ReturnType<typeof facilityData>>,
  parameters: PickTimeModelParameters,
  eligibleCount: number,
): PickTimeModelSnapshot {
  const metrics = (data.model?.metrics ?? {}) as ModelMetrics;
  const calibrated = data.model?.calibrated ?? false;
  return {
    version: data.model?.version ?? "pick-time-baseline",
    parameters,
    calibrated,
    algorithm: data.model?.algorithm ?? "analytic-baseline-v1",
    sampleSize: data.model?.sampleSize ?? 0,
    trainedFrom: data.model?.trainedFrom?.toISOString() ?? null,
    trainedTo: data.model?.trainedTo?.toISOString() ?? null,
    p50MaeSec: metrics.p50MaeSec ?? null,
    p90CoveragePct: data.model?.p90CoveragePct ?? null,
    createdAt: data.model?.createdAt.toISOString() ?? new Date(0).toISOString(),
    calibrationMessage: calibrated
      ? `${data.model?.sampleSize ?? 0} görev etiketiyle kalibre edildi.`
      : `Model kalibre değil. ${eligibleCount}/${MIN_PICK_TIME_CALIBRATION_SAMPLES} ` +
        "uygun görev etiketi var; gerçek WMS verisi gelene kadar baseline parametreler kullanılıyor.",
  };
}

export async function getPickingTimeResponse(
  db: DbClient,
  tenantId: string,
  facilityCode: string,
): Promise<PickingTimeResponse> {
  const data = await facilityData(db, tenantId, facilityCode);
  const parameters = parametersOf(data.model?.parameters);
  const training = trainingSamples(data);
  const exceptionRate =
    data.tasks.filter((task) => Boolean(task.exceptionCode)).length /
    Math.max(1, data.tasks.length);
  const plan = expectedBreakdown(
    parameters,
    data.layout?.locations ?? [],
    exceptionRate,
  );
  const actual = actualBreakdown(
    data,
    parameters,
    training.meanDistanceToDockM,
    training.locationByCode,
  );
  const labelledTaskCount = data.tasks.filter((task) => task.durationSec !== null).length;
  const pairedEventCount = data.tasks.filter(
    (task) => task.startedAt && task.completedAt,
  ).length;
  const lateEventCount = data.events.filter(
    (event) => event.ingestTime.getTime() - event.eventTime.getTime() > 5 * 60 * 1000,
  ).length;
  const completedTimes = data.tasks
    .map((task) => task.completedAt?.getTime())
    .filter((value): value is number => value !== undefined);
  const actualWindowLabel = completedTimes.length
    ? `${new Date(Math.min(...completedTimes)).toLocaleDateString("tr-TR")} - ` +
      new Date(Math.max(...completedTimes)).toLocaleDateString("tr-TR")
    : "Henüz gerçekleşen görev verisi yok";

  return {
    facilityCode: data.facility.code,
    plan,
    actual,
    variance: varianceRows(plan, actual),
    model: snapshot(data, parameters, training.samples.length),
    eventSummary: {
      taskCount: data.tasks.length,
      labelledTaskCount,
      trainingEligibleCount: training.samples.length,
      pairedEventCount,
      lateEventCount,
    },
    actualWindowLabel,
  };
}

export async function calibrateFacilityModel(
  db: DbClient,
  tenantId: string,
  facilityCode: string,
): Promise<PickTimeCalibrationResult & { modelVersion: string | null }> {
  const data = await facilityData(db, tenantId, facilityCode);
  const baseline = parametersOf(data.model?.parameters);
  const result = calibratePickTimeModel(trainingSamples(data).samples, baseline);
  if (!result.calibrated) {
    return { ...result, modelVersion: data.model?.version ?? null };
  }

  await db.pickTimeModel.updateMany({
    where: { tenantId, facilityId: data.facility.id, isActive: true },
    data: { isActive: false },
  });
  const version = nextVersion(data.model?.version);
  await db.pickTimeModel.create({
    data: {
      tenantId,
      facilityId: data.facility.id,
      version,
      parameters: result.parameters as unknown as Prisma.InputJsonValue,
      algorithm: "quantile-irls-v1",
      metrics: {
        p50MaeSec: result.p50MaeSec,
        minimumSampleSize: result.minimumSampleSize,
      },
      calibrated: true,
      trainedFrom: result.trainedFrom ? new Date(result.trainedFrom) : null,
      trainedTo: result.trainedTo ? new Date(result.trainedTo) : null,
      sampleSize: result.sampleSize,
      p90CoveragePct: result.p90CoveragePct,
      isActive: true,
    },
  });
  return { ...result, modelVersion: version };
}

export async function getPickTimeModelSnapshot(
  db: DbClient,
  tenantId: string,
  facilityCode: string,
): Promise<PickTimeModelSnapshot> {
  const data = await facilityData(db, tenantId, facilityCode);
  const training = trainingSamples(data);
  return snapshot(data, parametersOf(data.model?.parameters), training.samples.length);
}
