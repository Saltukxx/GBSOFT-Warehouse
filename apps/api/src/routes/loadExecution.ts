import type { FastifyInstance } from "fastify";
import type {
  LoadExecutionView,
  LoadInstructionSheet,
  LoadScanOutcome,
} from "@gbsoft/domain";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  executeTruckLoadRun,
  prepareTruckLoadRun,
} from "../truckload/runner.js";

const scanSchema = z.object({
  scannedCode: z.string().trim().min(1).max(128),
  outcome: z.enum(["confirmed", "missing", "damaged"]).default("confirmed"),
  note: z.string().trim().max(500).optional(),
});

const executionInclude = {
  plan: {
    include: {
      placements: {
        orderBy: { seq: "asc" as const },
        include: { hu: { select: { code: true } } },
      },
    },
  },
  events: {
    orderBy: { scannedAt: "desc" as const },
    include: { hu: { select: { code: true } } },
  },
};

function stateName(value: string): LoadExecutionView["state"] {
  return value.toLowerCase().replaceAll("_", "-") as LoadExecutionView["state"];
}

function outcomeName(value: string): LoadScanOutcome {
  return value.toLowerCase().replaceAll("_", "-") as LoadScanOutcome;
}

async function executionView(
  tenantId: string,
  planId: string,
): Promise<LoadExecutionView | null> {
  const execution = await prisma.loadExecution.findFirst({
    where: { tenantId, planId },
    include: executionInclude,
  });
  if (!execution) return null;
  const confirmed = new Set(
    execution.events
      .filter((event) => event.outcome === "CONFIRMED" && event.hu)
      .map((event) => event.hu!.code),
  );
  const next = execution.plan.placements.find(
    (placement) => !confirmed.has(placement.hu.code),
  );
  return {
    id: execution.id,
    planId: execution.planId,
    mode: "shadow",
    state: stateName(execution.state),
    currentSeq: execution.currentSeq,
    loadedCount: execution.loadedCount,
    totalCount: execution.plan.placements.length,
    deviationCount: execution.deviationCount,
    nextExpectedCode: next?.hu.code ?? null,
    replacementPlanId: execution.replacementPlanId,
    publishedAt: execution.publishedAt.toISOString(),
    completedAt: execution.completedAt?.toISOString() ?? null,
    events: execution.events.map((event) => ({
      id: event.id,
      scannedCode: event.scannedCode,
      unitCode: event.hu?.code ?? null,
      expectedSeq: event.expectedSeq,
      actualSeq: event.actualSeq,
      outcome: outcomeName(event.outcome),
      note: event.note,
      scannedAt: event.scannedAt.toISOString(),
    })),
  };
}

async function findPlan(tenantId: string, id: string) {
  return prisma.loadPlan.findFirst({
    where: { tenantId, OR: [{ id }, { code: id }] },
    include: {
      shipment: { select: { code: true } },
      vehicleTemplate: { select: { code: true, name: true } },
      placements: {
        orderBy: { seq: "asc" },
        include: {
          hu: {
            select: {
              id: true,
              code: true,
              sscc: true,
              sku: { select: { code: true } },
              stop: { select: { code: true, seq: true } },
            },
          },
        },
      },
      execution: { include: { events: true } },
    },
  });
}

function idempotencyKey(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.length >= 8 ? value : null;
}

