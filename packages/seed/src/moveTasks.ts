import type { MoveTask } from "@gbsoft/domain";
import type { ZoneId } from "@gbsoft/domain";
import { parseZone } from "@gbsoft/domain";
import { RECOMMENDATIONS } from "./slotPlan.js";
import { getSku } from "./skus.js";

/**
 * Taşıma görevleri.
 *
 * 21 SKU taşıması + 5 doğrulama/açma görevi = 26 görev (§2.1).
 * Zone A filtresi 11 görev ve 2 bağımlılık paketi verir (§9.5).
 */

type TaskSpec = {
  seq: number;
  kind: MoveTask["kind"];
  /** SKU taşıması ise öneri listesindeki SKU. */
  skuId?: string;
  /** Doğrulama/açma görevi ise etkilenen lokasyon. */
  locationId?: string;
  dependsOn: number[];
  loadLabel: string;
  loadHours: number;
  packageId: string;
  benefitPct: number;
};

const PACKAGES: Record<string, string> = {
  "PKG-01": "A-03 / A-04 koridor bloğu",
  "PKG-02": "A-02 / A-05 koridor bloğu",
  "PKG-03": "B zonu yeniden yerleşim",
  "PKG-04": "C zonu yeniden yerleşim",
  "PKG-05": "D zonu yeniden yerleşim",
};

/** Zone A görevleri — sıra ve bağımlılıklar §9.3 ve §9.4 ile birebir. */
const ZONE_A_SPECS: TaskSpec[] = [
  {
    seq: 1,
    kind: "vacate",
    skuId: "SKU-074",
    dependsOn: [],
    loadLabel: "1 PL",
    loadHours: 0.22,
    packageId: "PKG-01",
    benefitPct: -0.2,
  },
  {
    seq: 2,
    kind: "move",
    skuId: "SKU-184",
    dependsOn: [1],
    loadLabel: "2 PL",
    loadHours: 0.18,
    packageId: "PKG-01",
    benefitPct: -1.3,
  },
  {
    seq: 3,
    kind: "verify",
    locationId: "A-03-02",
    dependsOn: [2],
    loadLabel: "-",
    loadHours: 0.08,
    packageId: "PKG-01",
    benefitPct: 0,
  },
  {
    seq: 4,
    kind: "open",
    locationId: "A-03-02",
    dependsOn: [3],
    loadLabel: "-",
    loadHours: 0.06,
    packageId: "PKG-01",
    benefitPct: 0,
  },
  {
    seq: 5,
    kind: "vacate",
    skuId: "SKU-307",
    dependsOn: [],
    loadLabel: "2 PL",
    loadHours: 0.24,
    packageId: "PKG-01",
    benefitPct: -0.1,
  },
  {
    seq: 6,
    kind: "move",
    skuId: "SKU-019",
    dependsOn: [5],
    loadLabel: "1 PL",
    loadHours: 0.19,
    packageId: "PKG-01",
    benefitPct: -1,
  },
  {
    seq: 7,
    kind: "verify",
    locationId: "A-04-02",
    dependsOn: [6],
    loadLabel: "-",
    loadHours: 0.08,
    packageId: "PKG-01",
    benefitPct: 0,
  },
  {
    seq: 8,
    kind: "vacate",
    skuId: "SKU-058",
    dependsOn: [],
    loadLabel: "1 PL",
    loadHours: 0.17,
    packageId: "PKG-02",
    benefitPct: -0.1,
  },
  {
    seq: 9,
    kind: "move",
    skuId: "SKU-233",
    dependsOn: [8],
    loadLabel: "1 PL",
    loadHours: 0.16,
    packageId: "PKG-02",
    benefitPct: -0.8,
  },
  {
    seq: 10,
    kind: "move",
    skuId: "SKU-221",
    dependsOn: [],
    loadLabel: "1 PL",
    loadHours: 0.17,
    packageId: "PKG-02",
    benefitPct: -0.4,
  },
  {
    seq: 11,
    kind: "move",
    skuId: "SKU-165",
    dependsOn: [],
    loadLabel: "1 PL",
    loadHours: 0.15,
    packageId: "PKG-02",
    benefitPct: -0.2,
  },
];

/** Zone A dışındaki görevler için yük ve fayda dağılımı (toplam 2,60 sa / -3,5%). */
const OTHER_HOURS = [
  0.21, 0.19, 0.18, 0.2, 0.17, 0.22, 0.16, 0.19, 0.18, 0.2, 0.15, 0.21, 0.2,
];
const OTHER_BENEFIT = [
  -0.4, -0.35, -0.3, -0.3, -0.28, -0.3, -0.25, -0.25, -0.24, -0.2, -0.22, -0.21,
  -0.2,
];

