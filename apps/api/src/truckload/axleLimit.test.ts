import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { TruckLoadPlanView, VehicleTemplate } from "@gbsoft/domain";
import { DEFAULT_PACKAGE_TYPES } from "@gbsoft/domain";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { prisma } from "../db.js";

/**
 * Dolu römork: dingil zincirinin planı gerçekten değiştirdiği senaryo.
 *
 * `truckload.test.ts` karışık koli sevkiyatını kullanır — 12 birim, römorkun
 * yüzde ikisi. O sevkiyatta dingil, ağırlık merkezi ve kapı açıklığı
 * kısıtlarının hiçbiri bağlayıcı olmaz. Buradaki sevkiyat 27 palet birim
 * yüküyle römorku ağırlık tarafından doldurur; kingpin kuvveti çekiciye
 * aktarılınca tahrik dingili sınırı bağlayıcı olur.
 */

const TENANT_ID = "gbsoft-pilot";
const FACILITY_CODE = "MARMARA-DC-01";
const SHIPMENT_CODE = `SHP-AXLE-${Date.now()}`;
const VEHICLE_CODE = "SEMI-13M6";

/** Palet başına hedef brüt ağırlık (kg). */
const TARGET_PALLET_KG = 640;
/** 1,2 m boyuna × 3 sıra × 9 = 10,8 m; 13,6 m'lik römorkta 2,8 m oyun kalır. */
const PALLETS_PER_STOP = [8, 9, 10] as const;
const TOTAL_PALLETS = PALLETS_PER_STOP.reduce((sum, count) => sum + count, 0);

let app: FastifyInstance;
let shipmentId = "";
const runIds: string[] = [];

const databaseAvailable = await prisma.$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => false);
const solverAvailable = await fetch(`${config.OPTIMIZER_URL}/health`)
  .then((response) => response.json())
  .then((body: { truckLoadSolverVersion?: string }) => Boolean(body.truckLoadSolverVersion))
  .catch(() => false);
const ready = databaseAvailable && solverAvailable;

async function awaitRun(runId: string) {
  const deadline = Date.now() + 60_000;
  let status = "queued";
  while (Date.now() < deadline && (status === "queued" || status === "running")) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const run = await app.inject({
      method: "GET",
      url: `/api/optimization-runs/${runId}`,
    });
    status = run.json().status as string;
  }
  return status;
}

beforeAll(async () => {
  if (!ready) return;
  app = await buildApp();
  await app.ready();

  // Ağırlık sevkiyata elle yazılmaz: brüt ağırlık dara + koli adedi × SKU
  // ağırlığından hesaplanır, bu yüzden koli adedi SKU'nun kendi ölçüsünden
  // geri çözülür. Ölçüsüz SKU palet birim yüküne giremez.
  const skus = await prisma.sku.findMany({
    where: { tenantId: TENANT_ID, dimension: { weightKg: { gt: 0 } } },
    orderBy: { code: "asc" },
    take: PALLETS_PER_STOP.length,
    select: { code: true, dimension: { select: { weightKg: true } } },
  });
  expect(skus).toHaveLength(PALLETS_PER_STOP.length);

  const tareKg = DEFAULT_PACKAGE_TYPES.find(
    (type) => type.code === "PALLET-EUR-LOADED",
  )!.tareKg;

  const response = await app.inject({
    method: "POST",
    url: "/api/shipments",
    payload: {
      facility: FACILITY_CODE,
      code: SHIPMENT_CODE,
      stops: [
        { code: "A1", name: "Birinci durak" },
        { code: "A2", name: "İkinci durak" },
        { code: "A3", name: "Son durak" },
      ],
      lines: skus.map((sku, index) => ({
        stopCode: `A${index + 1}`,
        skuCode: sku.code,
        packageTypeCode: "PALLET-EUR-LOADED",
        quantity: PALLETS_PER_STOP[index],
        unitsPerHandlingUnit: Math.max(
          1,
          Math.round((TARGET_PALLET_KG - tareKg) / sku.dimension!.weightKg!),
        ),
      })),
    },
  });
  expect(response.statusCode).toBe(201);
  shipmentId = response.json().id;
});

afterAll(async () => {
  if (!ready) return;
  if (shipmentId) {
    await prisma.loadPlan.deleteMany({ where: { shipmentId } });
    await prisma.shipment.delete({ where: { id: shipmentId } });
  }
  if (runIds.length > 0) {
    await prisma.optimizationRun.deleteMany({ where: { id: { in: runIds } } });
  }
  if (app) await app.close();
});

