import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { RoutePlan, Scene3DResponse } from "@gbsoft/domain";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";

const TENANT_ID = "gbsoft-pilot";
const FACILITY_CODE = "MARMARA-DC-01";
let app: FastifyInstance;

const databaseAvailable = await prisma.$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => false);

beforeAll(async () => {
  if (!databaseAvailable) return;
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

async function scene(): Promise<Scene3DResponse> {
  const response = await app.inject({
    method: "GET",
    url: `/api/facilities/${FACILITY_CODE}/scene-3d`,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as Scene3DResponse;
}

describe.skipIf(!databaseAvailable)("scene-3d ucu", () => {
  it("aktif ikizin bütün gözlerini metre biriminde döner", async () => {
    const { scene: value } = await scene();

    expect(value.units).toBe("m");
    expect(value.facilityCode).toBe(FACILITY_CODE);
    expect(value.bays).toHaveLength(96);
    expect(value.racks).toHaveLength(24);
    expect(value.bounds.clearHeightM).toBeGreaterThan(0);
  });

  it("2B layout ucuyla aynı geometriyi anlatır", async () => {
    const layoutResponse = await app.inject({
      method: "GET",
      url: `/api/facilities/${FACILITY_CODE}/layout`,
    });
    const layout = layoutResponse.json() as {
      layout: { unitsPerMeter: number };
      locations: Array<{ id: string; x: number; width: number }>;
    };
    const { scene: value } = await scene();

    // İki uç ayrı sorgu yazsaydı zamanla ayrışırlardı; ayrışmadıklarının
    // testi budur.
    expect(value.bays.map((bay) => bay.locationCode).sort()).toEqual(
      layout.locations.map((location) => location.id).sort(),
    );

    const source = layout.locations.find((location) => location.id === "A-03-02")!;
    const bay = value.bays.find((item) => item.locationCode === "A-03-02")!;
    expect(bay.box.center.x).toBeCloseTo(
      (source.x + source.width / 2) / layout.layout.unitsPerMeter,
      2,
    );
  });

  it("ölçülmemiş kotu ölçülmüş gibi göstermez", async () => {
    const { scene: value } = await scene();

    // Golden dataset'te ölçülmüş raf kotu yok; sahne bunu saklamamalı.
    expect(value.geometrySource).toBe("derived");
    expect(value.levelProfile.length).toBeGreaterThan(0);
    expect(value.levelProfile.every((entry) => entry.source === "derived")).toBe(true);
  });

  it("koridor ve dock yaklaşımı yollarını üretir", async () => {
    const { scene: value } = await scene();
    const kinds = value.paths.map((path) => path.kind);

    expect(kinds.filter((kind) => kind === "aisle")).toHaveLength(12);
    expect(kinds).toContain("dock-approach");
    expect(value.paths.every((path) => path.widthM > 0)).toBe(true);
  });

  it("rota ucu graf mesafesiyle aynı sayıyı verir", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/facilities/${FACILITY_CODE}/routes?stops=DOCK,A-03-02`,
    });
    expect(response.statusCode).toBe(200);
    const route = response.json() as RoutePlan;

    expect(route.units).toBe("m");
    expect(route.unreachable).toHaveLength(0);
    expect(route.legs).toHaveLength(1);
    expect(route.legs[0].points.length).toBeGreaterThan(1);

    // Rota ile gözün dock mesafesi aynı graftan çıkar; ayrışırlarsa 3B'de
    // görülen yol mesafe matrisini yalanlar.
    const { scene: value } = await scene();
    const bay = value.bays.find((item) => item.locationCode === "A-03-02")!;
    expect(route.legs[0].distanceM).toBeCloseTo(bay.distanceToDockM, 1);
    expect(route.totalDistanceM).toBeCloseTo(bay.distanceToDockM, 1);
  });

  it("durak sayısı sınırlarını uygular", async () => {
    const tooFew = await app.inject({
      method: "GET",
      url: `/api/facilities/${FACILITY_CODE}/routes?stops=DOCK`,
    });
    expect(tooFew.statusCode).toBe(400);
    expect(tooFew.json().message).toContain("En az iki durak");

    const tooMany = await app.inject({
      method: "GET",
      url:
        `/api/facilities/${FACILITY_CODE}/routes?stops=` +
        Array.from({ length: 121 }, () => "DOCK").join(","),
    });
    expect(tooMany.statusCode).toBe(400);
  });

  it("grafta olmayan durağı sessizce atlamaz", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/facilities/${FACILITY_CODE}/routes?stops=DOCK,YOK-99-99`,
    });
    expect(response.statusCode).toBe(200);
    const route = response.json() as RoutePlan;

    expect(route.legs).toHaveLength(0);
    expect(route.unreachable).toHaveLength(1);
    expect(route.unreachable[0].reason).toContain("YOK-99-99");
  });

  it("bilinmeyen tesis ile aktif ikizi olmayan tesisi ayırır", async () => {
    const unknown = await app.inject({
      method: "GET",
      url: "/api/facilities/YOK-01/scene-3d",
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().message).toContain("Tesis bulunamadı");

    const bare = await prisma.facility.create({
      data: {
        tenantId: TENANT_ID,
        code: `SCENE-TEST-${Date.now()}`,
        name: "İkizsiz tesis",
        city: "Test",
      },
    });
    try {
      const response = await app.inject({
        method: "GET",
        url: `/api/facilities/${bare.code}/scene-3d`,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().message).toContain("aktif dijital ikiz");
    } finally {
      await prisma.facility.delete({ where: { id: bare.id } });
    }
  });
});