function zoneOfTask(spec: TaskSpec): ZoneId {
  if (spec.locationId) return parseZone(spec.locationId);
  const rec = RECOMMENDATIONS.find((r) => r.skuId === spec.skuId);
  if (!rec) return "A";
  // Boşaltma görevi kaynak gözü, taşıma görevi hedef gözü etkiler.
  return parseZone(
    spec.kind === "vacate" ? rec.sourceLocationId : rec.targetLocationId,
  );
}

function labelOf(spec: TaskSpec): string {
  switch (spec.kind) {
    case "vacate":
      return `${spec.skuId} boşalt`;
    case "move":
      return `${spec.skuId} taşı`;
    case "verify":
      return "Stok doğrula";
    case "open":
      return "Lokasyonu picking'e aç";
  }
}

function buildTasks(): MoveTask[] {
  const zoneASkuIds = new Set(
    ZONE_A_SPECS.map((s) => s.skuId).filter((v): v is string => Boolean(v)),
  );

  const remaining = RECOMMENDATIONS.filter((r) => !zoneASkuIds.has(r.skuId));

  const otherSpecs: TaskSpec[] = remaining.map((rec, index) => {
    const zone = parseZone(rec.targetLocationId);
    return {
      seq: 12 + index,
      kind: "move",
      skuId: rec.skuId,
      dependsOn: [],
      loadLabel: index % 3 === 0 ? "2 PL" : "1 PL",
      loadHours: OTHER_HOURS[index],
      packageId: zone === "B" ? "PKG-03" : zone === "C" ? "PKG-04" : "PKG-05",
      benefitPct: OTHER_BENEFIT[index],
    };
  });

  // Kalan iki yardımcı görev: B ve C zonunda doğrulama/açma.
  otherSpecs.push(
    {
      seq: 12 + remaining.length,
      kind: "verify",
      locationId: "B-02-01",
      dependsOn: [],
      loadLabel: "-",
      loadHours: 0.08,
      packageId: "PKG-03",
      benefitPct: 0,
    },
    {
      seq: 13 + remaining.length,
      kind: "open",
      locationId: "C-09-04",
      dependsOn: [1],
      loadLabel: "-",
      loadHours: 0.06,
      packageId: "PKG-04",
      benefitPct: 0,
    },
  );

  const specs = [...ZONE_A_SPECS, ...otherSpecs];

  // Hedef gözü başka bir SKU tarafından boşaltılıyorsa önkoşul eklenir.
  const vacatingTaskBySource = new Map<string, number>();
  for (const spec of specs) {
    if (!spec.skuId) continue;
    const rec = RECOMMENDATIONS.find((r) => r.skuId === spec.skuId);
    if (rec) vacatingTaskBySource.set(rec.sourceLocationId, spec.seq);
  }
  for (const spec of specs) {
    if (!spec.skuId || spec.dependsOn.length > 0) continue;
    const rec = RECOMMENDATIONS.find((r) => r.skuId === spec.skuId);
    if (!rec) continue;
    const blocker = vacatingTaskBySource.get(rec.targetLocationId);
    if (blocker !== undefined && blocker !== spec.seq) {
      spec.dependsOn = [blocker];
    }
  }

  return specs.map((spec) => {
    const rec = spec.skuId
      ? RECOMMENDATIONS.find((r) => r.skuId === spec.skuId)
      : undefined;
    const status: MoveTask["status"] =
      spec.dependsOn.length > 0 ? "bekliyor" : "hazır";

    return {
      seq: spec.seq,
      id: `MT-${String(spec.seq).padStart(2, "0")}`,
      kind: spec.kind,
      label: labelOf(spec),
      skuId: spec.skuId ?? null,
      sourceLocationId: rec?.sourceLocationId ?? spec.locationId ?? null,
      targetLocationId:
        spec.kind === "verify" || spec.kind === "open"
          ? null
          : (rec?.targetLocationId ?? null),
      dependsOn: spec.dependsOn,
      loadLabel: spec.loadLabel,
      loadHours: spec.loadHours,
      zone: zoneOfTask(spec),
      status,
      packageId: spec.packageId,
      expectedBenefitPct: spec.benefitPct,
    } satisfies MoveTask;
  });
}

export const MOVE_TASKS: MoveTask[] = buildTasks();

export const PACKAGE_LABELS = PACKAGES;

/**
 * SKU-184 kilitlendiğinde iki bağlı taşıma paketi çözümden düşer.
 * Kilitli atama sabit kaldığı için solver bu iki SKU'yu yeniden
 * konumlandıramaz; plan 24 göreve ve 3,9 forklift-saate iner.
 */
export const DROPPED_TASK_SEQS_R1 = [21, 24];

export const MOVE_TASKS_R1: MoveTask[] = MOVE_TASKS.filter(
  (t) => !DROPPED_TASK_SEQS_R1.includes(t.seq),
);

export function taskSkuName(task: MoveTask): string {
  return task.skuId ? (getSku(task.skuId)?.name ?? task.skuId) : "";
}
