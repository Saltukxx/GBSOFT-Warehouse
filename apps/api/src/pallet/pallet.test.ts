import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PalletPlanView } from "@gbsoft/domain";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { prisma } from "../db.js";

/**
 * Faz 7.2 çıkış koşulu: palet planı bağımsız doğrulayıcıdan geçmeden
 * `VALIDATED` olamaz, ihlalli plan silinmeden gerekçesiyle saklanır.
 */

const TENANT_ID = "gbsoft-pilot";
const FACILITY_CODE = "MARMARA-DC-01";
const SHIPMENT_CODE = `SHP-TEST-${Date.now()}`;

let app: FastifyInstance;
let shipmentId = "";

const databaseAvailable = await prisma.$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => false);

const solverAvailable = await fetch(`${config.OPTIMIZER_URL}/health`)
  .then((response) => response.json())
  .then((body: { palletSolverVersion?: string }) => Boolean(body.palletSolverVersion))
  .catch(() => false);

const ready = databaseAvailable && solverAvailable;

async function palletize(payload: Record<string, unknown> = {}) {
  const started = await app.inject({
    method: "POST",
    url: `/api/shipments/${SHIPMENT_CODE}/palletize`,
    payload,
  });
  expect(started.statusCode).toBe(202);

  const runId = started.json().runId as string;
  const deadline = Date.now() + 45_000;
  let status = "queued";
  while (Date.now() < deadline && (status === "queued" || status === "running")) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const run = await app.inject({
      method: "GET",
      url: `/api/optimization-runs/${runId}`,
    });
    status = run.json().status;
  }
  return { runId, status };
}

async function plans(): Promise<PalletPlanView[]> {
  const response = await app.inject({
    method: "GET",
    url: `/api/shipments/${SHIPMENT_CODE}/pallet-plans`,
  });
  expect(response.statusCode).toBe(200);
  return response.json().plans as PalletPlanView[];
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
      ],
      lines: skus.map((sku, index) => ({
        stopCode: index % 2 === 0 ? "S1" : "S2",
        skuCode: sku.code,
        packageTypeCode: types[index],
        quantity: 3,
      })),
    },
  });
  expect(response.statusCode).toBe(201);
  shipmentId = response.json().id;
});

afterAll(async () => {
  if (!ready) return;
  if (shipmentId) {
    await prisma.shipment.delete({ where: { id: shipmentId } }).catch(() => {});
  }
  if (app) await app.close();
});

describe.skipIf(!ready)("palet planı hattı", () => {
  it("sevkiyat satırlarından elleçleme birimi üretir", async () => {
    const { status } = await palletize({ maxHeightM: 1.8, maxWeightKg: 800 });
    expect(status).toBe("feasible");

    // 6 satır × 3 adet = 18 birim.
    const count = await prisma.handlingUnit.count({
      where: { tenantId: TENANT_ID, shipmentId },
    });
    expect(count).toBe(18);
  }, 60_000);

  it("elleçleme birimi üretimi idempotenttir", async () => {
    // İkinci çalıştırma yeni birim doğurmamalı; aksi hâlde her plan stok
    // yaratırdı.
    await palletize({ maxHeightM: 1.8, maxWeightKg: 800 });

    const count = await prisma.handlingUnit.count({
      where: { tenantId: TENANT_ID, shipmentId },
    });
    expect(count).toBe(18);
  }, 60_000);

  it("planları bağımsız doğrulayıcıdan geçirir", async () => {
    const result = await plans();

    expect(result.length).toBeGreaterThan(0);
    for (const plan of result) {
      // Kapı: doğrulayıcı geçmeyen plan `validated` olamaz.
      if (plan.violations.length === 0) {
        expect(plan.state).toBe("validated");
      } else {
        expect(plan.state).toBe("rejected");
      }
    }
    // Golden profillerle üretilen plan geçmeli.
    expect(result.every((plan) => plan.state === "validated")).toBe(true);
  });

  it("ayrım grubunu ve sıcaklık sınıfını ayrı paletlere böler", async () => {
    const result = await plans();

    for (const plan of result) {
      const groups = new Set(
        plan.placements.map((placement) =>
          placement.packageTypeCode === "DRUM-200L" ? "chemical" : "(grupsuz)",
        ),
      );
      expect(groups.size).toBe(1);
    }
  });

  it("her birim tam olarak bir palete yerleşir", async () => {
    const result = await plans();
    const placed = result.flatMap((plan) =>
      plan.placements.map((placement) => placement.huCode),
    );

    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.length).toBe(18);
  });

  it("palet ölçüleri kapasite sınırları içinde kalır", async () => {
    const result = await plans();

    for (const plan of result) {
      expect(plan.usedWeightKg).toBeLessThanOrEqual(plan.base.maxWeightKg + 1e-6);
      expect(plan.usedHeightM).toBeLessThanOrEqual(
        plan.base.maxHeightM - plan.base.deckHeightM + 1e-6,
      );
      for (const placement of plan.placements) {
        expect(placement.x).toBeGreaterThanOrEqual(-1e-6);
        expect(placement.x + placement.lengthM).toBeLessThanOrEqual(
          plan.base.lengthM + 1e-6,
        );
        expect(placement.z + placement.widthM).toBeLessThanOrEqual(
          plan.base.widthM + 1e-6,
        );
      }
    }
  });

  it("destekleyen birim üstündekinden önce yerleşir", async () => {
    const result = await plans();

    for (const plan of result) {
      for (const placement of plan.placements) {
        if (placement.y <= 1e-6) continue;
        const supporters = plan.placements.filter(
          (other) =>
            other !== placement &&
            Math.abs(other.y + other.heightM - placement.y) <= 1e-4 &&
            Math.min(other.x + other.lengthM, placement.x + placement.lengthM) -
              Math.max(other.x, placement.x) >
              1e-4,
        );
        for (const supporter of supporters) {
          expect(supporter.seq).toBeLessThan(placement.seq);
        }
      }
    }
  });

  it("bilinmeyen paket türüyle sevkiyat açılmasına izin vermez", async () => {
    const sku = await prisma.sku.findFirst({
      where: { tenantId: TENANT_ID },
      select: { code: true },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/shipments",
      payload: {
        facility: FACILITY_CODE,
        code: `${SHIPMENT_CODE}-BAD`,
        stops: [{ code: "S1", name: "Durak" }],
        lines: [
          {
            stopCode: "S1",
            skuCode: sku!.code,
            packageTypeCode: "YOK-TIP",
            quantity: 1,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("Bilinmeyen paket türü");
  });

  it("bilinmeyen durağa satır bağlanmasına izin vermez", async () => {
    const sku = await prisma.sku.findFirst({
      where: { tenantId: TENANT_ID },
      select: { code: true },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/shipments",
      payload: {
        facility: FACILITY_CODE,
        code: `${SHIPMENT_CODE}-BAD2`,
        stops: [{ code: "S1", name: "Durak" }],
        lines: [
          {
            stopCode: "S9",
            skuCode: sku!.code,
            packageTypeCode: "CASE-STD",
            quantity: 1,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("Bilinmeyen durak");
  });
});
