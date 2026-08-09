import type { Prisma } from "@prisma/client";
import type {
  Equipment,
  PickTimeModelParameters,
  PickTourPlan,
} from "@gbsoft/domain";
import {
  DEFAULT_PICK_TIME_PARAMETERS,
  DEFAULT_PICK_TOUR_PARAMETERS,
  pickStopSec,
  shortestPathDistances,
} from "@gbsoft/domain";
import { prisma } from "../db.js";
import { loadStoredGraph } from "../twin/graph.js";
import { solvePickTour, type PickTourSolveRequest } from "./client.js";

/**
 * Toplama turu çalıştırması (Faz 6.5).
 *
 * Solver'a giden her sayı buradan geçer ve **alan modelinden** gelir:
 * duraklar arası mesafe kalıcı yürüyüş grafından, durak süresi kalibre
 * `PickTimeModel`'den. Solver kendi süre modelini kurmaz; optimize ettiği
 * sayı ile arayüzün gösterdiği sayı aynıdır.
 */

const json = (value: unknown) => value as Prisma.InputJsonValue;

export type PickTourRunRequest = {
  orderId: string;
  equipment?: Equipment;
  vehicleCount?: number;
  capacityVolumeM3?: number;
  capacityWeightKg?: number;
  objective?: "makespan" | "total";
  timeLimitMs?: number;
};

export type PreparedTourRun = {
  runId: string;
  skippedLines: PickTourPlan["skippedLines"];
};

/**
 * Çalıştırmayı hazırlar: siparişi okur, grafı çözer, girdi snapshot'ını yazar.
 *
 * Aktif yerleşimi olmayan satır sessizce atılmaz — `skippedLines` içinde
 * gerekçesiyle döner ve run kaydında saklanır.
 */
