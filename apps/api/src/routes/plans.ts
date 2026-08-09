import type { FastifyInstance } from "fastify";
import type { MoveTask, PlanMeasurement, PlanVersion, SlotPlan } from "@gbsoft/domain";
import { z } from "zod";
import { prisma } from "../db.js";
import { evaluateDataQuality } from "../quality/engine.js";

const STATUS = {
  READY: "hazır",
  WAITING: "bekliyor",
  BLOCKED: "bloklu",
  PUBLISHED: "yayınlandı",
  APPLIED: "yayınlandı",
  CANCELLED: "bloklu",
} as const;

const KIND = {
  VACATE: "vacate",
  MOVE: "move",
  VERIFY: "verify",
  OPEN: "open",
} as const;

const MIN_MEASUREMENT_SAMPLES = 50;

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function findPlan(tenantId: string, id: string) {
  return prisma.slotPlan.findFirst({
    where: { tenantId, OR: [{ id }, { code: id }] },
    include: {
      objectiveProfile: { select: { key: true } },
      run: { select: { solveDurationMs: true } },
      recommendations: {
        orderBy: { sku: { code: "asc" } },
        include: {
          sku: { select: { code: true } },
          sourceLocation: { select: { code: true } },
          targetLocation: { select: { code: true } },
          alternatives: {
            orderBy: { rank: "asc" },
            include: { location: { select: { code: true } } },
          },
        },
      },
    },
  });
}

function planResponse(plan: NonNullable<Awaited<ReturnType<typeof findPlan>>>): SlotPlan {
  return {
    id: plan.code,
    facilityId: plan.facilityId,
    snapshotAt: plan.snapshotAt.toISOString(),
    solverVersion: plan.solverVersion,
    modelVersion: plan.modelVersion,
    objectiveProfile: plan.objectiveProfile.key as SlotPlan["objectiveProfile"],
    netOperationDeltaPct: plan.netOperationDeltaPct,
    pickingTimeDeltaPct: plan.pickingTimeDeltaPct,
    walkingDeltaPct: plan.walkingDeltaPct,
    replenishmentDeltaPct: plan.replenishmentDeltaPct,
    moveTaskCount: plan.moveTaskCount,
    moveHours: plan.moveHours,
    affectedSkuCount: plan.affectedSkuCount,
    hardViolationCount: plan.hardViolationCount,
    runId: plan.runId ?? "seed",
    solveDurationMs: plan.run?.solveDurationMs ?? 0,
    status: "feasible",
    basePlanId: plan.basePlanId ?? undefined,
    createdAt: plan.createdAt.toISOString(),
    createdBy: plan.createdByLabel,
    recommendations: plan.recommendations.map((row) => ({
      skuId: row.sku.code,
      sourceLocationId: row.sourceLocation.code,
      targetLocationId: row.targetLocation.code,
      expectedSecondsPerLineDelta: row.expectedSecondsPerLineDelta,
      p90SecondsPerLineDelta: row.p90SecondsPerLineDelta,
      replenishmentDeltaPerDay: row.replenishmentDeltaPerDay,
      moveHours: row.moveHours,
      reasons: row.reasons,
      tradeoffs: row.tradeoffs,
      hardConstraintsPassed: row.hardConstraintsPassed,
      status: row.status.toLowerCase() as "recommended",
      confidencePct: row.confidencePct,
      alternatives: row.alternatives.map((alternative) => ({
        locationId: alternative.location.code,
        netSecondsDelta: alternative.netSecondsDelta,
        picking: alternative.pickingQuality as "iyi" | "orta" | "zayıf",
        replenishmentDeltaPerDay: alternative.replenishmentDeltaPerDay,
        congestion: alternative.congestionLevel as "düşük" | "orta" | "yüksek",
        status: alternative.status as "önerilen" | "alternatif" | "uygun değil",
        blockedReason: alternative.blockedReason ?? undefined,
      })),
    })),
  };
}

