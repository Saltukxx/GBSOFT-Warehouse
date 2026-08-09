import { describe, expect, it } from "vitest";
import {
  DEFAULT_PICK_TIME_PARAMETERS,
  calibratePickTimeModel,
  type PickTimeTrainingSample,
} from "./picking.js";

function sample(index: number): PickTimeTrainingSample {
  const distanceRatio = 0.45 + (index % 40) / 30;
  const congestion = (index % 7) / 10;
  const golden = index % 3 !== 0;
  const duration =
    38 +
    25 * distanceRatio +
    12 * distanceRatio * congestion +
    (golden ? 0 : 4) +
    ((index % 5) - 2) * 0.7;
  return {
    taskId: `T-${index}`,
    eventTime: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    durationSec: duration,
    distanceToDockM: distanceRatio * 50,
    meanDistanceToDockM: 50,
    congestionScore: congestion,
    goldenZone: golden,
  };
}

describe("pick-time kalibrasyonu", () => {
  it("örnek eşiğinin altında kalibre iddiası üretmez", () => {
    const result = calibratePickTimeModel(
      Array.from({ length: 20 }, (_, index) => sample(index)),
    );
    expect(result.status).toBe("insufficient-data");
    expect(result.calibrated).toBe(false);
    expect(result.parameters).toEqual(DEFAULT_PICK_TIME_PARAMETERS);
  });

  it("yeterli task etiketiyle deterministik quantile parametreleri üretir", () => {
    const samples = Array.from({ length: 320 }, (_, index) => sample(index));
    const first = calibratePickTimeModel(samples);
    const second = calibratePickTimeModel(samples);

    expect(first).toEqual(second);
    expect(first.status).toBe("calibrated");
    expect(first.sampleSize).toBe(320);
    expect(first.parameters.meanTravelSec).toBeGreaterThan(15);
    expect(first.parameters.meanTravelSec).toBeLessThan(35);
    expect(first.parameters.p90Multiplier).toBeGreaterThanOrEqual(1);
    expect(first.p50MaeSec).not.toBeNull();
    expect(first.p90CoveragePct).toBeGreaterThan(80);
  });

  it("geçersiz ve 30 dakikayı aşan süreleri eğitimden çıkarır", () => {
    const samples = [sample(1), { ...sample(2), durationSec: 0 }, { ...sample(3), durationSec: 1900 }];
    const result = calibratePickTimeModel(samples, DEFAULT_PICK_TIME_PARAMETERS, 1);
    expect(result.sampleSize).toBe(1);
  });
});