export async function loadExecutionRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    "/load-plans/:id/execution",
    async (request, reply) => {
      const plan = await prisma.loadPlan.findFirst({
        where: {
          tenantId: request.tenantId,
          OR: [{ id: request.params.id }, { code: request.params.id }],
        },
        select: { id: true },
      });
      if (!plan) return reply.notFound("Araç yükleme planı bulunamadı.");
      return { execution: await executionView(request.tenantId, plan.id) };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/load-plans/:id/instructions",
    async (request, reply): Promise<LoadInstructionSheet | undefined> => {
      const plan = await findPlan(request.tenantId, request.params.id);
      if (!plan) return reply.notFound("Araç yükleme planı bulunamadı.");
      return {
        planId: plan.id,
        planCode: plan.code,
        shipmentCode: plan.shipment.code,
        vehicleCode: plan.vehicleTemplate.code,
        vehicleName: plan.vehicleTemplate.name,
        mode: "shadow",
        generatedAt: new Date().toISOString(),
        steps: plan.placements.map((placement) => ({
          seq: placement.seq,
          unitCode: placement.hu.code,
          sscc: placement.hu.sscc,
          skuCode: placement.hu.sku?.code ?? null,
          stopCode: placement.hu.stop?.code ?? "",
          stopSeq: placement.hu.stop?.seq ?? 0,
          position: { x: placement.x, y: placement.y, z: placement.z },
          dimensions: {
            lengthM: placement.lengthM,
            widthM: placement.widthM,
            heightM: placement.heightM,
          },
          grossWeightKg: placement.grossWeightKg,
        })),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/load-plans/:id/publish",
    async (request, reply) => {
      const key = idempotencyKey(request.headers["idempotency-key"]);
      if (!key) return reply.badRequest("idempotency-key başlığı zorunludur.");
      const plan = await findPlan(request.tenantId, request.params.id);
      if (!plan) return reply.notFound("Araç yükleme planı bulunamadı.");
      if (plan.execution) {
        if (plan.execution.idempotencyKey !== key) {
          return reply.conflict("Bu plan zaten shadow yürütmeye alınmış.");
        }
        return {
          mode: "shadow" as const,
          idempotent: true,
          execution: await executionView(request.tenantId, plan.id),
        };
      }
      if (plan.state !== "VALIDATED") {
        return reply.conflict("Yalnız bağımsız doğrulamadan geçen plan shadow yayına alınabilir.");
      }

      await prisma.$transaction(async (tx) => {
        const execution = await tx.loadExecution.create({
          data: {
            tenantId: request.tenantId,
            planId: plan.id,
            idempotencyKey: key,
          },
        });
        await tx.loadPlan.update({ where: { id: plan.id }, data: { state: "PUBLISHED" } });
        await tx.auditLog.create({
          data: {
            tenantId: request.tenantId,
            action: "load-plan.shadow-publish",
            entityType: "LoadPlan",
            entityId: plan.id,
            correlationId: request.correlationId,
            after: {
              executionId: execution.id,
              mode: "shadow",
              idempotencyKey: key,
            },
          },
        });
      });
      return {
        mode: "shadow" as const,
        idempotent: false,
        execution: await executionView(request.tenantId, plan.id),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/load-plans/:id/scan-events",
    async (request, reply) => {
      const key = idempotencyKey(request.headers["idempotency-key"]);
      if (!key) return reply.badRequest("idempotency-key başlığı zorunludur.");
      const body = scanSchema.parse(request.body);
      const plan = await findPlan(request.tenantId, request.params.id);
      if (!plan) return reply.notFound("Araç yükleme planı bulunamadı.");
      if (!plan.execution) return reply.conflict("Plan önce shadow yayına alınmalıdır.");

      const repeated = plan.execution.events.find(
        (event) => event.idempotencyKey === key,
      );
      if (repeated) {
        return {
          idempotent: true,
          eventId: repeated.id,
          execution: await executionView(request.tenantId, plan.id),
        };
      }

      const confirmedHuIds = new Set(
        plan.execution.events
          .filter((event) => event.outcome === "CONFIRMED" && event.huId)
          .map((event) => event.huId!),
      );
      const expected = plan.placements.find(
        (placement) => !confirmedHuIds.has(placement.huId),
      );
      const scanned = plan.placements.find(
        (placement) =>
          placement.hu.code === body.scannedCode || placement.hu.sscc === body.scannedCode,
      );
      if (scanned && confirmedHuIds.has(scanned.huId)) {
        return reply.conflict(`${scanned.hu.code} daha önce teyit edildi.`);
      }

      let outcome: "CONFIRMED" | "MISSING" | "DAMAGED" | "OUT_OF_SEQUENCE" | "UNKNOWN";
      if (!scanned) outcome = "UNKNOWN";
      else if (body.outcome === "missing") outcome = "MISSING";
      else if (body.outcome === "damaged") outcome = "DAMAGED";
      else if (expected?.id !== scanned.id) outcome = "OUT_OF_SEQUENCE";
      else outcome = "CONFIRMED";

      const deviation = outcome !== "CONFIRMED";
      const loadedCount = plan.execution.loadedCount + (outcome === "CONFIRMED" ? 1 : 0);
      const completed = loadedCount === plan.placements.length && !deviation && plan.execution.deviationCount === 0;
      const now = new Date();
      const event = await prisma.$transaction(async (tx) => {
        const created = await tx.loadScanEvent.create({
          data: {
            tenantId: request.tenantId,
            executionId: plan.execution!.id,
            huId: scanned?.huId ?? null,
            idempotencyKey: key,
            scannedCode: body.scannedCode,
            expectedSeq: expected?.seq ?? null,
            actualSeq: scanned?.seq ?? null,
            outcome,
            note: body.note ?? null,
          },
        });
        await tx.loadExecution.update({
          where: { id: plan.execution!.id },
          data: {
            state:
              plan.execution!.state === "DEVIATED" || deviation
                ? "DEVIATED"
                : completed
                  ? "COMPLETED"
                  : "LOADING",
            currentSeq: outcome === "CONFIRMED" ? scanned!.seq : plan.execution!.currentSeq,
            loadedCount,
            deviationCount: plan.execution!.deviationCount + (deviation ? 1 : 0),
            startedAt: plan.execution!.startedAt ?? now,
            completedAt: completed ? now : null,
          },
        });
        if (completed) {
          await tx.shipment.update({ where: { id: plan.shipmentId }, data: { status: "LOADED" } });
        }
        if (deviation) {
          await tx.auditLog.create({
            data: {
              tenantId: request.tenantId,
              action: "load-execution.deviation",
              entityType: "LoadExecution",
              entityId: plan.execution!.id,
              correlationId: request.correlationId,
              after: {
                outcome: outcomeName(outcome),
                scannedCode: body.scannedCode,
                expectedCode: expected?.hu.code ?? null,
              },
            },
          });
        }
        return created;
      });

      return {
        idempotent: false,
        eventId: event.id,
        execution: await executionView(request.tenantId, plan.id),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/load-plans/:id/reoptimize",
    async (request, reply) => {
      const plan = await findPlan(request.tenantId, request.params.id);
      if (!plan) return reply.notFound("Araç yükleme planı bulunamadı.");
      if (!plan.execution || plan.execution.state !== "DEVIATED") {
        return reply.conflict("Yalnız sapma oluşmuş bir execution yeniden planlanabilir.");
      }
      if (plan.execution.replacementPlanId) {
        return reply.conflict("Bu sapma için yeni plan sürümü zaten üretildi.");
      }
      const confirmedHuIds = new Set(
        plan.execution.events
          .filter((event) => event.outcome === "CONFIRMED" && event.huId)
          .map((event) => event.huId!),
      );
      const excludedHuIds = new Set(
        plan.execution.events
          .filter(
            (event) =>
              (event.outcome === "MISSING" || event.outcome === "DAMAGED") && event.huId,
          )
          .map((event) => event.huId!),
      );
      const codeById = new Map(plan.placements.map((placement) => [placement.huId, placement.hu.code]));

      let prepared;
      try {
        prepared = await prepareTruckLoadRun(request.tenantId, {
          shipmentId: plan.shipmentId,
          vehicleTemplateCode: plan.vehicleTemplate.code,
          sourcePlanId: plan.id,
          sourceExecutionId: plan.execution.id,
          fixedUnitCodes: [...confirmedHuIds].map((id) => codeById.get(id)!).filter(Boolean),
          excludedUnitCodes: [...excludedHuIds].map((id) => codeById.get(id)!).filter(Boolean),
        });
      } catch (error) {
        return reply.badRequest(error instanceof Error ? error.message : String(error));
      }
      setTimeout(() => void executeTruckLoadRun(prepared.runId), 0);
      reply.status(202);
      return {
        runId: prepared.runId,
        status: "queued" as const,
        mode: "deviation-replan" as const,
        fixedUnitCount: confirmedHuIds.size,
        excludedUnitCount: excludedHuIds.size,
      };
    },
  );
}