async function moveTasks(tenantId: string, planId: string): Promise<MoveTask[]> {
  const rows = await prisma.moveTask.findMany({
    where: { tenantId, planId },
    orderBy: { seq: "asc" },
    include: {
      sku: { select: { code: true } },
      dependencies: { include: { prerequisite: { select: { seq: true } } } },
    },
  });
  return rows.map((row) => ({
    seq: row.seq,
    id: row.code,
    kind: KIND[row.kind],
    label: row.label,
    skuId: row.sku?.code ?? null,
    sourceLocationId: row.sourceLocationCode,
    targetLocationId: row.targetLocationCode,
    dependsOn: row.dependencies.map((item) => item.prerequisite.seq).sort((a, b) => a - b),
    loadLabel: row.loadLabel,
    loadHours: row.loadHours,
    zone: row.zoneCode as MoveTask["zone"],
    status: STATUS[row.status],
    packageId: row.packageKey,
    expectedBenefitPct: row.expectedBenefitPct,
  }));
}

export async function planRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { facility?: string } }>("/slot-plans", async (request) => {
    const rows = await prisma.slotPlan.findMany({
      where: {
        tenantId: request.tenantId,
        ...(request.query.facility ? { facility: { code: request.query.facility } } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { facility: { select: { code: true } } },
    });
    return rows.map((row): PlanVersion => ({
      id: row.code,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdByLabel,
      netOperationDeltaPct: row.netOperationDeltaPct,
      moveTaskCount: row.moveTaskCount,
      note: `${row.solverVersion} · ${row.modelVersion}`,
      state: row.state === "PUBLISHED" || row.state === "PARTIALLY_PUBLISHED" ? "aktif" : row.state === "ROLLED_BACK" || row.state === "SUPERSEDED" ? "arşiv" : "taslak",
    }));
  });

  app.get<{ Params: { id: string } }>("/slot-plans/:id", async (request, reply) => {
    const plan = await findPlan(request.tenantId, request.params.id);
    if (!plan) return reply.notFound("Slot planı bulunamadı.");
    return planResponse(plan);
  });

  app.get<{ Params: { id: string } }>("/slot-plans/:id/move-tasks", async (request, reply) => {
    const plan = await findPlan(request.tenantId, request.params.id);
    if (!plan) return reply.notFound("Slot planı bulunamadı.");
    return moveTasks(request.tenantId, plan.id);
  });

  app.get<{ Params: { id: string } }>("/slot-plans/:id/measurement", async (request, reply): Promise<PlanMeasurement | undefined> => {
    const plan = await findPlan(request.tenantId, request.params.id);
    if (!plan) return reply.notFound("Slot planı bulunamadı.");
    if (!plan.publishedAt) {
      return { planId: plan.code, status: "not-published", expectedDeltaPct: plan.pickingTimeDeltaPct, baselineSamples: 0, observedSamples: 0, minimumSamples: MIN_MEASUREMENT_SAMPLES };
    }
    const windowEnd = new Date();
    const elapsed = Math.max(60_000, windowEnd.getTime() - plan.publishedAt.getTime());
    const baselineStart = new Date(plan.publishedAt.getTime() - elapsed);
    const rows = await prisma.pickTask.findMany({
      where: {
        tenantId: request.tenantId,
        wave: { facilityId: plan.facilityId },
        durationSec: { not: null },
        completedAt: { gte: baselineStart, lte: windowEnd },
      },
      select: { durationSec: true, completedAt: true },
    });
    const baseline = rows.filter((row) => row.completedAt! < plan.publishedAt!).map((row) => row.durationSec!);
    const observed = rows.filter((row) => row.completedAt! >= plan.publishedAt!).map((row) => row.durationSec!);
    const response: PlanMeasurement = {
      planId: plan.code,
      status: baseline.length >= MIN_MEASUREMENT_SAMPLES && observed.length >= MIN_MEASUREMENT_SAMPLES ? "measured" : "insufficient-data",
      expectedDeltaPct: plan.pickingTimeDeltaPct,
      baselineSamples: baseline.length,
      observedSamples: observed.length,
      minimumSamples: MIN_MEASUREMENT_SAMPLES,
      windowStart: plan.publishedAt.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
    if (response.status === "measured") {
      const baselineP50 = median(baseline);
      const observedP50 = median(observed);
      response.baselineP50Sec = baselineP50;
      response.observedP50Sec = observedP50;
      response.actualDeltaPct = ((observedP50 - baselineP50) / Math.max(1, baselineP50)) * 100;
      await prisma.planMeasurement.create({
        data: {
          tenantId: request.tenantId,
          planId: plan.id,
          windowStart: plan.publishedAt,
          windowEnd,
          expectedDeltaPct: response.expectedDeltaPct,
          actualDeltaPct: response.actualDeltaPct,
          baselineP50Sec: baselineP50,
          observedP50Sec: observedP50,
          baselineSamples: baseline.length,
          observedSamples: observed.length,
          status: "MEASURED",
          evidence: { minimumSamples: MIN_MEASUREMENT_SAMPLES, metric: "pick-task-duration-p50" },
        },
      });
    }
    return response;
  });

  app.post<{ Params: { id: string }; Body: { taskIds: string[] } }>(
    "/slot-plans/:id/publish",
    async (request, reply) => {
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || key.length < 8) return reply.badRequest("idempotency-key başlığı zorunludur.");
      const body = z.object({ taskIds: z.array(z.string()).min(1) }).parse(request.body);
      const plan = await findPlan(request.tenantId, request.params.id);
      if (!plan) return reply.notFound("Slot planı bulunamadı.");
      const rows = await prisma.moveTask.findMany({ where: { tenantId: request.tenantId, planId: plan.id } });
      const selected = rows.filter((row) => body.taskIds.includes(row.code) || body.taskIds.includes(row.id));
      if (selected.length !== new Set(body.taskIds).size) return reply.badRequest("Görevlerden biri bu plana ait değil.");

      const repeated = selected.every((row) => row.idempotencyKey === key && row.status === "PUBLISHED");
      if (repeated) return { published: selected.length, planId: plan.code, idempotent: true, mode: "live" };
      const selectedIds = new Set(selected.map((row) => row.id));
      for (const packageKey of new Set(selected.map((row) => row.packageKey))) {
        const packageRows = rows.filter((row) => row.packageKey === packageKey && row.status !== "CANCELLED");
        if (!packageRows.every((row) => selectedIds.has(row.id))) {
          return reply.conflict(`${packageRows[0]?.packageLabel ?? packageKey} bölünemez; tüm görevleri seçin.`);
        }
      }

      const quality = await prisma.$transaction((tx) => evaluateDataQuality(tx, request.tenantId, plan.facilityId));
      const plannedSkuCodes = new Set(plan.recommendations.map((row) => row.sku.code));
      const blocking = quality.issues.filter((issue) =>
        issue.blocksPublish && (issue.id !== "DQ-SKU-PHYSICAL" || issue.affectedIds.some((id) => plannedSkuCodes.has(id))),
      );
      if (blocking.length) return reply.conflict(blocking.map((issue) => issue.problem).join("; "));

      const publishedAt = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.moveTask.updateMany({
          where: { id: { in: selected.map((row) => row.id) } },
          data: { status: "PUBLISHED", publishedAt, idempotencyKey: key },
        });
        const remaining = await tx.moveTask.count({ where: { planId: plan.id, status: { not: "PUBLISHED" } } });
        await tx.slotPlan.update({ where: { id: plan.id }, data: { state: remaining === 0 ? "PUBLISHED" : "PARTIALLY_PUBLISHED", publishedAt } });
        await tx.auditLog.create({ data: { tenantId: request.tenantId, action: "slot-plan.publish", entityType: "SlotPlan", entityId: plan.id, correlationId: request.correlationId, after: { taskIds: selected.map((row) => row.code), idempotencyKey: key } } });
      });
      return { published: selected.length, planId: plan.code, idempotent: false, mode: "live" };
    },
  );

  app.post<{ Params: { id: string }; Body: { targetPlanId: string } }>("/slot-plans/:id/rollback", async (request, reply) => {
    const body = z.object({ targetPlanId: z.string().min(1) }).parse(request.body);
    const [current, target] = await Promise.all([findPlan(request.tenantId, request.params.id), findPlan(request.tenantId, body.targetPlanId)]);
    if (!current || !target || current.facilityId !== target.facilityId) return reply.notFound("Rollback plan zinciri bulunamadı.");
    await prisma.$transaction(async (tx) => {
      await tx.slotPlan.update({ where: { id: current.id }, data: { state: "ROLLED_BACK" } });
      await tx.slotPlan.update({ where: { id: target.id }, data: { state: "READY" } });
      await tx.auditLog.create({ data: { tenantId: request.tenantId, action: "slot-plan.rollback", entityType: "SlotPlan", entityId: current.id, correlationId: request.correlationId, before: { plan: current.code }, after: { plan: target.code } } });
    });
    return { rolledBackPlanId: current.code, activePlanId: target.code, publishedTasksUnaffected: true };
  });
}
