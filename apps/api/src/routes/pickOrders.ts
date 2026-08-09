import type { FastifyInstance } from "fastify";
import type {
  Equipment,
  PickOrderDetail,
  PickOrderStatus,
  PickOrderSummary,
  PickTourPlan,
  RoutePlan,
} from "@gbsoft/domain";
import { z } from "zod";
import { prisma } from "../db.js";
import { executePickTourRun, preparePickTourRun } from "../picktour/runner.js";
import { routePlanForLayout } from "../twin/routes3d.js";

/**
 * Yükleme siparişleri ve toplama turları (Faz 6.5).
 *
 * Optimizasyon açık bir komuttur ve asenkrondur: `POST .../optimize` 202 +
 * `runId` döner, sonuç `GET /api/optimization-runs/:id` ile izlenir. Solver
 * sonucu kendiliğinden WMS görevine dönüşmez — Faz 5'te slotting için konan
 * kuralın aynısı.
 */

const STATUS: Record<string, PickOrderStatus> = {
  DRAFT: "draft",
  READY: "ready",
  PLANNED: "planned",
  RELEASED: "released",
  CANCELLED: "cancelled",
};

const createSchema = z.object({
  facility: z.string().min(1),
  code: z.string().min(1).max(64),
  dockCode: z.string().max(64).optional(),
  priority: z.number().int().min(0).max(9).optional(),
  dueAt: z.string().datetime().optional(),
  lines: z
    .array(
      z.object({
        skuCode: z.string().min(1),
        quantity: z.number().int().min(1).max(10_000),
        uom: z.string().max(16).optional(),
      }),
    )
    .min(1)
    .max(2_000),
});

const optimizeSchema = z.object({
  equipment: z.enum(["manual", "cart", "forklift"]).optional(),
  vehicleCount: z.number().int().min(1).max(32).optional(),
  capacityVolumeM3: z.number().positive().max(200).optional(),
  capacityWeightKg: z.number().positive().max(20_000).optional(),
  objective: z.enum(["makespan", "total"]).optional(),
  timeLimitMs: z.number().int().min(500).max(60_000).optional(),
});

