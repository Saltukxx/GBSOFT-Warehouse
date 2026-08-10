import type { Prisma } from "@prisma/client";
import {
  validateTruckLoadPlan,
  type TruckLoadPosition,
  type TruckLoadUnit,
} from "@gbsoft/domain";
import { prisma } from "../db.js";
import { ensureHandlingUnits, fillGrossWeights } from "../pallet/runner.js";
import {
  solveTruckLoad,
  type TruckLoadSolveRequest,
} from "./client.js";
import { toVehicleTemplate } from "./vehicle.js";

const json = (value: unknown) => value as Prisma.InputJsonValue;

export type TruckLoadRunRequest = {
  shipmentId: string;
  vehicleTemplateCode: string;
  timeLimitMs?: number;
  keepLocked?: boolean;
  sourcePlanId?: string;
  sourceExecutionId?: string;
  fixedUnitCodes?: string[];
  excludedUnitCodes?: string[];
};

export type PreparedTruckLoadRun = {
  runId: string;
  handlingUnitCount: number;
  vehicleTemplateCode: string;
};

function solverVehicle(vehicle: ReturnType<typeof toVehicleTemplate>) {
  return {
    code: vehicle.code,
    internal_length_m: vehicle.internalLengthM,
    internal_width_m: vehicle.internalWidthM,
    internal_height_m: vehicle.internalHeightM,
    rear_door: {
      width_m: vehicle.rearDoor.widthM,
      height_m: vehicle.rearDoor.heightM,
      sill_height_m: vehicle.rearDoor.sillHeightM,
    },
    max_payload_kg: vehicle.maxPayloadKg,
    axle_groups: vehicle.axleGroups.map((axle) => ({
      code: axle.code,
      label: axle.label,
      position_x: axle.positionX,
      empty_load_kg: axle.emptyLoadKg,
      max_load_kg: axle.maxLoadKg,
      coupling: axle.coupling ?? false,
    })),
    ...(vehicle.tractor
      ? {
          tractor: {
            code: vehicle.tractor.code,
            label: vehicle.tractor.label,
            tare_kg: vehicle.tractor.tareKg,
            axles: vehicle.tractor.axles.map((axle) => ({
              code: axle.code,
              label: axle.label,
              position_x: axle.positionX,
              tare_load_kg: axle.tareLoadKg,
              max_load_kg: axle.maxLoadKg,
              driven: axle.driven,
              steering: axle.steering,
            })),
          },
        }
      : {}),
    ...(vehicle.regulation
      ? {
          regulation: {
            max_combination_weight_kg: vehicle.regulation.maxCombinationWeightKg,
            min_drive_axle_share: vehicle.regulation.minDriveAxleShare,
            min_steer_axle_share: vehicle.regulation.minSteerAxleShare,
          },
        }
      : {}),
    obstacles: vehicle.obstacles.map((obstacle) => ({
      code: obstacle.code,
      label: obstacle.label,
      x: obstacle.x,
      y: obstacle.y,
      z: obstacle.z,
      length_m: obstacle.lengthM,
      width_m: obstacle.widthM,
      height_m: obstacle.heightM,
    })),
    cog_envelope: {
      min_x: vehicle.cogEnvelope.minX,
      max_x: vehicle.cogEnvelope.maxX,
      min_y: vehicle.cogEnvelope.minY,
      max_y: vehicle.cogEnvelope.maxY,
      max_z: vehicle.cogEnvelope.maxZ,
    },
  };
}

