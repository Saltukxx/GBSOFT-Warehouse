import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { TruckLoadPlanView } from "@gbsoft/domain";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { prisma } from "../db.js";

const TENANT_ID = "gbsoft-pilot";
const FACILITY_CODE = "MARMARA-DC-01";
const SHIPMENT_CODE = `SHP-LOAD-${Date.now()}`;

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
  const deadline = Date.now() + 45_000;
  let status = "queued";
  let runBody: Record<string, unknown> = {};
  while (Date.now() < deadline && (status === "queued" || status === "running")) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const run = await app.inject({
      method: "GET",
      url: `/api/optimization-runs/${runId}`,
    });
    runBody = run.json();
    status = runBody.status as string;
  }
  return { runId, status, runBody };
}

async function startLoad(vehicleTemplateCode = "SEMI-13M6", keepLocked = false) {
  const response = await app.inject({
    method: "POST",
    url: `/api/shipments/${SHIPMENT_CODE}/truck-load`,
    payload: { vehicleTemplateCode, keepLocked },
  });
  expect(response.statusCode).toBe(202);
  const runId = response.json().runId as string;
  runIds.push(runId);
  return awaitRun(runId);
}

async function loadPlans(): Promise<TruckLoadPlanView[]> {
  const response = await app.inject({
    method: "GET",
    url: `/api/shipments/${SHIPMENT_CODE}/load-plans`,
  });
  expect(response.statusCode).toBe(200);
  return response.json().plans as TruckLoadPlanView[];
}

