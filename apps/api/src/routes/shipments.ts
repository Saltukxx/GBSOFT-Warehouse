import type { FastifyInstance } from "fastify";
import {
  allowedFootprints,
  validateTruckLoadPlan,
  validatePalletPlan,
  type PalletPlacement,
  type PalletPlanView,
  type ShipmentDetail,
  type ShipmentSummary,
  type TruckLoadPlanView,
  type TruckLoadPosition,
  type TruckLoadUnit,
} from "@gbsoft/domain";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  executePalletRun,
  preparePalletRun,
  toDomainType,
} from "../pallet/runner.js";
import {
  executeTruckLoadRun,
  prepareTruckLoadRun,
} from "../truckload/runner.js";
import { toVehicleTemplate } from "../truckload/vehicle.js";

/**
 * Sevkiyatlar, palet planları ve rota-duyarlı araç yükleme (Faz 7.2–8.2).
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
        /** Kaç elleçleme birimi üretileceği. */
        quantity: z.number().int().min(1).max(5_000),
        /**
         * Bir elleçleme biriminin içindeki SKU adedi.
         *
         * Koli için 1'dir ve verilmezse öyle kabul edilir. Palet birim
         * yükünde paletin üzerindeki koli sayısıdır; brüt ağırlık dara + bu
         * adet × SKU ağırlığı olduğu için palet ağırlığı buradan gelir.
         */
        unitsPerHandlingUnit: z.number().int().min(1).max(5_000).optional(),
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
  keepLocked: z.boolean().optional(),
});

const truckLoadSchema = z.object({
  vehicleTemplateCode: z.string().min(1).max(64),
  timeLimitMs: z.number().int().min(500).max(120_000).optional(),
  keepLocked: z.boolean().optional(),
});

