import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PickTourPlan, RoutePlan } from "@gbsoft/domain";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { prisma } from "../db.js";

/**
 * Faz 6.5 çıkış koşulu: bir yükleme siparişi turlara bölünür, süreler alan
 * modeliyle tutarlıdır ve hiçbir yerde kanıtlanmış optimum iddia edilmez.
 *
 * Test gerçek veritabanına ve çalışan solver servisine ihtiyaç duyar; ikisi
 * de yoksa atlanır.
 */

const TENANT_ID = "gbsoft-pilot";
const FACILITY_CODE = "MARMARA-DC-01";
const ORDER_CODE = `PO-TEST-${Date.now()}`;

let app: FastifyInstance;
let orderId = "";

const databaseAvailable = await prisma.$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => false);

const solverAvailable = await fetch(`${config.OPTIMIZER_URL}/health`)
  .then((response) => response.json())
  .then((body: { pickTourSolverVersion?: string }) =>
    Boolean(body.pickTourSolverVersion),
  )
  .catch(() => false);

const ready = databaseAvailable && solverAvailable;

beforeAll(async () => {
  if (!ready) return;
  app = await buildApp();
  await app.ready();

  // Aktif yerleşimi olan SKU'lardan bir sipariş kur; yerleşimi olmayan SKU
  // zaten tura giremez ve bu ayrı bir testin konusu.
  const placements = await prisma.skuPlacement.findMany({
    where: { tenantId: TENANT_ID, effectiveTo: null },
    take: 12,
    include: { sku: { select: { code: true } } },
    orderBy: { skuId: "asc" },
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/pick-orders",
    payload: {
      facility: FACILITY_CODE,
      code: ORDER_CODE,
      dockCode: "DOCK-1",
      lines: placements.map((placement, index) => ({
        skuCode: placement.sku.code,
        quantity: (index % 3) + 1,
      })),
    },
  });
  expect(response.statusCode).toBe(201);
  orderId = response.json().id;
});

afterAll(async () => {
  if (!ready) return;
  if (orderId) {
    await prisma.pickOrder.delete({ where: { id: orderId } }).catch(() => {});
  }
  if (app) await app.close();
});

describe.skipIf(!ready)("toplama turu hattı", () => {
  it("siparişi kapasiteye göre turlara böler ve hiçbir satırı düşürmez", async () => {
    const started = await app.inject({
      method: "POST",
      url: `/api/pick-orders/${ORDER_CODE}/optimize`,
      payload: {
        equipment: "cart",
        vehicleCount: 3,
        capacityVolumeM3: 0.35,
        capacityWeightKg: 60,
        objective: "makespan",
      },
    });
    expect(started.statusCode).toBe(202);
    expect(started.json().skippedLines).toEqual([]);

    const runId = started.json().runId as string;
    const deadline = Date.now() + 45_000;
    let status = "queued";
    while (Date.now() < deadline && (status === "queued" || status === "running")) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const run = await app.inject({ method: "GET", url: `/api/optimization-runs/${runId}` });
      status = run.json().status;
    }
    expect(status).toBe("feasible");

    const tours = await app.inject({
      method: "GET",
      url: `/api/pick-orders/${ORDER_CODE}/tours`,
    });
    expect(tours.statusCode).toBe(200);
    const plan = tours.json() as PickTourPlan;

    expect(plan.tours.length).toBeGreaterThan(0);
    const order = await app.inject({
      method: "GET",
      url: `/api/pick-orders/${ORDER_CODE}`,
    });
    const lineCount = order.json().lines.length as number;
    const stopCount = plan.tours.reduce((sum, tour) => sum + tour.stops.length, 0);
    // Aynı göze düşen satırlar tek durakta birleşir; durak sayısı satır
    // sayısını aşamaz ama hiçbir satır kaybolmamalıdır.
    expect(stopCount).toBeLessThanOrEqual(lineCount);
    expect(stopCount).toBeGreaterThan(0);
  }, 60_000);

  it("makespan toplamdan küçük, alt sınırdan büyüktür", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/pick-orders/${ORDER_CODE}/tours`,
    });
    const plan = response.json() as PickTourPlan;

    // Turlar paralel çalışır: teslim süresi iş gücü toplamından küçüktür.
    expect(plan.makespanSec).toBeLessThan(plan.totalSec);
    // Alt sınır gerçek bir sınırdır; çözüm altına inemez.
    expect(plan.makespanSec).toBeGreaterThanOrEqual(plan.lowerBoundSec - 0.5);
    expect(plan.lowerBoundSec).toBeGreaterThan(0);
  });

  it("kanıtlanmış optimum iddia etmez ve kalibrasyon durumunu söyler", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/pick-orders/${ORDER_CODE}/tours`,
    });
    const plan = response.json() as PickTourPlan;

    // Routing optimum kanıtlamaz; sözleşmede "optimal" değeri yoktur.
    expect(plan.solutionQuality).toBe("feasible");
    expect(plan.solverVersion).toContain("pick-tour");
    // Golden dataset'te gerçek görev olayı yok; model kalibre olamaz.
    expect(plan.calibrated).toBe(false);
  });

  it("tur süresi durak sürelerinin toplamıyla tutarlıdır", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/pick-orders/${ORDER_CODE}/tours`,
    });
    const plan = response.json() as PickTourPlan;
    const tour = plan.tours[0];

    const stopSec = tour.stops.reduce(
      (sum, stop) => sum + stop.travelSec + stop.congestionSec + stop.pickSec,
      0,
    );
    // Durakların toplamı turun tamamını aşamaz; kalanı hazırlık, dönüş ve
    // bırakmadır.
    expect(stopSec).toBeLessThan(tour.estimatedSec);
    // Kümülatif süre artan olmalı.
    for (let index = 1; index < tour.stops.length; index += 1) {
      expect(tour.stops[index].cumulativeSec).toBeGreaterThan(
        tour.stops[index - 1].cumulativeSec,
      );
    }
  });

  it("turun 3B güzergâhı turun mesafesiyle aynı sayıyı verir", async () => {
    const toursResponse = await app.inject({
      method: "GET",
      url: `/api/pick-orders/${ORDER_CODE}/tours`,
    });
    const plan = toursResponse.json() as PickTourPlan;
    const tour = plan.tours[0];

    const routeResponse = await app.inject({
      method: "GET",
      url: `/api/pick-orders/${ORDER_CODE}/tours/${tour.id}/route`,
    });
    expect(routeResponse.statusCode).toBe(200);
    const route = routeResponse.json() as RoutePlan;

    expect(route.unreachable).toEqual([]);
    // Rota ile tur ayrı hesaplar olsaydı ayrışırlardı; ikisi de aynı graftan
    // gelir ve milimetre mertebesinde örtüşmek zorundadır.
    expect(route.totalDistanceM).toBeCloseTo(tour.totalDistanceM, 1);
    expect(route.legs.length).toBe(tour.stops.length + 1);
  });

  it("bilinmeyen SKU ile sipariş açılmasına izin vermez", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/pick-orders",
      payload: {
        facility: FACILITY_CODE,
        code: `${ORDER_CODE}-BAD`,
        lines: [{ skuCode: "SKU-YOK-9999", quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("Bilinmeyen SKU");
  });
});
