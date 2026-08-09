import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";

const TENANT_ID = "gbsoft-pilot";
const TEST_CODE = `SP-F5-TEST-${Date.now()}`;
let app: FastifyInstance;
let planId = "";
let baseCode = "";

const databaseAvailable = await prisma.$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => false);

beforeAll(async () => {
  if (!databaseAvailable) return;
  const base = await prisma.slotPlan.findFirst({
    where: { tenantId: TENANT_ID },
    orderBy: { createdAt: "asc" },
  });
  if (!base) throw new Error("Faz 5 testi için seed slot planı bulunamadı.");
  baseCode = base.code;
  const plan = await prisma.slotPlan.create({
    data: {
      tenantId: TENANT_ID,
      facilityId: base.facilityId,
      layoutVersionId: base.layoutVersionId,
      code: TEST_CODE,
      basePlanId: base.id,
      objectiveProfileId: base.objectiveProfileId,
      state: "READY",
      snapshotAt: new Date(),
      solverVersion: "slot-cp-test",
      modelVersion: "pick-time-test",
      netOperationDeltaPct: -1,
      pickingTimeDeltaPct: -1,
      walkingDeltaPct: -1,
      replenishmentDeltaPct: 0,
      moveTaskCount: 2,
      moveHours: 0.2,
      affectedSkuCount: 2,
      hardViolationCount: 0,
      createdByLabel: "Faz 5 testi",
      moveTasks: {
        create: [1, 2].map((seq) => ({
          tenantId: TENANT_ID,
          seq,
          code: `${TEST_CODE}-M00${seq}`,
          kind: "MOVE",
          label: `Test görevi ${seq}`,
          sourceLocationCode: `SRC-${seq}`,
          targetLocationCode: `DST-${seq}`,
          zoneCode: "A",
          loadLabel: "1 birim",
          loadHours: 0.1,
          packageKey: "PKG-TEST-A",
          packageLabel: "Test paketi",
          expectedBenefitPct: -0.5,
          status: "READY",
        })),
      },
    },
  });
  planId = plan.id;
  app = await buildApp();
}, 30_000);

afterAll(async () => {
  if (databaseAvailable && planId) {
    await prisma.auditLog.deleteMany({ where: { entityId: planId } });
    await prisma.slotPlan.deleteMany({ where: { id: planId } });
  }
  await app?.close();
  await prisma.$disconnect();
});

describe.skipIf(!databaseAvailable)("Faz 5 plan yayınlama ve rollback", () => {
  it("paketi böldürmez, tekrarı idempotent işler ve rollback lineage'ını korur", async () => {
    const headers = {
      "x-tenant-id": TENANT_ID,
      "content-type": "application/json",
      "idempotency-key": "faz5-test-idempotency",
    };
    const partial = await app.inject({
      method: "POST",
      url: `/api/slot-plans/${TEST_CODE}/publish`,
      headers,
      payload: { taskIds: [`${TEST_CODE}-M001`] },
    });
    expect(partial.statusCode).toBe(409);

    const payload = { taskIds: [`${TEST_CODE}-M001`, `${TEST_CODE}-M002`] };
    const first = await app.inject({ method: "POST", url: `/api/slot-plans/${TEST_CODE}/publish`, headers, payload });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ published: 2, idempotent: false });

    const repeated = await app.inject({ method: "POST", url: `/api/slot-plans/${TEST_CODE}/publish`, headers, payload });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toMatchObject({ published: 2, idempotent: true });

    const rollback = await app.inject({
      method: "POST",
      url: `/api/slot-plans/${TEST_CODE}/rollback`,
      headers: { "x-tenant-id": TENANT_ID, "content-type": "application/json" },
      payload: { targetPlanId: baseCode },
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json()).toMatchObject({ publishedTasksUnaffected: true });
    expect(await prisma.moveTask.count({ where: { planId, status: "PUBLISHED" } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { entityId: planId } })).toBe(2);
  });
});
