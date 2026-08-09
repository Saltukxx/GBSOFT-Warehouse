/** Picking süresi bileşenleri ve tahmin modeli (Şartname §13.1, §14.1). */

export type PickTimeBreakdown = {
  queueSec: number;
  travelSec: number;
  searchSec: number;
  reachScanSec: number;
  handleSec: number;
  congestionSec: number;
  exceptionSec: number;
  p50Sec: number;
  p90Sec: number;
};

export type PickTimeVarianceRow = {
  key: ComponentKey;
  component: string;
  expected: number;
  actual: number;
  delta: number;
  rootCause: string;
  causeTone: "normal" | "attention";
};

export type PickTimeModelSnapshot = {
  version: string;
  parameters: PickTimeModelParameters;
  calibrated: boolean;
  algorithm: string;
  sampleSize: number;
  trainedFrom: string | null;
  trainedTo: string | null;
  p50MaeSec: number | null;
  p90CoveragePct: number | null;
  createdAt: string;
  calibrationMessage: string;
};

export type PickTimeEventSummary = {
  taskCount: number;
  labelledTaskCount: number;
  trainingEligibleCount: number;
  pairedEventCount: number;
  lateEventCount: number;
};

export type PickingTimeResponse = {
  facilityCode: string;
  plan: PickTimeBreakdown;
  actual: PickTimeBreakdown | null;
  variance: PickTimeVarianceRow[];
  model: PickTimeModelSnapshot;
  eventSummary: PickTimeEventSummary;
  actualWindowLabel: string;
};

/** Event/task kayıtlarından üretilen tek eğitim etiketi ve feature seti. */
export type PickTimeTrainingSample = {
  taskId: string;
  eventTime: string;
  durationSec: number;
  distanceToDockM: number;
  meanDistanceToDockM: number;
  congestionScore: number;
  goldenZone: boolean;
};

export type PickTimeCalibrationResult = {
  status: "calibrated" | "insufficient-data";
  calibrated: boolean;
  sampleSize: number;
  minimumSampleSize: number;
  parameters: PickTimeModelParameters;
  trainedFrom: string | null;
  trainedTo: string | null;
  p50MaeSec: number | null;
  p90CoveragePct: number | null;
  message: string;
};

export type ComponentKey =
  | "queue"
  | "travel"
  | "search"
  | "reachScan"
  | "handle"
  | "congestion"
  | "exception";

export type ComponentMeta = {
  key: ComponentKey;
  label: string;
  color: string;
  /** Bileşenin ne ölçtüğünü açıklayan kısa metin. */
  definition: string;
};

/** Renk sırası şartname §7.3'te sabittir. */
export const PICK_TIME_COMPONENTS: ComponentMeta[] = [
  {
    key: "queue",
    label: "Queue",
    color: "var(--purple-700)",
    definition: "Görev atanana kadar geçen bekleme ve ekipman kuyruğu.",
  },
  {
    key: "travel",
    label: "Travel",
    color: "var(--blue-600)",
    definition: "Graf üzerinde önceki lokasyondan hedefe yürüme süresi.",
  },
  {
    key: "search",
    label: "Search",
    color: "var(--teal-600)",
    definition: "Gözde doğru SKU ve lotu bulma süresi.",
  },
  {
    key: "reachScan",
    label: "Reach/Scan",
    color: "var(--green-700)",
    definition: "Uzanma, kavrama ve barkod/SSCC okutma süresi.",
  },
  {
    key: "handle",
    label: "Handle",
    color: "var(--amber-700)",
    definition: "Ürünü toplama kabına/palete yerleştirme süresi.",
  },
  {
    key: "congestion",
    label: "Congestion",
    color: "var(--red-700)",
    definition: "Koridorda başka görev veya replenishment nedeniyle kayıp.",
  },
  {
    key: "exception",
    label: "Exception",
    color: "var(--ink-950)",
    definition: "Eksik stok, hasar, yanlış lokasyon gibi istisna çözümü.",
  },
];

export const COMPONENT_FIELD: Record<ComponentKey, keyof PickTimeBreakdown> = {
  queue: "queueSec",
  travel: "travelSec",
  search: "searchSec",
  reachScan: "reachScanSec",
  handle: "handleSec",
  congestion: "congestionSec",
  exception: "exceptionSec",
};

/* ------------------------------------------------------------------ */
/* Lokasyon bazlı süre tahmini                                          */
/* ------------------------------------------------------------------ */

/**
 * Süre modelinin parametreleri. Tesis bazlı, versiyonlu ve API'den okunur;
 * koda gömülmez.
 */
export type PickTimeModelParameters = {
  /** Yürüme dışındaki sabit bileşenler. */
  queueSec: number;
  searchSec: number;
  reachScanSec: number;
  handleSec: number;
  /** Tesis ortalamasındaki travel bileşeni; mesafe buna göre normalize edilir. */
  meanTravelSec: number;
  /** Congestion skorunun travel süresine katsayısı. */
  congestionFactor: number;
  /** Altın bölge dışındaki gözlerde ek uzanma/merdiven süresi. */
  nonGoldenPenaltySec: number;
  /** P90 = P50 × multiplier + offset. */
  p90Multiplier: number;
  p90OffsetSec: number;
};

