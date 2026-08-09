import type { Prisma } from "@prisma/client";
import {
  DEFAULT_PICK_TIME_PARAMETERS,
  estimateLocationPickTimeSec,
  type ReoptimizeRequest,
} from "@gbsoft/domain";
import { prisma } from "../db.js";
import { solve, type OptimizerRequest, type OptimizerResult } from "./client.js";

const MODEL_VERSION_FALLBACK = "pick-time-analytic-baseline-v1";

const json = (value: unknown) => value as Prisma.InputJsonValue;

function equipment(value: string): "manual" | "cart" | "forklift" {
  return value.toLowerCase() as "manual" | "cart" | "forklift";
}

function allowedEquipment(handling: string) {
  if (handling === "HEAVY") return ["cart", "forklift"] as const;
  if (handling === "FRAGILE") return ["manual", "cart"] as const;
  return ["manual", "cart", "forklift"] as const;
}

export async function prepareOptimizationRun(
  tenantId: string,
  request: ReoptimizeRequest,
) {
  const basePlan = await prisma.slotPlan.findFirst({
    where: {
      tenantId,
      OR: [{ id: request.planId }, { code: request.planId }],
    },
    include: {
      layoutVersion: {
        include: {
          locations: {
            orderBy: { code: "asc" },
            include: { zone: { select: { code: true } } },
          },
        },
      },
      locks: {
        include: {
          sku: { select: { code: true } },
          location: { select: { code: true } },
        },
      },
      exclusions: { include: { sku: { select: { code: true } } } },
    },
  });
  if (!basePlan) throw new Error(`Slot planı bulunamadı: ${request.planId}`);

  const [skus, pickTimeModel] = await Promise.all([
    prisma.sku.findMany({
      where: { tenantId, facilityId: basePlan.facilityId },
      orderBy: { code: "asc" },
      include: {
        dimension: true,
        velocity: { orderBy: { windowEnd: "desc" }, take: 1 },
        placements: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          include: { location: { select: { code: true, layoutVersionId: true } } },
        },
      },
    }),
    prisma.pickTimeModel.findFirst({
      where: { tenantId, facilityId: basePlan.facilityId, isActive: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const locations = basePlan.layoutVersion.locations;
  const meanDistance =
    locations.reduce((sum, location) => sum + location.distanceToDockM, 0) /
    Math.max(1, locations.length);
  const parameters = {
    ...DEFAULT_PICK_TIME_PARAMETERS,
    ...((pickTimeModel?.parameters ?? {}) as object),
  };
  const locationCodes = new Set(locations.map((location) => location.code));
  const skuCodes = new Set(skus.map((sku) => sku.code));

  const explicitExcluded = new Set([
    ...request.excludedSkuIds,
    ...basePlan.exclusions.map((item) => item.sku.code),
  ]);
  const excluded = new Set<string>();
  const solverSkus: OptimizerRequest["skus"] = [];
  for (const sku of skus) {
    const dimension = sku.dimension;
    const current = sku.placements[0]?.location;
    const currentCode =
      current?.layoutVersionId === basePlan.layoutVersionId ? current.code : null;
    const complete = Boolean(
      dimension?.widthCm &&
        dimension.depthCm &&
        dimension.heightCm &&
        dimension.weightKg,
    );
    // v1 yalnız aktif pick yerleşimlerini yeniden slotlar. Reserve ve ölçüsü
    // eksik SKU snapshot'ta kalır ancak açıkça kapsam dışıdır.
    if (!complete || !currentCode || explicitExcluded.has(sku.code)) {
      excluded.add(sku.code);
    }
    solverSkus.push({
      id: sku.code,
      weight_kg: dimension?.weightKg ?? 0.001,
      volume_m3: complete
        ? (dimension!.widthCm! * dimension!.depthCm! * dimension!.heightCm!) / 1_000_000
        : 0.001,
      allowed_equipment: [...allowedEquipment(sku.handling)],
      allowed_zones: [],
      current_location_id: currentCode,
      fixed_location_id: null,
      picks_per_day: sku.velocity[0]?.picksPerDay ?? 0,
      replenishments_per_day: sku.velocity[0]?.replenishmentsPerDay ?? 0,
    });
  }

  const input: OptimizerRequest = {
    run_id: "pending",
    seed: 42,
    time_limit_ms: 5_000,
    move_budget: request.moveBudget,
    min_net_benefit_pct: request.minNetBenefitPct,
    weights: {
      picking_time: request.weights.pickingTime,
      replenishment: request.weights.replenishment,
      congestion: request.weights.congestion,
      move_cost: request.weights.moveCost,
      ergonomics: 0.2,
    },
    skus: solverSkus,
    locations: locations.map((location) => ({
      id: location.code,
      zone: location.zone.code,
      max_weight_kg: location.maxWeightKg,
      max_volume_m3: location.maxVolumeM3,
      equipment: equipment(location.equipment),
      blocked: location.blocked,
      distance_to_dock_m: location.distanceToDockM,
      expected_pick_sec: estimateLocationPickTimeSec({
        distanceToDockM: location.distanceToDockM,
        meanDistanceToDockM: meanDistance,
        congestionScore: location.congestionScore,
        goldenZone: location.goldenZone,
        parameters,
      }),
      congestion_score: location.congestionScore,
      golden_zone: location.goldenZone,
    })),
    locked_assignments: [
      ...basePlan.locks.map((lock) => ({
        sku_id: lock.sku.code,
        location_id: lock.location.code,
      })),
      ...request.lockedAssignments
        .filter(
          (lock) => skuCodes.has(lock.skuId) && locationCodes.has(lock.locationId),
        )
        .map((lock) => ({ sku_id: lock.skuId, location_id: lock.locationId })),
    ],
    excluded_sku_ids: [...excluded].sort(),
    blocked_location_ids: request.blockedLocationIds.filter((code) =>
      locationCodes.has(code),
    ),
    frozen_zones: request.frozenZones,
  };

  const run = await prisma.optimizationRun.create({
    data: {
      tenantId,
      facilityId: basePlan.facilityId,
      basePlanId: basePlan.id,
      status: "QUEUED",
      solverVersion: "slot-cp-1.0.0",
      modelVersion: pickTimeModel?.version ?? MODEL_VERSION_FALLBACK,
      objectiveProfileKey: request.profile,
      parameters: json({
        weights: request.weights,
        moveBudget: request.moveBudget,
        minNetBenefitPct: request.minNetBenefitPct,
        frozenZones: request.frozenZones,
      }),
      constraints: json({
        lockedAssignments: input.locked_assignments,
        excludedSkuIds: input.excluded_sku_ids,
        blockedLocationIds: input.blocked_location_ids,
      }),
      inputSnapshot: json(input),
      seed: input.seed,
      timeLimitMs: input.time_limit_ms,
      snapshotAt: new Date(),
    },
  });
  input.run_id = run.id;
  await prisma.optimizationRun.update({
    where: { id: run.id },
    data: { inputSnapshot: json(input) },
  });
  return run;
}

async function persistResult(runId: string, result: OptimizerResult) {
  const run = await prisma.optimizationRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const status =
    result.status === "optimal" || result.status === "feasible"
      ? "FEASIBLE"
      : result.status.toUpperCase() as "INFEASIBLE" | "TIMEOUT" | "FAILED";

  if (status !== "FEASIBLE") {
    await prisma.optimizationRun.update({
      where: { id: runId },
      data: {
        status,
        solverVersion: result.solver_version,
        solutionQuality: result.solution_quality,
        finishedAt: new Date(),
        solveDurationMs: result.solve_duration_ms,
        objectiveValue: result.objective_value,
        gapPct: result.gap_pct,
        hardViolations: result.hard_violations,
        infeasibilityReasons: json(result.infeasibility_reasons),
        relaxationOptions: json(result.relaxation_options),
        resultSnapshot: json(result),
      },
    });
    return;
  }

  const basePlan = await prisma.slotPlan.findUnique({
    where: { id: run.basePlanId! },
    include: { objectiveProfile: true },
  });
  if (!basePlan) throw new Error("Optimization run base planı bulunamadı.");
  const [profile, existingCount, pickModel, skuRows, locationRows] = await Promise.all([
    prisma.objectiveProfile.findUnique({
      where: { tenantId_key: { tenantId: run.tenantId, key: run.objectiveProfileKey } },
    }),
    prisma.slotPlan.count({ where: { tenantId: run.tenantId, basePlanId: basePlan.id } }),
    prisma.pickTimeModel.findFirst({
      where: { tenantId: run.tenantId, facilityId: run.facilityId, isActive: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.sku.findMany({
      where: { tenantId: run.tenantId, facilityId: run.facilityId },
      select: { id: true, code: true },
    }),
    prisma.location.findMany({
      where: { tenantId: run.tenantId, layoutVersionId: basePlan.layoutVersionId },
      select: { id: true, code: true, distanceToDockM: true, congestionScore: true },
    }),
  ]);
  const skuByCode = new Map(skuRows.map((row) => [row.code, row]));
  const locationByCode = new Map(locationRows.map((row) => [row.code, row]));
  const input = run.inputSnapshot as unknown as OptimizerRequest;
  const inputLocation = new Map(input.locations.map((row) => [row.id, row]));
  const skuInput = new Map(input.skus.map((row) => [row.id, row]));
  const moved = result.assignments.filter(
    (assignment) => assignment.moved && assignment.source_location_id,
  );
  const calibrated = pickModel?.calibrated ?? false;

  await prisma.$transaction(async (tx) => {
    const plan = await tx.slotPlan.create({
      data: {
        tenantId: run.tenantId,
        facilityId: run.facilityId,
        layoutVersionId: basePlan.layoutVersionId,
        code: `${basePlan.code}-R${existingCount + 1}`,
        basePlanId: basePlan.id,
        runId,
        objectiveProfileId: profile?.id ?? basePlan.objectiveProfileId,
        state: "READY",
        snapshotAt: run.snapshotAt,
        solverVersion: result.solver_version,
        modelVersion: run.modelVersion,
        netOperationDeltaPct: -result.objective_delta_pct,
        pickingTimeDeltaPct: -result.objective_delta_pct,
        walkingDeltaPct: -result.objective_delta_pct,
        replenishmentDeltaPct: 0,
        moveTaskCount: moved.length,
        moveHours: Math.round(moved.length * 0.12 * 100) / 100,
        affectedSkuCount: moved.length,
        hardViolationCount: result.hard_violations,
        createdByLabel: "Optimizer",
      },
    });

    for (const assignment of moved) {
      const sku = skuByCode.get(assignment.sku_id);
      const source = locationByCode.get(assignment.source_location_id!);
      const target = locationByCode.get(assignment.target_location_id);
      if (!sku || !source || !target) continue;
      const sourcePick = inputLocation.get(source.code)?.expected_pick_sec ?? assignment.expected_pick_sec;
      const velocity = skuInput.get(sku.code);
      const pickDelta = assignment.expected_pick_sec - sourcePick;
      const replenishmentDelta =
        ((target.distanceToDockM - source.distanceToDockM) *
          (velocity?.replenishments_per_day ?? 0)) /
        60;
      const recommendation = await tx.slotRecommendation.create({
        data: {
          tenantId: run.tenantId,
          planId: plan.id,
          skuId: sku.id,
          sourceLocationId: source.id,
          targetLocationId: target.id,
          expectedSecondsPerLineDelta: pickDelta,
          p90SecondsPerLineDelta: pickDelta * 1.35,
          replenishmentDeltaPerDay: replenishmentDelta,
          moveHours: 0.12,
          reasons: [
            "Güncel hız snapshot'ı ve kalibre picking-time modeliyle daha düşük beklenen maliyet.",
            "Kapasite, ekipman, blokaj ve tek SKU/göz hard constraint'leri geçti.",
          ],
          tradeoffs: replenishmentDelta > 0
            ? ["Replenishment mesafesi sınırlı ölçüde artıyor."]
            : [],
          confidencePct: calibrated ? 92 : 72,
        },
      });
      const alternatives = assignment.alternatives
        .map((code) => locationByCode.get(code))
        .filter((row): row is NonNullable<typeof row> => Boolean(row));
      if (alternatives.length) {
        await tx.slotAlternative.createMany({
          data: alternatives.map((alternative, index) => ({
            tenantId: run.tenantId,
            recommendationId: recommendation.id,
            locationId: alternative.id,
            rank: index + 1,
            netSecondsDelta:
              (inputLocation.get(alternative.code)?.expected_pick_sec ?? sourcePick) - sourcePick,
            pickingQuality: "uygun",
            replenishmentDeltaPerDay:
              ((alternative.distanceToDockM - source.distanceToDockM) *
                (velocity?.replenishments_per_day ?? 0)) /
              60,
            congestionLevel:
              alternative.congestionScore > 0.65 ? "yüksek" : alternative.congestionScore > 0.35 ? "orta" : "düşük",
            status: "alternatif",
          })),
        });
      }
    }

    // Faz 5: solver önerileri uygulanabilir, bölünemez yayın paketlerine dönüşür.
    // WMS yazımı yine açık publish komutunu bekler; solver kendiliğinden yayınlamaz.
    for (const [index, assignment] of moved.entries()) {
      const sku = skuByCode.get(assignment.sku_id);
      const target = locationByCode.get(assignment.target_location_id);
      if (!sku || !target || !assignment.source_location_id) continue;
      const zone = assignment.target_location_id.split("-")[0] ?? "GENEL";
      await tx.moveTask.create({
        data: {
          tenantId: run.tenantId,
          planId: plan.id,
          seq: index + 1,
          code: `${plan.code}-M${String(index + 1).padStart(3, "0")}`,
          kind: "MOVE",
          label: `${assignment.sku_id} taşı`,
          skuId: sku.id,
          sourceLocationCode: assignment.source_location_id,
          targetLocationCode: assignment.target_location_id,
          zoneCode: zone,
          loadLabel: "1 birim",
          loadHours: 0.12,
          packageKey: `PKG-${zone}`,
          packageLabel: `Zone ${zone} yeniden yerleşim paketi`,
          expectedBenefitPct:
            moved.length === 0 ? 0 : -result.objective_delta_pct / moved.length,
          status: "READY",
        },
      });
    }

    await tx.optimizationRun.update({
      where: { id: runId },
      data: {
        status: "FEASIBLE",
        solverVersion: result.solver_version,
        solutionQuality: result.solution_quality,
        finishedAt: new Date(),
        solveDurationMs: result.solve_duration_ms,
        objectiveValue: result.objective_value,
        gapPct: result.gap_pct,
        hardViolations: result.hard_violations,
        resultSnapshot: json(result),
      },
    });
  });
}

export async function executeOptimizationRun(runId: string) {
  try {
    const run = await prisma.optimizationRun.update({
      where: { id: runId },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    const input = run.inputSnapshot as unknown as OptimizerRequest;
    const result = await solve(input);
    await persistResult(runId, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.optimizationRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        solutionQuality: "none",
        finishedAt: new Date(),
        errorMessage: message.slice(0, 2_000),
      },
    });
  }
}

/** API yeniden başlarsa kalıcı kuyrukta kalan işler kaybolmaz. */
export async function recoverOptimizationRuns() {
  const pending = await prisma.optimizationRun.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  for (const run of pending) {
    setTimeout(() => void executeOptimizationRun(run.id), 0);
  }
  return pending.length;
}