const editPlacementSchema = z
  .object({
    x: z.number().min(0).max(20).optional(),
    y: z.number().min(0).max(20).optional(),
    z: z.number().min(0).max(20).optional(),
    rotateYaw: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.x !== undefined ||
      body.y !== undefined ||
      body.z !== undefined ||
      body.rotateYaw !== undefined ||
      body.locked !== undefined,
    "En az bir değişiklik gönderilmelidir.",
  );

const editLoadPlacementSchema = z
  .object({
    x: z.number().min(0).max(30).optional(),
    y: z.number().min(0).max(10).optional(),
    z: z.number().min(0).max(10).optional(),
    rotateYaw: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.x !== undefined ||
      body.y !== undefined ||
      body.z !== undefined ||
      body.rotateYaw !== undefined ||
      body.locked !== undefined,
    "En az bir değişiklik gönderilmelidir.",
  );

const json = (value: unknown) => value as Prisma.InputJsonValue;

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
          unitsPerHandlingUnit: line.unitsPerHandlingUnit ?? 1,
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
          unitsPerHandlingUnit: line.unitsPerHandlingUnit,
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

  /* --- Rota-duyarlı araç yükleme ----------------------------------- */
  app.post<{ Params: { id: string } }>(
    "/shipments/:id/truck-load",
    async (request, reply) => {
      const body = truckLoadSchema.parse(request.body);
      let prepared;
      try {
        prepared = await prepareTruckLoadRun(request.tenantId, {
          shipmentId: request.params.id,
          ...body,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.badRequest(message);
      }

      setTimeout(() => void executeTruckLoadRun(prepared.runId), 0);
      reply.status(202);
      return {
        runId: prepared.runId,
        status: "queued" as const,
        handlingUnitCount: prepared.handlingUnitCount,
        vehicleTemplateCode: prepared.vehicleTemplateCode,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/shipments/:id/load-plans",
    async (request, reply): Promise<{ plans: TruckLoadPlanView[] } | undefined> => {
      const shipment = await prisma.shipment.findFirst({
        where: {
          tenantId: request.tenantId,
          OR: [{ id: request.params.id }, { code: request.params.id }],
        },
        select: { id: true },
      });
      if (!shipment) return reply.notFound("Sevkiyat bulunamadı.");

      const plans = await prisma.loadPlan.findMany({
        where: { tenantId: request.tenantId, shipmentId: shipment.id },
        orderBy: { createdAt: "desc" },
        include: {
          vehicleTemplate: true,
          placements: {
            orderBy: { seq: "asc" },
            include: {
              hu: {
                include: {
                  packageType: { select: { code: true } },
                  sku: { select: { code: true } },
                  stop: { select: { code: true, seq: true } },
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
          runId: plan.runId,
          state: plan.state.toLowerCase() as TruckLoadPlanView["state"],
          vehicle: toVehicleTemplate(plan.vehicleTemplate),
          payloadKg: plan.payloadKg,
          volumeUtilizationPct: plan.volumeUtilizationPct,
          centerOfGravity: { x: plan.cogX, y: plan.cogY, z: plan.cogZ },
          axleLoads: plan.axleLoads as TruckLoadPlanView["axleLoads"],
          rehandlingRiskCount: plan.rehandlingRiskCount,
          violations: plan.violations as TruckLoadPlanView["violations"],
          placements: plan.placements.map((placement) => ({
            unitCode: placement.hu.code,
            skuCode: placement.hu.sku?.code ?? null,
            stopCode: placement.hu.stop?.code ?? "",
            stopSeq: placement.hu.stop?.seq ?? 0,
            grossWeightKg: placement.grossWeightKg,
            x: placement.x,
            y: placement.y,
            z: placement.z,
            lengthM: placement.lengthM,
            widthM: placement.widthM,
            heightM: placement.heightM,
            seq: placement.seq,
            locked: placement.locked,
          })),
          createdAt: plan.createdAt.toISOString(),
        })),
      };
    },
  );

  app.patch<{ Params: { planId: string; huCode: string } }>(
    "/load-plans/:planId/placements/:huCode",
    async (request, reply) => {
      const body = editLoadPlacementSchema.parse(request.body);
      const plan = await prisma.loadPlan.findFirst({
        where: { id: request.params.planId, tenantId: request.tenantId },
        include: {
          vehicleTemplate: true,
          placements: {
            orderBy: { seq: "asc" },
            include: {
              hu: { include: { packageType: true, stop: true } },
            },
          },
        },
      });
      if (!plan) return reply.notFound("Araç yükleme planı bulunamadı.");
      if (plan.state === "PUBLISHED") {
        return reply.conflict("Yayınlanmış araç yükleme planı değiştirilemez.");
      }
      const selected = plan.placements.find(
        (placement) => placement.hu.code === request.params.huCode,
      );
      if (!selected) return reply.notFound("Elleçleme birimi bu planda bulunamadı.");
      if (body.rotateYaw && selected.hu.packageType.rotation === "fixed") {
        return reply.badRequest(`${selected.hu.code} paket profili yatay döndürmeye izin vermiyor.`);
      }

      let lengthM = selected.lengthM;
      let widthM = selected.widthM;
      if (body.rotateYaw) [lengthM, widthM] = [widthM, lengthM];
      const round = (value: number) => Math.round(value * 10_000) / 10_000;
      const positions: TruckLoadPosition[] = plan.placements.map((placement) => ({
        unitCode: placement.hu.code,
        x:
          placement.id === selected.id && body.x !== undefined
            ? round(body.x)
            : placement.x,
        y:
          placement.id === selected.id && body.y !== undefined
            ? round(body.y)
            : placement.y,
        z:
          placement.id === selected.id && body.z !== undefined
            ? round(body.z)
            : placement.z,
        lengthM: placement.id === selected.id ? lengthM : placement.lengthM,
        widthM: placement.id === selected.id ? widthM : placement.widthM,
        heightM: placement.heightM,
        seq: placement.seq,
        locked:
          placement.id === selected.id
            ? (body.locked ?? placement.locked)
            : placement.locked,
      }));
      const units: TruckLoadUnit[] = plan.placements.map((placement) => ({
        code: placement.hu.code,
        lengthM: placement.hu.packageType.lengthM,
        widthM: placement.hu.packageType.widthM,
        heightM: placement.hu.packageType.heightM,
        grossWeightKg: Math.max(0.001, placement.hu.grossWeightKg),
        stopCode: placement.hu.stop?.code ?? "",
        stopSeq: placement.hu.stop?.seq ?? 0,
        rotation: placement.hu.packageType.rotation === "fixed" ? "fixed" : "yaw",
        floorOnly: true,
      }));
      const validation = validateTruckLoadPlan({
        vehicle: toVehicleTemplate(plan.vehicleTemplate),
        units,
        positions,
      });
      const edited = positions.find((position) => position.unitCode === selected.hu.code)!;

      await prisma.$transaction([
        prisma.loadPlacement.update({
          where: { id: selected.id },
          data: {
            x: edited.x,
            y: edited.y,
            z: edited.z,
            lengthM: edited.lengthM,
            widthM: edited.widthM,
            locked: edited.locked ?? selected.locked,
          },
        }),
        prisma.loadPlan.update({
          where: { id: plan.id },
          data: {
            state: validation.valid ? "VALIDATED" : "REJECTED",
            payloadKg: validation.payloadKg,
            volumeUtilizationPct: validation.volumeUtilizationPct,
            cogX: validation.centerOfGravity.x,
            cogY: validation.centerOfGravity.y,
            cogZ: validation.centerOfGravity.z,
            axleLoads: json(validation.axleLoads),
            rehandlingRiskCount: validation.rehandlingRiskCount,
            violations: json(validation.violations),
            validatedAt: new Date(),
          },
        }),
      ]);

      return {
        planId: plan.id,
        state: validation.valid ? "validated" : "rejected",
        violations: validation.violations,
        metrics: {
          payloadKg: validation.payloadKg,
          volumeUtilizationPct: validation.volumeUtilizationPct,
          centerOfGravity: validation.centerOfGravity,
          axleLoads: validation.axleLoads,
          rehandlingRiskCount: validation.rehandlingRiskCount,
        },
        placement: {
          ...edited,
          locked: edited.locked ?? selected.locked,
        },
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
            locked: placement.locked,
          })),
        })),
      };
    },
  );

  /* --- Palet yerleşimi düzenle ---------------------------------------- */
  app.patch<{ Params: { planId: string; huCode: string } }>(
    "/pallet-plans/:planId/placements/:huCode",
    async (request, reply) => {
      const body = editPlacementSchema.parse(request.body);
      const plan = await prisma.palletPlan.findFirst({
        where: { id: request.params.planId, tenantId: request.tenantId },
        include: {
          baseType: true,
          placements: {
            orderBy: { seq: "asc" },
            include: { hu: { include: { packageType: true } } },
          },
        },
      });
      if (!plan) return reply.notFound("Palet planı bulunamadı.");
      if (plan.state === "PUBLISHED") {
        return reply.conflict("Yayınlanmış palet planı editörde değiştirilemez.");
      }

      const selected = plan.placements.find(
        (placement) => placement.hu.code === request.params.huCode,
      );
      if (!selected) return reply.notFound("Elleçleme birimi bu palette bulunamadı.");

      let lengthM = selected.lengthM;
      let widthM = selected.widthM;
      if (body.rotateYaw) {
        [lengthM, widthM] = [widthM, lengthM];
        const allowed = allowedFootprints(toDomainType(selected.hu.packageType)).some(
          (footprint) =>
            Math.abs(footprint.lengthM - lengthM) <= 1e-4 &&
            Math.abs(footprint.widthM - widthM) <= 1e-4 &&
            Math.abs(footprint.heightM - selected.heightM) <= 1e-4,
        );
        if (!allowed) {
          return reply.badRequest(
            `${selected.hu.code} paket profili yatay döndürmeye izin vermiyor.`,
          );
        }
      }

      const round = (value: number) => Math.round(value * 10_000) / 10_000;
      const placements: PalletPlacement[] = plan.placements.map((placement) => ({
        huCode: placement.hu.code,
        packageTypeCode: placement.hu.packageType.code,
        x:
          placement.id === selected.id && body.x !== undefined
            ? round(body.x)
            : placement.x,
        y:
          placement.id === selected.id && body.y !== undefined
            ? round(body.y)
            : placement.y,
        z:
          placement.id === selected.id && body.z !== undefined
            ? round(body.z)
            : placement.z,
        lengthM: placement.id === selected.id ? lengthM : placement.lengthM,
        widthM: placement.id === selected.id ? widthM : placement.widthM,
        heightM: placement.heightM,
        grossWeightKg: placement.grossWeightKg,
        layer: placement.layer,
        seq: placement.seq,
      }));

      const packageTypes = await prisma.packageType.findMany({
        where: { tenantId: request.tenantId },
      });
      const validation = validatePalletPlan(
        {
          base: {
            code: plan.code,
            packageTypeCode: plan.baseType.code,
            lengthM: plan.baseLengthM,
            widthM: plan.baseWidthM,
            deckHeightM: plan.deckHeightM,
            maxHeightM: plan.maxHeightM,
            maxWeightKg: plan.maxWeightKg,
          },
          placements,
        },
        packageTypes.map(toDomainType),
      );
      const edited = placements.find(
        (placement) => placement.huCode === selected.hu.code,
      )!;

      await prisma.$transaction([
        prisma.palletPlacement.update({
          where: { id: selected.id },
          data: {
            x: edited.x,
            y: edited.y,
            z: edited.z,
            lengthM: edited.lengthM,
            widthM: edited.widthM,
            locked: body.locked ?? selected.locked,
          },
        }),
        prisma.palletPlan.update({
          where: { id: plan.id },
          data: {
            state: validation.valid ? "VALIDATED" : "REJECTED",
            validatedAt: new Date(),
            violations: json(validation.violations),
            usedHeightM: validation.usedHeightM,
            usedWeightKg: validation.usedWeightKg,
            volumeUtilizationPct: validation.volumeUtilizationPct,
            footprintUtilizationPct: validation.footprintUtilizationPct,
            cogX: validation.centerOfGravity.x,
            cogY: validation.centerOfGravity.y,
            cogZ: validation.centerOfGravity.z,
          },
        }),
      ]);

      return {
        planId: plan.id,
        state: validation.valid ? "validated" : "rejected",
        violations: validation.violations,
        metrics: {
          usedHeightM: validation.usedHeightM,
          usedWeightKg: validation.usedWeightKg,
          volumeUtilizationPct: validation.volumeUtilizationPct,
          footprintUtilizationPct: validation.footprintUtilizationPct,
          centerOfGravity: validation.centerOfGravity,
        },
        placement: {
          ...edited,
          locked: body.locked ?? selected.locked,
        },
      };
    },
  );
}
