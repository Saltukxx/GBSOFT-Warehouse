import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { VehicleTemplate } from "@gbsoft/domain";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";

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

describe.skipIf(!databaseAvailable)("araç şablonu API'si", () => {
  it("üç golden araç türünü ve kaynak etiketini listeler", async () => {
    const response = await app.inject({ method: "GET", url: "/api/vehicle-templates" });

    expect(response.statusCode).toBe(200);
    const templates = response.json().templates as VehicleTemplate[];
    expect(templates.map((item) => item.code)).toEqual(
      expect.arrayContaining(["ISO-40HC", "RIGID-12T", "SEMI-13M6"]),
    );
    expect(new Set(templates.map((item) => item.kind))).toEqual(
      new Set(["iso-container", "rigid-truck", "semi-trailer"]),
    );
    expect(templates.every((item) => item.geometrySource === "golden-assumption")).toBe(true);
    expect(templates.every((item) => item.rulesVersion === "golden-vehicle-rules-v1")).toBe(true);
  });

  it("tek şablonun kapı, aks ve ağırlık merkezi sözleşmesini döner", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/vehicle-templates/SEMI-13M6",
    });

    expect(response.statusCode).toBe(200);
    const template = response.json() as VehicleTemplate;
    expect(template.rearDoor.widthM).toBeGreaterThan(0);
    expect(template.axleGroups.length).toBeGreaterThanOrEqual(2);
    expect(template.axleGroups.some((axle) => axle.coupling)).toBe(true);
    expect(template.tractor?.axles.some((axle) => axle.driven)).toBe(true);
    expect(template.regulation?.minDriveAxleShare).toBe(0.25);
    expect(template.cogEnvelope.minX).toBeLessThan(template.cogEnvelope.maxX);
    expect(template.maxPayloadKg).toBeGreaterThan(0);
  });

  it("bilinmeyen şablon için 404 döner", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/vehicle-templates/UNKNOWN",
    });
    expect(response.statusCode).toBe(404);
  });

  it("kiracı sınırını aşmaz", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/vehicle-templates/SEMI-13M6",
      headers: { "x-tenant-id": "another-tenant" },
    });
    expect(response.statusCode).toBe(404);
  });
});