/**
 * Bir aks grubunun taşıdığı yük payı.
 *
 * İki destekli kiriş: yük ağırlık merkezi iki aks arasında nerede duruyorsa
 * pay ters oranda dağılır. Doğrulayıcının kendi hesabını tekrar etmiyoruz —
 * burada yalnız "öne yaslanmış yerleşim ihlal ederdi" iddiasını sınıyoruz.
 */
function kingpinPayloadKg(
  vehicle: VehicleTemplate,
  payloadKg: number,
  cogX: number,
): number {
  const kingpin = vehicle.axleGroups.find((axle) => axle.code === "KINGPIN")!;
  const tridem = vehicle.axleGroups.find((axle) => axle.code === "TRIDEM")!;
  const span = tridem.positionX - kingpin.positionX;
  return (payloadKg * (tridem.positionX - cogX)) / span;
}

describe.skipIf(!ready)("dolu römorkta dingil zinciri", () => {
  it("27 palet birim yükünü dingil ve CoG kısıtlarını sağlayarak yerleştirir", async () => {
    const started = await app.inject({
      method: "POST",
      url: `/api/shipments/${SHIPMENT_CODE}/truck-load`,
      payload: { vehicleTemplateCode: VEHICLE_CODE },
    });
    expect(started.statusCode).toBe(202);
    const runId = started.json().runId as string;
    runIds.push(runId);
    expect(await awaitRun(runId)).toBe("feasible");

    const plans = await app.inject({
      method: "GET",
      url: `/api/shipments/${SHIPMENT_CODE}/load-plans`,
    });
    const plan = (plans.json().plans as TruckLoadPlanView[]).find(
      (item) => item.runId === runId,
    )!;

    expect(plan.state).toBe("validated");
    expect(plan.violations).toEqual([]);
    expect(plan.placements).toHaveLength(TOTAL_PALLETS);

    // Ağırlık taşıma kapasitesinin içinde ama hacim yarıdan az: palet birim
    // yükü çift istiflenmediği için römorku ağırlık sınırlar, hacim değil.
    expect(plan.payloadKg).toBeGreaterThan(15_000);
    expect(plan.payloadKg).toBeLessThan(plan.vehicle.maxPayloadKg);
    expect(plan.volumeUtilizationPct).toBeLessThan(60);

    // Çekici dingilleri de raporda olmalı; kaplin yere basmaz ama listelenir.
    expect(plan.axleLoads.some((axle) => axle.kind === "tractor-axle")).toBe(true);
    expect(plan.axleLoads.some((axle) => axle.kind === "coupling")).toBe(true);
    expect(plan.weightDistribution.driveAxleSharePct).not.toBeNull();
    expect(plan.weightDistribution.driveAxleSharePct!).toBeGreaterThanOrEqual(25);

    for (const axle of plan.axleLoads) {
      expect(axle.totalLoadKg).toBeLessThanOrEqual(axle.maxLoadKg);
    }

    const envelope = plan.vehicle.cogEnvelope;
    expect(plan.centerOfGravity.x).toBeGreaterThanOrEqual(envelope.minX);
    expect(plan.centerOfGravity.x).toBeLessThanOrEqual(envelope.maxX);
    expect(plan.centerOfGravity.z).toBeLessThanOrEqual(envelope.maxZ);
  });

  it("tahrik dingili bağlayıcıdır: yükü öne yaslamak çekiciyi aşardı", async () => {
    const plans = await app.inject({
      method: "GET",
      url: `/api/shipments/${SHIPMENT_CODE}/load-plans`,
    });
    const [plan] = plans.json().plans as TruckLoadPlanView[];
    const kingpin = plan.vehicle.axleGroups.find((axle) => axle.code === "KINGPIN")!;
    const available = kingpin.maxLoadKg - kingpin.emptyLoadKg;

    // Üretilen plan kaplin kapasitesinin altında kalıyor…
    expect(kingpinPayloadKg(plan.vehicle, plan.payloadKg, plan.centerOfGravity.x))
      .toBeLessThanOrEqual(available);

    // …ama aynı yük öne yaslansaydı hem kaplin hem tahrik dingili aşardı.
    // Tek kademeli model yalnız kaplini görürdü; iki kademeli zincir asıl
    // bağlayıcı olan tahrik sınırını da yakalar.
    const blockLengthM = Math.ceil(TOTAL_PALLETS / 3) * 1.2;
    const frontFlushCogX = blockLengthM / 2;
    expect(kingpinPayloadKg(plan.vehicle, plan.payloadKg, frontFlushCogX))
      .toBeGreaterThan(available);

    // Çözücü yükü gerçekten arkaya kaydırmış olmalı.
    expect(plan.centerOfGravity.x).toBeGreaterThan(frontFlushCogX);
    expect(plan.weightDistribution.driveAxleSharePct!).toBeGreaterThanOrEqual(25);
  });
});