beforeAll(async () => {
  if (!ready) return;
  app = await buildApp();
  await app.ready();

  const skus = await prisma.sku.findMany({
    where: { tenantId: TENANT_ID },
    orderBy: { code: "asc" },
    take: 6,
    select: { code: true },
  });
  const types = ["CASE-STD", "CASE-STD", "CASE-FRAGILE", "SACK", "CASE-STD", "DRUM-200L"];
  const response = await app.inject({
    method: "POST",
    url: "/api/shipments",
    payload: {
      facility: FACILITY_CODE,
      code: SHIPMENT_CODE,
      stops: [
        { code: "S1", name: "Birinci durak" },
        { code: "S2", name: "İkinci durak" },
        { code: "S3", name: "Son durak" },
      ],
      lines: skus.map((sku, index) => ({
        stopCode: `S${index % 3 + 1}`,
        skuCode: sku.code,
        packageTypeCode: types[index],
        quantity: 2,
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

describe.skipIf(!ready)("rota-duyarlı truck-load hattı", () => {
  it("kalıcı ve bağımsız doğrulanmış plan üretir", async () => {
    const { runId, status, runBody } = await startLoad();
    expect(status).toBe("feasible");

    const plans = await loadPlans();
    const plan = plans.find((item) => item.runId === runId)!;
    expect(plan).toBeDefined();
    expect(plan.state).toBe("validated");
    expect(plan.violations).toEqual([]);
    expect(plan.rehandlingRiskCount).toBe(0);
    expect(plan.placements).toHaveLength(12);
    expect(plan.axleLoads.length).toBeGreaterThanOrEqual(2);
    expect(runBody.hardViolations).toBe(0);
    expect(runBody.planId).toBe(plan.code);
  });

  it("son durağı derine ve önce, ilk durağı kapıya ve sonra koyar", async () => {
    const [plan] = await loadPlans();
    const first = plan.placements.filter((item) => item.stopSeq === 1);
    const last = plan.placements.filter((item) => item.stopSeq === 3);

    expect(Math.max(...last.map((item) => item.x))).toBeLessThan(
      Math.min(...first.map((item) => item.x)),
    );
    expect(Math.max(...last.map((item) => item.seq))).toBeLessThan(
      Math.min(...first.map((item) => item.seq)),
    );
  });

  it("yeniden çözümde eski planı silmeden yeni sürüm üretir", async () => {
    const before = await loadPlans();
    const { status } = await startLoad();
    expect(status).toBe("feasible");
    const after = await loadPlans();
    expect(after).toHaveLength(before.length + 1);
    expect(new Set(after.map((plan) => plan.runId)).size).toBe(after.length);
  });

  it("manuel değişikliği doğrular ve kilitli pozu warm-start'ta korur", async () => {
    const [current] = await loadPlans();
    const selected = current.placements[0];
    const invalid = await app.inject({
      method: "PATCH",
      url: `/api/load-plans/${current.id}/placements/${selected.unitCode}`,
      payload: { x: current.vehicle.internalLengthM },
    });
    expect(invalid.statusCode).toBe(200);
    expect(invalid.json().state).toBe("rejected");
    expect(
      invalid.json().violations.some((violation: { code: string }) => violation.code === "out-of-bounds"),
    ).toBe(true);

    const restored = await app.inject({
      method: "PATCH",
      url: `/api/load-plans/${current.id}/placements/${selected.unitCode}`,
      payload: { x: selected.x, locked: true },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().state).toBe("validated");

    const { runId, status } = await startLoad("SEMI-13M6", true);
    expect(status).toBe("feasible");
    const replanned = (await loadPlans()).find((plan) => plan.runId === runId)!;
    const preserved = replanned.placements.find(
      (placement) => placement.unitCode === selected.unitCode,
    )!;
    expect(preserved.locked).toBe(true);
    expect({ x: preserved.x, y: preserved.y, z: preserved.z }).toEqual({
      x: selected.x,
      y: selected.y,
      z: selected.z,
    });
  });

  it("shadow publish, barkod teyidi ve sapma replanını kalıcı yürütür", async () => {
    const [current] = await loadPlans();
    const instructions = await app.inject({
      method: "GET",
      url: `/api/load-plans/${current.id}/instructions`,
    });
    expect(instructions.statusCode).toBe(200);
    expect(instructions.json()).toMatchObject({
      planId: current.id,
      mode: "shadow",
      steps: expect.any(Array),
    });
    expect(instructions.json().steps).toHaveLength(12);

    const noKey = await app.inject({
      method: "POST",
      url: `/api/load-plans/${current.id}/publish`,
    });
    expect(noKey.statusCode).toBe(400);

    const publishKey = `load-exec-${Date.now()}`;
    const published = await app.inject({
      method: "POST",
      url: `/api/load-plans/${current.id}/publish`,
      headers: { "idempotency-key": publishKey },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({
      mode: "shadow",
      idempotent: false,
      execution: { state: "shadow-published", loadedCount: 0, totalCount: 12 },
    });
    const repeatedPublish = await app.inject({
      method: "POST",
      url: `/api/load-plans/${current.id}/publish`,
      headers: { "idempotency-key": publishKey },
    });
    expect(repeatedPublish.json().idempotent).toBe(true);

    const [first, damaged] = current.placements;
    const firstPosition = { x: first.x, y: first.y, z: first.z };
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/load-plans/${current.id}/scan-events`,
      headers: { "idempotency-key": "scan-confirmed-0001" },
      payload: { scannedCode: first.unitCode, outcome: "confirmed" },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().execution).toMatchObject({
      state: "loading",
      loadedCount: 1,
      currentSeq: first.seq,
    });
    const repeatedScan = await app.inject({
      method: "POST",
      url: `/api/load-plans/${current.id}/scan-events`,
      headers: { "idempotency-key": "scan-confirmed-0001" },
      payload: { scannedCode: first.unitCode, outcome: "confirmed" },
    });
    expect(repeatedScan.json().idempotent).toBe(true);

    const deviation = await app.inject({
      method: "POST",
      url: `/api/load-plans/${current.id}/scan-events`,
      headers: { "idempotency-key": "scan-damaged-000002" },
      payload: { scannedCode: damaged.unitCode, outcome: "damaged" },
    });
    expect(deviation.statusCode).toBe(200);
    expect(deviation.json().execution).toMatchObject({
      state: "deviated",
      loadedCount: 1,
      deviationCount: 1,
    });

    const editPublished = await app.inject({
      method: "PATCH",
      url: `/api/load-plans/${current.id}/placements/${first.unitCode}`,
      payload: { locked: false },
    });
    expect(editPublished.statusCode).toBe(409);

    const replan = await app.inject({
      method: "POST",
      url: `/api/load-plans/${current.id}/reoptimize`,
    });
    expect(replan.statusCode).toBe(202);
    expect(replan.json()).toMatchObject({
      mode: "deviation-replan",
      fixedUnitCount: 1,
      excludedUnitCount: 1,
    });
    const replanRunId = replan.json().runId as string;
    runIds.push(replanRunId);
    const replannedRun = await awaitRun(replanRunId);
    expect(replannedRun.status).toBe("feasible");

    const replanned = (await loadPlans()).find((plan) => plan.runId === replanRunId)!;
    expect(replanned.placements).toHaveLength(11);
    expect(replanned.placements.some((placement) => placement.unitCode === damaged.unitCode)).toBe(false);
    const preserved = replanned.placements.find((placement) => placement.unitCode === first.unitCode)!;
    expect(preserved.locked).toBe(true);
    expect({ x: preserved.x, y: preserved.y, z: preserved.z }).toEqual(firstPosition);

    const execution = await app.inject({
      method: "GET",
      url: `/api/load-plans/${current.id}/execution`,
    });
    expect(execution.json().execution.replacementPlanId).toBe(replanned.id);
  });

  it("bilinmeyen araç ve başka kiracı erişimini reddeder", async () => {
    const unknown = await app.inject({
      method: "POST",
      url: `/api/shipments/${SHIPMENT_CODE}/truck-load`,
      payload: { vehicleTemplateCode: "UNKNOWN" },
    });
    expect(unknown.statusCode).toBe(400);

    const otherTenant = await app.inject({
      method: "GET",
      url: `/api/shipments/${SHIPMENT_CODE}/load-plans`,
      headers: { "x-tenant-id": "another-tenant" },
    });
    expect(otherTenant.statusCode).toBe(404);
  });
});