export async function prepareTruckLoadRun(
  tenantId: string,
  request: TruckLoadRunRequest,
): Promise<PreparedTruckLoadRun> {
  const shipment = await prisma.shipment.findFirst({
    where: {
      tenantId,
      OR: [{ id: request.shipmentId }, { code: request.shipmentId }],
    },
    include: { lines: { select: { id: true } } },
  });
  if (!shipment) throw new Error(`Sevkiyat bulunamadı: ${request.shipmentId}`);
  if (shipment.lines.length === 0) throw new Error("Sevkiyatta yüklenecek satır yok.");

  const vehicleRow = await prisma.vehicleTemplate.findUnique({
    where: {
      tenantId_code: { tenantId, code: request.vehicleTemplateCode },
    },
  });
  if (!vehicleRow) throw new Error(`Araç şablonu bulunamadı: ${request.vehicleTemplateCode}`);
  const vehicle = toVehicleTemplate(vehicleRow);

  await ensureHandlingUnits(tenantId, shipment.id);
  await fillGrossWeights(tenantId, shipment.id);
  const allUnits = await prisma.handlingUnit.findMany({
    where: { tenantId, shipmentId: shipment.id },
    orderBy: { code: "asc" },
    include: { packageType: true, stop: true },
  });
  const excludedCodes = new Set(request.excludedUnitCodes ?? []);
  const fixedCodes = new Set(request.fixedUnitCodes ?? []);
  const knownCodes = new Set(allUnits.map((unit) => unit.code));
  const unknownExecutionCodes = [...excludedCodes, ...fixedCodes].filter(
    (code) => !knownCodes.has(code),
  );
  if (unknownExecutionCodes.length > 0) {
    throw new Error(
      `Sevkiyatta bulunmayan execution birimleri: ${[...new Set(unknownExecutionCodes)].join(", ")}`,
    );
  }
  const units = allUnits.filter((unit) => !excludedCodes.has(unit.code));
  if (units.length === 0) throw new Error("Yeniden planlanacak elleçleme birimi kalmadı.");
  const handlingUnitCount = units.length;
  const missingStop = units.filter((unit) => !unit.stop);
  if (missingStop.length > 0) {
    throw new Error(
      `Durak bilgisi eksik elleçleme birimleri: ${missingStop.slice(0, 10).map((unit) => unit.code).join(", ")}`,
    );
  }
  const latestPlan = request.keepLocked || request.sourcePlanId
    ? await prisma.loadPlan.findFirst({
        where: {
          tenantId,
          shipmentId: shipment.id,
          ...(request.sourcePlanId
            ? { OR: [{ id: request.sourcePlanId }, { code: request.sourcePlanId }] }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
          placements: {
            include: { hu: { select: { code: true } } },
          },
        },
      })
    : null;
  if (request.sourcePlanId && !latestPlan) {
    throw new Error("Sapmanın kaynak araç planı bulunamadı.");
  }
  const fixedPlacements = (latestPlan?.placements ?? []).filter(
    (placement) =>
      !excludedCodes.has(placement.hu.code) &&
      (placement.locked || fixedCodes.has(placement.hu.code)),
  );

  const input: TruckLoadSolveRequest = {
    run_id: "pending",
    seed: 42,
    time_limit_ms: request.timeLimitMs ?? 10_000,
    vehicle: solverVehicle(vehicle),
    units: units.map((unit) => ({
      hu_code: unit.code,
      length_m: unit.packageType.lengthM,
      width_m: unit.packageType.widthM,
      height_m: unit.packageType.heightM,
      gross_weight_kg: Math.max(0.001, unit.grossWeightKg),
      stop_code: unit.stop!.code,
      stop_seq: unit.stop!.seq,
      rotation: unit.packageType.rotation === "fixed" ? "fixed" : "yaw",
      // Faz 8.2 güvenli taban yerleşimidir. İstif desteği ayrı rule pack
      // olmadan varsayılmaz.
      floor_only: true,
    })),
    fixed_placements: fixedPlacements.map((placement) => ({
      hu_code: placement.hu.code,
      x: placement.x,
      y: placement.y,
      z: placement.z,
      length_m: placement.lengthM,
      width_m: placement.widthM,
      height_m: placement.heightM,
    })),
  };

  const run = await prisma.optimizationRun.create({
    data: {
      tenantId,
      facilityId: shipment.facilityId,
      kind: "TRUCK_LOAD",
      status: "QUEUED",
      solverVersion: "truck-load-route-band-1.0.0",
      modelVersion: vehicle.rulesVersion,
      objectiveProfileKey: "route-access-balanced",
      parameters: json({
        shipmentId: shipment.id,
        shipmentCode: shipment.code,
        vehicleTemplateId: vehicleRow.id,
        vehicleTemplateCode: vehicle.code,
        geometrySource: vehicle.geometrySource,
        includedUnitCodes: units.map((unit) => unit.code),
        excludedUnitCodes: [...excludedCodes],
        sourceExecutionId: request.sourceExecutionId ?? null,
      }),
      constraints: json({
        handlingUnitCount,
        routeFixed: true,
        stackingEnabled: false,
        fixedPlacementCount: input.fixed_placements.length,
        excludedUnitCount: excludedCodes.size,
      }),
      inputSnapshot: json(input),
      seed: input.seed,
      timeLimitMs: input.time_limit_ms,
      snapshotAt: new Date(),
    },
  });
  input.run_id = run.id;
  await prisma.$transaction([
    prisma.optimizationRun.update({
      where: { id: run.id },
      data: { inputSnapshot: json(input) },
    }),
    prisma.shipment.update({
      where: { id: shipment.id },
      data: { snapshotAt: run.snapshotAt },
    }),
  ]);
  return { runId: run.id, handlingUnitCount, vehicleTemplateCode: vehicle.code };
}

export async function executeTruckLoadRun(runId: string): Promise<void> {
  try {
    const run = await prisma.optimizationRun.update({
      where: { id: runId },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    const input = run.inputSnapshot as unknown as TruckLoadSolveRequest;
    const parameters = run.parameters as {
      shipmentId: string;
      shipmentCode: string;
      vehicleTemplateId: string;
      vehicleTemplateCode: string;
      includedUnitCodes?: string[];
      sourceExecutionId?: string | null;
    };
    const result = await solveTruckLoad(input);
    const lockedCodes = new Set(input.fixed_placements.map((placement) => placement.hu_code));
    if (result.status !== "feasible") {
      await prisma.optimizationRun.update({
        where: { id: runId },
        data: {
          status: "INFEASIBLE",
          solverVersion: result.solver_version,
          solutionQuality: result.solution_quality,
          finishedAt: new Date(),
          solveDurationMs: result.solve_duration_ms,
          infeasibilityReasons: json(result.infeasibility_reasons),
          relaxationOptions: json(result.relaxation_options),
          resultSnapshot: json(result),
        },
      });
      return;
    }

    const [vehicleRow, unitRows] = await Promise.all([
      prisma.vehicleTemplate.findFirst({
        where: { id: parameters.vehicleTemplateId, tenantId: run.tenantId },
      }),
      prisma.handlingUnit.findMany({
        where: {
          tenantId: run.tenantId,
          shipmentId: parameters.shipmentId,
          ...(parameters.includedUnitCodes
            ? { code: { in: parameters.includedUnitCodes } }
            : {}),
        },
        include: { packageType: true, stop: true, sku: { select: { code: true } } },
      }),
    ]);
    if (!vehicleRow) throw new Error("Araç şablonu koşu sırasında kayboldu.");
    const vehicle = toVehicleTemplate(vehicleRow);
    const rowByCode = new Map(unitRows.map((unit) => [unit.code, unit]));
    const units: TruckLoadUnit[] = unitRows.map((unit) => ({
      code: unit.code,
      lengthM: unit.packageType.lengthM,
      widthM: unit.packageType.widthM,
      heightM: unit.packageType.heightM,
      grossWeightKg: Math.max(0.001, unit.grossWeightKg),
      stopCode: unit.stop?.code ?? "",
      stopSeq: unit.stop?.seq ?? 0,
      rotation: unit.packageType.rotation === "fixed" ? "fixed" : "yaw",
      floorOnly: true,
    }));
    const positions: TruckLoadPosition[] = result.positions.map((position) => ({
      unitCode: position.hu_code,
      x: position.x,
      y: position.y,
      z: position.z,
      lengthM: position.length_m,
      widthM: position.width_m,
      heightM: position.height_m,
      seq: position.seq,
    }));
    const validation = validateTruckLoadPlan({ vehicle, units, positions });

    await prisma.$transaction(async (tx) => {
      const createdPlan = await tx.loadPlan.create({
        data: {
          tenantId: run.tenantId,
          shipmentId: parameters.shipmentId,
          vehicleTemplateId: parameters.vehicleTemplateId,
          runId,
          code: `${parameters.shipmentCode}-L-${runId.slice(-6).toUpperCase()}`,
          state: validation.valid ? "VALIDATED" : "REJECTED",
          payloadKg: validation.payloadKg,
          volumeUtilizationPct: validation.volumeUtilizationPct,
          cogX: validation.centerOfGravity.x,
          cogY: validation.centerOfGravity.y,
          cogZ: validation.centerOfGravity.z,
          axleLoads: json(validation.axleLoads),
          weightDistribution: json(validation.weightDistribution),
          rehandlingRiskCount: validation.rehandlingRiskCount,
          violations: json(validation.violations),
          validatedAt: new Date(),
          placements: {
            create: positions
              .filter((position) => rowByCode.has(position.unitCode))
              .map((position) => ({
                tenantId: run.tenantId,
                huId: rowByCode.get(position.unitCode)!.id,
                x: position.x,
                y: position.y,
                z: position.z,
                lengthM: position.lengthM,
                widthM: position.widthM,
                heightM: position.heightM,
                grossWeightKg: Math.max(0.001, rowByCode.get(position.unitCode)!.grossWeightKg),
                seq: position.seq,
                locked: lockedCodes.has(position.unitCode),
              })),
          },
        },
      });
      await tx.shipment.update({
        where: { id: parameters.shipmentId },
        data: { status: validation.valid ? "PLANNED" : "READY" },
      });
      await tx.optimizationRun.update({
        where: { id: runId },
        data: {
          status: "FEASIBLE",
          solverVersion: result.solver_version,
          solutionQuality: result.solution_quality,
          finishedAt: new Date(),
          solveDurationMs: result.solve_duration_ms,
          objectiveValue: validation.rehandlingRiskCount,
          hardViolations: validation.violations.length,
          resultSnapshot: json(result),
        },
      });
      if (parameters.sourceExecutionId) {
        await tx.loadExecution.updateMany({
          where: {
            id: parameters.sourceExecutionId,
            tenantId: run.tenantId,
          },
          data: { replacementPlanId: createdPlan.id },
        });
      }
    });
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