/**
 * Kalibre edilmemiş başlangıç parametreleri.
 *
 * Sabit bileşenlerin toplamı ve ortalama travel değeri tesis P50'siyle
 * tutarlıdır. Gerçek olay verisi geldiğinde bu değerler quantile regression
 * ile değiştirilir; o ana kadar model `calibrated: false` raporlanır.
 */
export const DEFAULT_PICK_TIME_PARAMETERS: PickTimeModelParameters = {
  queueSec: 4.2,
  searchSec: 8.2,
  reachScanSec: 10.7,
  handleSec: 14.0,
  meanTravelSec: 26.1,
  congestionFactor: 0.55,
  nonGoldenPenaltySec: 3.4,
  p90Multiplier: 1.28,
  p90OffsetSec: 2.8,
};

export const MIN_PICK_TIME_CALIBRATION_SAMPLES = 200;

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

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    if (Math.abs(augmented[best][pivot]) < 1e-9) return null;
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];

    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) {
      augmented[pivot][column] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

type FeatureRow = [number, number, number, number];

function features(sample: PickTimeTrainingSample): FeatureRow {
  const distanceRatio = sample.meanDistanceToDockM > 0
    ? sample.distanceToDockM / sample.meanDistanceToDockM
    : 1;
  return [
    1,
    distanceRatio,
    distanceRatio * sample.congestionScore,
    sample.goldenZone ? 0 : 1,
  ];
}

function predict(coefficients: number[], row: FeatureRow): number {
  return row.reduce((sum, value, index) => sum + value * coefficients[index], 0);
}

/**
 * Pinball loss için iteratively reweighted least-squares yaklaşımı.
 * Dört katsayı küçük ve deterministik olduğu için harici ML bağımlılığı
 * gerektirmez; aynı snapshot her koşuda aynı modeli üretir.
 */
function fitQuantile(
  samples: PickTimeTrainingSample[],
  q: number,
  initial: number[],
): number[] {
  const rows = samples.map(features);
  let coefficients = [...initial];

  for (let iteration = 0; iteration < 40; iteration += 1) {
    const normal = Array.from({ length: 4 }, () => Array(4).fill(0) as number[]);
    const target = Array(4).fill(0) as number[];

    for (let index = 0; index < samples.length; index += 1) {
      const row = rows[index];
      const residual = samples[index].durationSec - predict(coefficients, row);
      const sideWeight = residual >= 0 ? q : 1 - q;
      const weight = sideWeight / Math.max(0.5, Math.abs(residual));
      for (let i = 0; i < 4; i += 1) {
        target[i] += weight * row[i] * samples[index].durationSec;
        for (let j = 0; j < 4; j += 1) {
          normal[i][j] += weight * row[i] * row[j];
        }
      }
    }

    // Hafif ridge, tek tip tesislerde singular matrisi önler.
    for (let i = 0; i < 4; i += 1) normal[i][i] += 1e-4;
    const solved = solveLinearSystem(normal, target);
    if (!solved) break;
    coefficients = solved.map((value, index) => {
      const blended = coefficients[index] * 0.25 + value * 0.75;
      return Number.isFinite(blended) ? Math.max(0, blended) : coefficients[index];
    });
  }

  // Son intercept düzeltmesi ampirik residual quantile'ını sıfıra taşır;
  // böylece özellikle P90 modeli hedef coverage'ı doğrudan korur.
  const residualShift = quantile(
    samples.map((sample, index) => sample.durationSec - predict(coefficients, rows[index])),
    q,
  );
  coefficients[0] = Math.max(0, coefficients[0] + residualShift);

  return coefficients;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Task label'larından P50/P90 quantile modelini kalibre eder.
 * Eşik altındaysa baseline parametrelerini aynen döndürür ve hiçbir biçimde
 * "kalibre" iddiasında bulunmaz.
 */
export function calibratePickTimeModel(
  samples: PickTimeTrainingSample[],
  baseline: PickTimeModelParameters = DEFAULT_PICK_TIME_PARAMETERS,
  minimumSampleSize = MIN_PICK_TIME_CALIBRATION_SAMPLES,
): PickTimeCalibrationResult {
  const eligible = samples.filter(
    (sample) =>
      Number.isFinite(sample.durationSec) &&
      sample.durationSec > 0 &&
      sample.durationSec <= 30 * 60 &&
      Number.isFinite(sample.distanceToDockM) &&
      sample.distanceToDockM >= 0,
  );
  const times = eligible.map((sample) => new Date(sample.eventTime).getTime());
  const trainedFrom = times.length ? new Date(Math.min(...times)).toISOString() : null;
  const trainedTo = times.length ? new Date(Math.max(...times)).toISOString() : null;

  if (eligible.length < minimumSampleSize) {
    return {
      status: "insufficient-data",
      calibrated: false,
      sampleSize: eligible.length,
      minimumSampleSize,
      parameters: baseline,
      trainedFrom,
      trainedTo,
      p50MaeSec: null,
      p90CoveragePct: null,
      message:
        `Kalibrasyon için en az ${minimumSampleSize} uygun görev gerekir; ` +
        `${eligible.length} görev bulundu. Baseline parametreler kullanılıyor.`,
    };
  }

  const fixedBaseline =
    baseline.queueSec + baseline.searchSec + baseline.reachScanSec + baseline.handleSec;
  const initial = [
    fixedBaseline,
    baseline.meanTravelSec,
    baseline.meanTravelSec * baseline.congestionFactor,
    baseline.nonGoldenPenaltySec,
  ];
  const p50Coefficients = fitQuantile(eligible, 0.5, initial);
  const p90Coefficients = fitQuantile(eligible, 0.9, initial.map((v) => v * 1.25));

  const fixedScale = fixedBaseline > 0 ? p50Coefficients[0] / fixedBaseline : 1;
  const p50Predictions = eligible.map((sample) =>
    Math.max(1, predict(p50Coefficients, features(sample))),
  );
  const p90Predictions = eligible.map((sample) =>
    Math.max(1, predict(p90Coefficients, features(sample))),
  );
  const multiplier = quantile(
    p90Predictions.map((value, index) => value / Math.max(1, p50Predictions[index])),
    0.5,
  );

  const parameters: PickTimeModelParameters = {
    queueSec: round(baseline.queueSec * fixedScale),
    searchSec: round(baseline.searchSec * fixedScale),
    reachScanSec: round(baseline.reachScanSec * fixedScale),
    handleSec: round(baseline.handleSec * fixedScale),
    meanTravelSec: round(p50Coefficients[1]),
    congestionFactor: round(
      p50Coefficients[1] > 0 ? p50Coefficients[2] / p50Coefficients[1] : 0,
      4,
    ),
    nonGoldenPenaltySec: round(p50Coefficients[3]),
    p90Multiplier: round(Math.min(2.5, Math.max(1, multiplier)), 4),
    p90OffsetSec: 0,
  };

  const absoluteErrors = eligible.map((sample, index) =>
    Math.abs(sample.durationSec - p50Predictions[index]),
  );
  const covered = eligible.filter(
    (sample, index) => sample.durationSec <= p90Predictions[index],
  ).length;

  return {
    status: "calibrated",
    calibrated: true,
    sampleSize: eligible.length,
    minimumSampleSize,
    parameters,
    trainedFrom,
    trainedTo,
    p50MaeSec: round(quantile(absoluteErrors, 0.5)),
    p90CoveragePct: round((covered / eligible.length) * 100, 1),
    message: `${eligible.length} görevle P50/P90 quantile modeli kalibre edildi.`,
  };
}

/**
 * Tek bir gözden toplama süresi (sn/line).
 *
 * Travel bileşeni tesis ortalamasına göre normalize edilir; böylece lokasyon
 * sürelerinin ortalaması tesis P50'si ile örtüşür ve ısı haritası ile süre
 * analizi aynı modeli anlatır.
 */
export function estimateLocationPickTimeSec(input: {
  distanceToDockM: number;
  meanDistanceToDockM: number;
  congestionScore: number;
  goldenZone: boolean;
  parameters?: PickTimeModelParameters;
}): number {
  const p = input.parameters ?? DEFAULT_PICK_TIME_PARAMETERS;
  const ratio =
    input.meanDistanceToDockM > 0
      ? input.distanceToDockM / input.meanDistanceToDockM
      : 1;

  const travelSec = p.meanTravelSec * ratio;
  const congestionSec = travelSec * input.congestionScore * p.congestionFactor;
  const fixedSec = p.queueSec + p.searchSec + p.reachScanSec + p.handleSec;
  const ergonomicsSec = input.goldenZone ? 0 : p.nonGoldenPenaltySec;

  return (
    Math.round((fixedSec + travelSec + congestionSec + ergonomicsSec) * 10) / 10
  );
}

/**
 * Picking süresi tahmini (§14.1). Demo deterministiktir; gerçek WMS verisi
 * bağlandığında kalibre edilir.
 */
export function calculatePickTime(input: {
  graphDistanceM: number;
  nominalSpeedMps: number;
  searchBaseSec: number;
  reachScanBaseSec: number;
  handleBaseSec: number;
  congestionScore: number;
  exceptionProbability: number;
}) {
  const travelSec = input.graphDistanceM / input.nominalSpeedMps;
  const congestionSec = travelSec * input.congestionScore * 0.22;
  const exceptionSec = input.exceptionProbability * 18;

  const p50Sec =
    travelSec +
    input.searchBaseSec +
    input.reachScanBaseSec +
    input.handleBaseSec +
    congestionSec +
    exceptionSec;

  const p90Sec = p50Sec * 1.28 + 2.8;

  return { travelSec, congestionSec, exceptionSec, p50Sec, p90Sec };
}
