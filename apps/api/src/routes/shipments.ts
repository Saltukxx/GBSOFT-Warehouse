import type { FastifyInstance } from "fastify";
import type { PalletPlanView, ShipmentDetail, ShipmentSummary } from "@gbsoft/domain";
import { z } from "zod";
import { prisma } from "../db.js";
import { executePalletRun, preparePalletRun } from "../pallet/runner.js";

/**
 * Sevkiyatlar ve palet planları (Faz 7.2).
 *
 * Palet planı **doğrulama kapılıdır**: çözücü sonucu doğrudan `VALIDATED`
 * olmaz, `@gbsoft/domain`'deki bağımsız doğrulayıcıdan geçmek zorundadır.
 * İhlalli plan silinmez, `REJECTED` olarak ihlalleriyle saklanır.
 */

const createSchema = z.object({
  facility: z.string().min(1),
  code: z.string().min(1).max(64),
  carrierCode: z.string().max(64).optional(),
  plannedDepartureAt: z.string().datetime().optional(),
  stops: z
    .array(
      z.object({
        code: z.string().min(1).max(64),
        name: z.string().min(1).max(200),
        address: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(200),
  lines: z
    .array(
      z.object({
        stopCode: z.string().min(1),
        skuCode: z.string().min(1),
        packageTypeCode: z.string().min(1),
        quantity: z.number().int().min(1).max(5_000),
      }),
    )
    .min(1)
    .max(5_000),
});

const palletizeSchema = z.object({
  baseTypeCode: z.string().max(64).optional(),
  maxHeightM: z.number().positive().max(4).optional(),
  maxWeightKg: z.number().positive().max(5_000).optional(),
  timeLimitMs: z.number().int().min(500).max(60_000).optional(),
});

const STATUS: Record<string, ShipmentSummary["status"]> = {
  DRAFT: "draft",
  READY: "ready",
  PLANNED: "planned",
  LOADED: "loaded",
  DISPATCHED: "dispatched",
  CANCELLED: "cancelled",
};

export async function shipmentRoutes(app: FastifyInstance) {
  /* --- Liste ---------------------------------------------------------- */
  app.get<{ Querystring: { facility?: string } }>(
    "/shipments",
    async (request, reply): Promise<{ shipments: ShipmentSummary[] } | undefined> => {
      const code = request.query.facility;
      if (!code) return reply.badRequest("facility parametresi zorunlu.");

      const facility = await prisma.facility.findUnique({
        where: { tenantId_code: { tenantId: request.tenantId, code } },
        select: { id: true },
      });
      if (!facility) return reply.notFound(`Tesis bulunamadı: ${code}`);

      const shipments = await prisma.shipment.findMany({
        where: { tenantId: request.tenantId, facilityId: facility.id },
        orderBy: { createdAt: "desc" },
        include: {
          lines: { select: { quantity: true } },
          _count: { select: { stops: true, palletPlans: true } },
        },
      });

      return {
        shipments: shipments.map((shipment) => ({
          id: shipment.id,
          code: shipment.code,
          carrierCode: shipment.carrierCode,
          status: STATUS[shipment.status] ?? "ready",
          plannedDepartureAt: shipment.plannedDepartureAt?.toISOString() ?? null,
          stopCount: shipment._count.stops,
          lineCount: shipment.lines.length,
          unitCount: shipment.lines.reduce((sum, line) => sum + line.quantity, 0),
          palletCount: shipment._count.palletPlans,
          createdAt: shipment.createdAt.toISOString(),
        })),
      };
    },
  );

  /* --- Oluşturma ------------------------------------------------------ */
  app.post("/shipments", async (request, reply) => {
    const body = createSchema.parse(request.body);

    const facility = await prisma.facility.findUnique({
      where: { tenantId_code: { tenantId: request.tenantId, code: body.facility } },
      select: { id: true },
    });
    if (!facility) return reply.notFound(`Tesis bulunamadı: ${body.facility}`);

    const [skus, packageTypes] = await Promise.all([
      prisma.sku.findMany({
        where: {
          tenantId: request.tenantId,
          facilityId: facility.id,
          code: { in: [...new Set(body.lines.map((line) => line.skuCode))] },
        },
        select: { id: true, code: true },
      }),
      prisma.packageType.findMany({
        where: {
          tenantId: request.tenantId,
          code: { in: [...new Set(body.lines.map((line) => line.packageTypeCode))] },
        },
        select: { id: true, code: true },
      }),
    ]);

    const skuByCode = new Map(skus.map((sku) => [sku.code, sku.id]));
    const typeByCode = new Map(packageTypes.map((type) => [type.code, type.id]));
    const stopCodes = new Set(body.stops.map((stop) => stop.code));

    // Eksik referanslar sessizce atlanmaz: yarım bir sevkiyat, hiç olmayandan
    // kötüdür.
    const unknownSkus = [
      ...new Set(body.lines.map((l) => l.skuCode).filter((c) => !skuByCode.has(c))),
    ];
    if (unknownSkus.length > 0) {
      return reply.badRequest(`Bilinmeyen SKU: ${unknownSkus.slice(0, 10).join(", ")}`);
    }
    const unknownTypes = [
      ...new Set(
        body.lines.map((l) => l.packageTypeCode).filter((c) => !typeByCode.has(c)),
      ),
    ];
    if (unknownTypes.length > 0) {
      return reply.badRequest(
        `Bilinmeyen paket türü: ${unknownTypes.slice(0, 10).join(", ")}`,
      );
    }
    const unknownStops = [
      ...new Set(body.lines.map((l) => l.stopCode).filter((c) => !stopCodes.has(c))),
    ];
    if (unknownStops.length > 0) {
      return reply.badRequest(`Bilinmeyen durak: ${unknownStops.slice(0, 10).join(", ")}`);
    }

    const existing = await prisma.shipment.findUnique({
      where: {
        tenantId_facilityId_code: {
          tenantId: request.tenantId,
          facilityId: facility.id,
          code: body.code,
        },
      },
      select: { id: true },
    });
    if (existing) return reply.conflict(`Bu sevkiyat kodu zaten var: ${body.code}`);

    const shipment = await prisma.$transaction(async (tx) => {
      const created = await tx.shipment.create({
        data: {
          tenantId: request.tenantId,
          facilityId: facility.id,
          code: body.code,
          carrierCode: body.carrierCode ?? null,
          plannedDepartureAt: body.plannedDepartureAt
            ? new Date(body.plannedDepartureAt)
            : null,
          stops: {
            create: body.stops.map((stop, index) => ({
              tenantId: request.tenantId,
              seq: index + 1,
              code: stop.code,
              name: stop.name,
              address: stop.address ?? null,
            })),
          },
        },
        include: { stops: { select: { id: true, code: true } } },
      });

      const stopByCode = new Map(created.stops.map((stop) => [stop.code, stop.id]));
      await tx.shipmentLine.createMany({
        data: body.lines.map((line, index) => ({
          tenantId: request.tenantId,
          shipmentId: created.id,
          stopId: stopByCode.get(line.stopCode)!,
          lineNo: index + 1,
          skuId: skuByCode.get(line.skuCode)!,
          packageTypeId: typeByCode.get(line.packageTypeCode)!,
          quantity: line.quantity,
        })),
      });

      return created;
    });

    reply.status(201);
    return { id: shipment.id, code: shipment.code };
  });

  /* --- Detay ---------------------------------------------------------- */
  app.get<{ Params: { id: string } }>(
    "/shipments/:id",
    async (request, reply): Promise<ShipmentDetail | undefined> => {
      const shipment = await prisma.shipment.findFirst({
        where: {
          tenantId: request.tenantId,
          OR: [{ id: request.params.id }, { code: request.params.id }],
        },
        include: {
          facility: { select: { code: true } },
          stops: { orderBy: { seq: "asc" } },
          _count: { select: { palletPlans: true } },
          lines: {
            orderBy: { lineNo: "asc" },
            include: {
              sku: { select: { code: true, name: true } },
              packageType: { select: { code: true, name: true } },
              stop: { select: { code: true } },
            },
          },
        },
      });
      if (!shipment) return reply.notFound("Sevkiyat bulunamadı.");

      return {
        id: shipment.id,
        code: shipment.code,
        facilityCode: shipment.facility.code,
        carrierCode: shipment.carrierCode,
        status: STATUS[shipment.status] ?? "ready",
        plannedDepartureAt: shipment.plannedDepartureAt?.toISOString() ?? null,
        stopCount: shipment.stops.length,
        lineCount: shipment.lines.length,
        unitCount: shipment.lines.reduce((sum, line) => sum + line.quantity, 0),
        palletCount: shipment._count.palletPlans,
        createdAt: shipment.createdAt.toISOString(),
        stops: shipment.stops.map((stop) => ({
          seq: stop.seq,
          code: stop.code,
          name: stop.name,
          address: stop.address,
        })),
        lines: shipment.lines.map((line) => ({
          lineNo: line.lineNo,
          stopCode: line.stop.code,
          skuCode: line.sku.code,
          skuName: line.sku.name,
          packageTypeCode: line.packageType.code,
          packageTypeName: line.packageType.name,
          quantity: line.quantity,
        })),
      };
    },
  );

  /* --- Paletle -------------------------------------------------------- */
  app.post<{ Params: { id: string } }>(
    "/shipments/:id/palletize",
    async (request, reply) => {
      const body = palletizeSchema.parse(request.body ?? {});
      let prepared;
      try {
        prepared = await preparePalletRun(request.tenantId, {
          shipmentId: request.params.id,
          ...body,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.badRequest(message);
      }

      setTimeout(() => void executePalletRun(prepared.runId), 0);
      reply.status(202);
      return {
        runId: prepared.runId,
        status: "queued" as const,
        handlingUnitCount: prepared.handlingUnitCount,
      };
    },
  );

  /* --- Palet planları -------------------------------------------------- */
  app.get<{ Params: { id: string } }>(
    "/shipments/:id/pallet-plans",
    async (request, reply): Promise<{ plans: PalletPlanView[] } | undefined> => {
      const shipment = await prisma.shipment.findFirst({
        where: {
          tenantId: request.tenantId,
          OR: [{ id: request.params.id }, { code: request.params.id }],
        },
        select: { id: true },
      });
      if (!shipment) return reply.notFound("Sevkiyat bulunamadı.");

      const plans = await prisma.palletPlan.findMany({
        where: { tenantId: request.tenantId, shipmentId: shipment.id },
        orderBy: { seq: "asc" },
        include: {
          baseType: { select: { code: true, name: true } },
          placements: {
            orderBy: { seq: "asc" },
            include: {
              hu: {
                select: {
                  code: true,
                  packageType: { select: { code: true } },
                  sku: { select: { code: true } },
                  stop: { select: { code: true } },
                },
              },
            },
          },
        },
      });

      return {
        plans: plans.map((plan) => ({
          id: plan.id,
          code: plan.code,
          seq: plan.seq,
          runId: plan.runId,
          state: plan.state.toLowerCase() as PalletPlanView["state"],
          base: {
            packageTypeCode: plan.baseType.code,
            packageTypeName: plan.baseType.name,
            lengthM: plan.baseLengthM,
            widthM: plan.baseWidthM,
            deckHeightM: plan.deckHeightM,
            maxHeightM: plan.maxHeightM,
            maxWeightKg: plan.maxWeightKg,
          },
          usedHeightM: plan.usedHeightM,
          usedWeightKg: plan.usedWeightKg,
          volumeUtilizationPct: plan.volumeUtilizationPct,
          footprintUtilizationPct: plan.footprintUtilizationPct,
          centerOfGravity: { x: plan.cogX, y: plan.cogY, z: plan.cogZ },
          violations: (plan.violations as PalletPlanView["violations"]) ?? [],
          placements: plan.placements.map((placement) => ({
            huCode: placement.hu.code,
            packageTypeCode: placement.hu.packageType.code,
            skuCode: placement.hu.sku?.code ?? null,
            stopCode: placement.hu.stop?.code ?? null,
            x: placement.x,
            y: placement.y,
            z: placement.z,
            lengthM: placement.lengthM,
            widthM: placement.widthM,
            heightM: placement.heightM,
            grossWeightKg: placement.grossWeightKg,
            layer: placement.layer,
            seq: placement.seq,
          })),
        })),
      };
    },
  );
}