export async function pickOrderRoutes(app: FastifyInstance) {
  /* --- Liste ---------------------------------------------------------- */
  app.get<{ Querystring: { facility?: string } }>(
    "/pick-orders",
    async (request, reply): Promise<{ orders: PickOrderSummary[] } | undefined> => {
      const code = request.query.facility;
      if (!code) return reply.badRequest("facility parametresi zorunlu.");

      const facility = await prisma.facility.findUnique({
        where: { tenantId_code: { tenantId: request.tenantId, code } },
        select: { id: true },
      });
      if (!facility) return reply.notFound(`Tesis bulunamadı: ${code}`);

      const orders = await prisma.pickOrder.findMany({
        where: { tenantId: request.tenantId, facilityId: facility.id },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        include: {
          lines: { select: { quantity: true } },
          _count: { select: { tours: true } },
        },
      });

      return {
        orders: orders.map((order) => ({
          id: order.id,
          code: order.code,
          dockCode: order.dockCode,
          status: STATUS[order.status] ?? "ready",
          priority: order.priority,
          dueAt: order.dueAt?.toISOString() ?? null,
          lineCount: order.lines.length,
          unitCount: order.lines.reduce((sum, line) => sum + line.quantity, 0),
          createdAt: order.createdAt.toISOString(),
          hasTours: order._count.tours > 0,
        })),
      };
    },
  );

  /* --- Oluşturma ------------------------------------------------------ */
  app.post("/pick-orders", async (request, reply) => {
    const body = createSchema.parse(request.body);
    const facility = await prisma.facility.findUnique({
      where: { tenantId_code: { tenantId: request.tenantId, code: body.facility } },
      select: { id: true },
    });
    if (!facility) return reply.notFound(`Tesis bulunamadı: ${body.facility}`);

    const skus = await prisma.sku.findMany({
      where: {
        tenantId: request.tenantId,
        facilityId: facility.id,
        code: { in: body.lines.map((line) => line.skuCode) },
      },
      select: { id: true, code: true },
    });
    const skuByCode = new Map(skus.map((sku) => [sku.code, sku.id]));
    const unknown = body.lines
      .map((line) => line.skuCode)
      .filter((code) => !skuByCode.has(code));
    if (unknown.length > 0) {
      // Bilinmeyen SKU sessizce atlanmaz: yarım bir sipariş, hiç olmayan
      // siparişten kötüdür.
      return reply.badRequest(
        `Bilinmeyen SKU kodu: ${[...new Set(unknown)].slice(0, 10).join(", ")}`,
      );
    }

    const existing = await prisma.pickOrder.findUnique({
      where: {
        tenantId_facilityId_code: {
          tenantId: request.tenantId,
          facilityId: facility.id,
          code: body.code,
        },
      },
      select: { id: true },
    });
    if (existing) return reply.conflict(`Bu sipariş kodu zaten var: ${body.code}`);

    const order = await prisma.pickOrder.create({
      data: {
        tenantId: request.tenantId,
        facilityId: facility.id,
        code: body.code,
        dockCode: body.dockCode ?? null,
        priority: body.priority ?? 0,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        lines: {
          create: body.lines.map((line, index) => ({
            tenantId: request.tenantId,
            lineNo: index + 1,
            skuId: skuByCode.get(line.skuCode)!,
            quantity: line.quantity,
            uom: line.uom ?? "adet",
          })),
        },
      },
      select: { id: true, code: true },
    });

    reply.status(201);
    return { id: order.id, code: order.code };
  });

  /* --- Detay ---------------------------------------------------------- */
  app.get<{ Params: { id: string } }>(
    "/pick-orders/:id",
    async (request, reply): Promise<PickOrderDetail | undefined> => {
      const order = await prisma.pickOrder.findFirst({
        where: {
          tenantId: request.tenantId,
          OR: [{ id: request.params.id }, { code: request.params.id }],
        },
        include: {
          facility: { select: { code: true } },
          _count: { select: { tours: true } },
          lines: {
            orderBy: { lineNo: "asc" },
            include: {
              sku: {
                select: {
                  code: true,
                  name: true,
                  placements: {
                    where: { effectiveTo: null },
                    orderBy: { effectiveFrom: "desc" },
                    take: 1,
                    select: { location: { select: { code: true } } },
                  },
                },
              },
            },
          },
        },
      });
      if (!order) return reply.notFound("Yükleme siparişi bulunamadı.");

      return {
        id: order.id,
        code: order.code,
        facilityCode: order.facility.code,
        dockCode: order.dockCode,
        status: STATUS[order.status] ?? "ready",
        priority: order.priority,
        dueAt: order.dueAt?.toISOString() ?? null,
        lineCount: order.lines.length,
        unitCount: order.lines.reduce((sum, line) => sum + line.quantity, 0),
        createdAt: order.createdAt.toISOString(),
        hasTours: order._count.tours > 0,
        lines: order.lines.map((line) => ({
          lineNo: line.lineNo,
          skuCode: line.sku.code,
          skuName: line.sku.name,
          quantity: line.quantity,
          uom: line.uom,
          locationCode: line.sku.placements[0]?.location.code ?? null,
        })),
      };
    },
  );

  /* --- Optimize et ---------------------------------------------------- */
  app.post<{ Params: { id: string } }>(
    "/pick-orders/:id/optimize",
    async (request, reply) => {
      const body = optimizeSchema.parse(request.body ?? {});
      let prepared;
      try {
        prepared = await preparePickTourRun(request.tenantId, {
          orderId: request.params.id,
          ...body,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.badRequest(message);
      }

      setTimeout(() => void executePickTourRun(prepared.runId), 0);
      reply.status(202);
      return {
        runId: prepared.runId,
        status: "queued" as const,
        skippedLines: prepared.skippedLines,
      };
    },
  );

  /* --- Turlar --------------------------------------------------------- */
  app.get<{ Params: { id: string } }>(
    "/pick-orders/:id/tours",
    async (request, reply): Promise<PickTourPlan | undefined> => {
      const order = await prisma.pickOrder.findFirst({
        where: {
          tenantId: request.tenantId,
          OR: [{ id: request.params.id }, { code: request.params.id }],
        },
        include: {
          tours: {
            orderBy: { seq: "asc" },
            include: { stops: { orderBy: { seq: "asc" } } },
          },
        },
      });
      if (!order) return reply.notFound("Yükleme siparişi bulunamadı.");
      if (order.tours.length === 0) {
        return reply.notFound(
          "Bu sipariş için henüz tur üretilmedi. Önce optimize edin.",
        );
      }

      const runId = order.tours[0].runId;
      const [run, model] = await Promise.all([
        prisma.optimizationRun.findUnique({ where: { id: runId } }),
        prisma.pickTimeModel.findFirst({
          where: { tenantId: request.tenantId, facilityId: order.facilityId, isActive: true },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      const result = (run?.resultSnapshot ?? {}) as {
        makespan_sec?: number;
        total_sec?: number;
        lower_bound_sec?: number;
      };
      const constraints = (run?.constraints ?? {}) as {
        skippedLines?: PickTourPlan["skippedLines"];
      };

      return {
        orderId: order.id,
        orderCode: order.code,
        runId,
        solverVersion: run?.solverVersion ?? "",
        // Routing optimum kanıtlamaz; burada asla "optimal" yazılmaz.
        solutionQuality: (run?.solutionQuality === "feasible" ? "feasible" : "none"),
        makespanSec: result.makespan_sec ?? 0,
        totalSec: result.total_sec ?? 0,
        lowerBoundSec: result.lower_bound_sec ?? 0,
        calibrated: model?.calibrated ?? false,
        modelVersion: run?.modelVersion ?? "",
        skippedLines: constraints.skippedLines ?? [],
        tours: order.tours.map((tour) => ({
          id: tour.id,
          seq: tour.seq,
          equipment: tour.equipment as Equipment,
          totalDistanceM: tour.totalDistanceM,
          estimatedSec: tour.estimatedSec,
          volumeUsedM3: tour.volumeUsedM3,
          weightUsedKg: tour.weightUsedKg,
          stops: tour.stops.map((stop) => ({
            seq: stop.seq,
            locationCode: stop.locationCode,
            skuCode: stop.skuCode,
            quantity: stop.quantity,
            travelSec: stop.travelSec,
            congestionSec: stop.congestionSec,
            pickSec: stop.pickSec,
            cumulativeSec: stop.cumulativeSec,
          })),
        })),
      };
    },
  );

  /* --- Turun 3B güzergâhı --------------------------------------------- */
  app.get<{ Params: { id: string; tourId: string } }>(
    "/pick-orders/:id/tours/:tourId/route",
    async (request, reply): Promise<RoutePlan | undefined> => {
      const tour = await prisma.pickTour.findFirst({
        where: {
          tenantId: request.tenantId,
          id: request.params.tourId,
          order: {
            OR: [{ id: request.params.id }, { code: request.params.id }],
          },
        },
        include: {
          stops: { orderBy: { seq: "asc" } },
          order: { select: { facilityId: true } },
        },
      });
      if (!tour) return reply.notFound("Tur bulunamadı.");

      const layout = await prisma.layoutVersion.findFirst({
        where: { tenantId: request.tenantId, facilityId: tour.order.facilityId, isActive: true },
        orderBy: { version: "desc" },
        include: { facility: { select: { code: true } } },
      });
      if (!layout) return reply.notFound("Aktif dijital ikiz sürümü yok.");

      // Tur dock'tan çıkar, durakları sırayla gezer, dock'a döner —
      // solver'ın çözdüğü sıranın aynısı.
      const stops = ["DOCK", ...tour.stops.map((stop) => stop.locationCode), "DOCK"];

      return prisma.$transaction((tx) =>
        routePlanForLayout(
          tx,
          request.tenantId,
          {
            id: layout.id,
            version: layout.version,
            unitsPerMeter: layout.unitsPerMeter,
            facilityCode: layout.facility.code,
          },
          stops,
        ),
      );
    },
  );
}
