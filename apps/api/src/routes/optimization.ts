import type { FastifyInstance } from "fastify";
import type {
  CreateOptimizationRunResponse,
  OptimizationRunResponse,
  ReoptimizeRequest,
} from "@gbsoft/domain";
import { z } from "zod";
import { prisma } from "../db.js";
import { executeOptimizationRun, prepareOptimizationRun } from "../optimizer/runner.js";

const requestSchema = z.object({
  planId: z.string().min(1),
  profile: z.enum(["balanced", "picking", "low-move", "peak"]),
  weights: z.object({
    pickingTime: z.number().nonnegative(),
    replenishment: z.number().nonnegative(),
    congestion: z.number().nonnegative(),
    moveCost: z.number().nonnegative(),
  }),
  moveBudget: z.number().int().min(0).max(500),
  minNetBenefitPct: z.number().min(0).max(100),
  lockedAssignments: z.array(z.object({ skuId: z.string(), locationId: z.string() })),
  excludedSkuIds: z.array(z.string()),
  blockedLocationIds: z.array(z.string()),
  frozenZones: z.array(z.enum(["A", "B", "C", "D"])),
});

const STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  FEASIBLE: "feasible",
  INFEASIBLE: "infeasible",
  FAILED: "failed",
  TIMEOUT: "timeout",
} as const;

export async function optimizationRoutes(app: FastifyInstance) {
  app.post<{ Body: ReoptimizeRequest }>(
    "/optimization-runs",
    async (request, reply): Promise<CreateOptimizationRunResponse> => {
      const body = requestSchema.parse(request.body);
      const run = await prepareOptimizationRun(request.tenantId, body);
      setTimeout(() => void executeOptimizationRun(run.id), 0);
      reply.status(202);
      return { runId: run.id, status: "queued" };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/optimization-runs/:id",
    async (request, reply): Promise<OptimizationRunResponse | undefined> => {
      const run = await prisma.optimizationRun.findFirst({
        where: { id: request.params.id, tenantId: request.tenantId },
        include: { resultPlan: { select: { code: true } } },
      });
      if (!run) return reply.notFound("Optimizasyon çalıştırması bulunamadı.");
      const basePlan = run.basePlanId
        ? await prisma.slotPlan.findUnique({
            where: { id: run.basePlanId },
            select: { code: true },
          })
        : null;
      const loadPlan =
        run.kind === "TRUCK_LOAD"
          ? await prisma.loadPlan.findFirst({
              where: { tenantId: request.tenantId, runId: run.id },
              select: { code: true },
            })
          : null;
      const result = (run.resultSnapshot ?? {}) as {
        objective_delta_pct?: number;
        move_count?: number;
      };
      return {
        runId: run.id,
        status: STATUS[run.status],
        planId: run.resultPlan?.code ?? loadPlan?.code ?? basePlan?.code ?? "",
        solverVersion: run.solverVersion,
        solutionQuality: (run.solutionQuality ?? "none") as "optimal" | "feasible" | "none",
        objectiveDeltaPct:
          result.objective_delta_pct === undefined
            ? 0
            : -result.objective_delta_pct,
        gapPct: run.gapPct ?? undefined,
        hardViolations: run.hardViolations,
        moveTaskCount: result.move_count ?? 0,
        solveDurationMs: run.solveDurationMs ?? 0,
        infeasibilityReasons: (run.infeasibilityReasons as string[] | null) ?? undefined,
        relaxationOptions: (run.relaxationOptions as string[] | null) ?? undefined,
      };
    },
  );
}