export async function preparePickTourRun(
  tenantId: string,
  request: PickTourRunRequest,
): Promise<PreparedTourRun> {
  const order = await prisma.pickOrder.findFirst({
    where: { tenantId, OR: [{ id: request.orderId }, { code: request.orderId }] },
    include: {
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          sku: {
            include: {
              dimension: true,
              placements: {
                where: { effectiveTo: null },
                orderBy: { effectiveFrom: "desc" },
                take: 1,
                include: {
                  location: {
                    select: {
                      code: true,
                      goldenZone: true,
                      congestionScore: true,
                      blocked: true,
                      blockedReason: true,
                      layoutVersionId: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order) throw new Error(`Yükleme siparişi bulunamadı: ${request.orderId}`);
  if (order.lines.length === 0) {
    throw new Error("Siparişte satır yok; tur üretilemez.");
  }

  const layout = await prisma.layoutVersion.findFirst({
    where: { tenantId, facilityId: order.facilityId, isActive: true },
    orderBy: { version: "desc" },
    select: { id: true, version: true },
  });
  if (!layout) throw new Error("Aktif dijital ikiz sürümü yok.");

  const pickTimeModel = await prisma.pickTimeModel.findFirst({
    where: { tenantId, facilityId: order.facilityId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  const parameters: PickTimeModelParameters = {
    ...DEFAULT_PICK_TIME_PARAMETERS,
    ...((pickTimeModel?.parameters ?? {}) as Partial<PickTimeModelParameters>),
  };

  // --- Duraklar ---------------------------------------------------------
  const skipped: PickTourPlan["skippedLines"] = [];
  const stops: PickTourSolveRequest["stops"] = [];
  const stopCodes: string[] = [];

  for (const line of order.lines) {
    const placement = line.sku.placements[0]?.location;
    if (!placement || placement.layoutVersionId !== layout.id) {
      skipped.push({
        lineNo: line.lineNo,
        skuCode: line.sku.code,
        reason: "SKU'nun aktif ikizde pick gözü yok; satır tura alınamadı.",
      });
      continue;
    }
    if (placement.blocked) {
      skipped.push({
        lineNo: line.lineNo,
        skuCode: line.sku.code,
        reason: `${placement.code} bloklu: ${placement.blockedReason ?? "neden kayıtlı değil"}.`,
      });
      continue;
    }
    // Aynı göze düşen satırlar tek durakta birleşir; toplayıcı oraya iki kez
    // gitmez. Miktarlar toplanır.
    const existing = stops.find((stop) => stop.id === placement.code);
    const dimension = line.sku.dimension;
    const unitVolumeM3 =
      dimension?.widthCm && dimension.depthCm && dimension.heightCm
        ? (dimension.widthCm * dimension.depthCm * dimension.heightCm) / 1_000_000
        : 0.001;
    const unitWeightKg = dimension?.weightKg ?? 0.1;

    if (existing) {
      existing.quantity += line.quantity;
      existing.volume_m3 += unitVolumeM3 * line.quantity;
      existing.weight_kg += unitWeightKg * line.quantity;
      existing.pick_sec = pickStopSec(
        { quantity: existing.quantity, goldenZone: placement.goldenZone },
        parameters,
      );
      continue;
    }

    stops.push({
      id: placement.code,
      sku_id: line.sku.code,
      quantity: line.quantity,
      volume_m3: unitVolumeM3 * line.quantity,
      weight_kg: unitWeightKg * line.quantity,
      pick_sec: pickStopSec(
        { quantity: line.quantity, goldenZone: placement.goldenZone },
        parameters,
      ),
      congestion_score: placement.congestionScore,
    });
    stopCodes.push(placement.code);
  }

  if (stops.length === 0) {
    throw new Error(
      "Siparişteki hiçbir satırın aktif pick gözü yok; tur üretilemez.",
    );
  }

  // --- Graf mesafe matrisi ---------------------------------------------
  const graph = await prisma.$transaction((tx) =>
    loadStoredGraph(tx, tenantId, layout.id),
  );
  const nodeByLocation = new Map(
    graph.nodes
      .filter((node) => node.locationCode)
      .map((node) => [node.locationCode!, node.code]),
  );

  const matrixNodes = [graph.dockNodeCode, ...stopCodes.map((code) => {
    const node = nodeByLocation.get(code);
    if (!node) throw new Error(`Göz grafta bulunamadı: ${code}`);
    return node;
  })];

  const distance_m = matrixNodes.map((source) => {
    const distances = shortestPathDistances(graph, source);
    return matrixNodes.map((target) => {
      const value = distances.get(target);
      if (value === undefined) {
        // Ulaşılamayan göz solver'a sonsuz maliyetle girmemeli; bu noktada
        // graf bağlantısız demektir ve bunu sessizce geçemeyiz.
        throw new Error(
          `Grafta ulaşılamayan göz var: ${source} → ${target}. İkiz bağlantısız.`,
        );
      }
      return Math.round(value * 1_000) / 1_000;
    });
  });

  const equipment = request.equipment ?? "cart";
  const tourParameters = DEFAULT_PICK_TOUR_PARAMETERS;
  const input: PickTourSolveRequest = {
    run_id: "pending",
    seed: 42,
    time_limit_ms: request.timeLimitMs ?? 10_000,
    solution_limit: 80,
    equipment,
    vehicle_count: request.vehicleCount ?? 2,
    capacity_volume_m3: request.capacityVolumeM3 ?? 1.2,
    capacity_weight_kg: request.capacityWeightKg ?? 180,
    speed_mps: tourParameters.equipmentSpeedMps[equipment],
    objective: request.objective ?? "makespan",
    // Kuyruk süresi tur başına bir kez yaşanır; alan modelindeki `setupSec`
    // tanımının aynısı.
    setup_sec: tourParameters.tourSetupSec + parameters.queueSec,
    deposit_sec: tourParameters.depositSec,
    deposit_per_unit_sec: tourParameters.depositPerUnitSec,
    congestion_factor: parameters.congestionFactor,
    distance_m,
    stops,
  };

  const run = await prisma.optimizationRun.create({
    data: {
      tenantId,
      facilityId: order.facilityId,
      kind: "PICK_TOUR",
      status: "QUEUED",
      solverVersion: "pick-tour-routing-1.0.0",
      modelVersion: pickTimeModel?.version ?? "pick-time-analytic-baseline-v1",
      objectiveProfileKey: input.objective,
      parameters: json({
        orderId: order.id,
        orderCode: order.code,
        equipment,
        vehicleCount: input.vehicle_count,
        capacityVolumeM3: input.capacity_volume_m3,
        capacityWeightKg: input.capacity_weight_kg,
        objective: input.objective,
      }),
      constraints: json({ skippedLines: skipped }),
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

  await prisma.pickOrder.update({
    where: { id: order.id },
    data: { snapshotAt: run.snapshotAt },
  });

  return { runId: run.id, skippedLines: skipped };
}

/** Çözer ve turları kalıcılaştırır. */
export async function executePickTourRun(runId: string): Promise<void> {
  try {
    const run = await prisma.optimizationRun.update({
      where: { id: runId },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    const input = run.inputSnapshot as unknown as PickTourSolveRequest;
    const parameters = run.parameters as { orderId: string; equipment: Equipment };
    const result = await solvePickTour(input);

    if (result.status !== "feasible") {
      await prisma.optimizationRun.update({
        where: { id: runId },
        data: {
          status: result.status === "timeout" ? "TIMEOUT" : "INFEASIBLE",
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

    await prisma.$transaction(async (tx) => {
      // Aynı sipariş için eski turlar temizlenir; her çalıştırma kendi
      // planını üretir ve `runId` ile hangi koşudan geldiği bellidir.
      await tx.pickTour.deleteMany({
        where: { tenantId: run.tenantId, orderId: parameters.orderId },
      });

      for (const tour of result.tours) {
        await tx.pickTour.create({
          data: {
            tenantId: run.tenantId,
            orderId: parameters.orderId,
            runId,
            seq: tour.seq,
            equipment: parameters.equipment,
            totalDistanceM: tour.distance_m,
            estimatedSec: tour.total_sec,
            volumeUsedM3: tour.volume_m3,
            weightUsedKg: tour.weight_kg,
            stops: {
              create: tour.stops.map((stop) => ({
                tenantId: run.tenantId,
                seq: stop.seq,
                locationCode: stop.location_id,
                skuCode: stop.sku_id,
                quantity: stop.quantity,
                travelSec: stop.travel_sec,
                congestionSec: stop.congestion_sec,
                pickSec: stop.pick_sec,
                cumulativeSec: stop.cumulative_sec,
              })),
            },
          },
        });
      }

      await tx.pickOrder.update({
        where: { id: parameters.orderId },
        data: { status: "PLANNED" },
      });

      await tx.optimizationRun.update({
        where: { id: runId },
        data: {
          status: "FEASIBLE",
          solverVersion: result.solver_version,
          solutionQuality: result.solution_quality,
          finishedAt: new Date(),
          solveDurationMs: result.solve_duration_ms,
          objectiveValue: result.makespan_sec,
          resultSnapshot: json(result),
        },
      });
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
