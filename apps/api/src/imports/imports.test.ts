import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  DataQualityResponse,
  FacilityLayoutResponse,
  ImportKind,
  ImportReport,
  PickTimeCalibrationResult,
  PickTimeModelSnapshot,
  PickingTimeResponse,
} from "@gbsoft/domain";
import {
  DEFAULT_BLUEPRINT,
  IMPORT_TEMPLATES,
  blueprintToFloorAreaCsvRows,
  blueprintToLayoutCsvRows,
  buildLayoutDraft,
  toCsv,
} from "@gbsoft/domain";
import { goldenCsvRows } from "@gbsoft/seed";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";

/**
 * Faz 1 çıkış koşulu: golden dataset içe aktarma hattından geçer ve satır
 * bazlı doğrulama raporu üretir.
 *
 * Test gerçek veritabanına yazar; bu yüzden kendi kiracısını kullanır ve
 * sonunda temizler. Seed'lenmiş `gbsoft-pilot` kiracısına dokunmaz.
 */

const TENANT_ID = "test-import";
const FACILITY_CODE = "TEST-DC-01";

// Türkçe Excel biçimi: noktalı virgül ayraç, ondalık virgül.
const DELIMITER = ";";

let app: FastifyInstance;
let facilityId: string;

// Erişilebilirlik describe çalışmadan önce bilinmeli; beforeAll içinde
// bakmak geç kalır ve skipIf hiçbir zaman devreye girmez.
const databaseAvailable = await prisma
  .$queryRaw`SELECT 1`.then(() => true)
  .catch(() => false);

function csvFor(kind: ImportKind): string {
  const rows = goldenCsvRows(kind);
  if (!rows) throw new Error(`${kind} için golden dataset satırı yok.`);
  return toCsv(rows, DELIMITER);
}

async function upload(
  kind: ImportKind,
  content: string,
  query: Record<string, string> = {},
): Promise<{ statusCode: number; report: ImportReport }> {
  const search = new URLSearchParams({ facility: FACILITY_CODE, ...query });
  const response = await app.inject({
    method: "POST",
    url: `/api/imports/${kind}?${search.toString()}`,
    headers: { "content-type": "text/csv", "x-tenant-id": TENANT_ID },
    payload: content,
  });
  return { statusCode: response.statusCode, report: response.json() as ImportReport };
}

async function purge() {
  const facility = await prisma.facility.findUnique({
    where: { tenantId_code: { tenantId: TENANT_ID, code: FACILITY_CODE } },
    select: { id: true },
  });
  if (facility) {
    await prisma.skuPlacement.deleteMany({
      where: { tenantId: TENANT_ID, sku: { facilityId: facility.id } },
    });
    await prisma.facility.delete({ where: { id: facility.id } });
  }
  await prisma.auditLog.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
}

beforeAll(async () => {
  if (!databaseAvailable) return;

  await purge();
  await prisma.tenant.create({ data: { id: TENANT_ID, name: "İçe aktarma testi" } });
  const facility = await prisma.facility.create({
    data: {
      tenantId: TENANT_ID,
      code: FACILITY_CODE,
      name: "Test Dağıtım Merkezi",
      city: "İstanbul",
    },
  });
  facilityId = facility.id;
  app = await buildApp();
}, 60_000);

afterAll(async () => {
  if (databaseAvailable) await purge();
  await app?.close();
  await prisma.$disconnect();
});

describe.skipIf(!databaseAvailable)("içe aktarma hattı", () => {
  it("boş tesiste geometri kuru koşusu yazmadan doğrular", async () => {
    const { statusCode, report } = await upload("layout", csvFor("layout"));

    expect(statusCode).toBe(200);
    expect(report.status).toBe("VALIDATED");
    expect(report.dryRun).toBe(true);
    expect(report.delimiter).toBe(";");
    expect(report.rowsTotal).toBe(96);
    expect(report.rowsAccepted).toBe(96);
    expect(report.rowsRejected).toBe(0);
    expect(report.errorCount).toBe(0);

    // Kuru koşu hiçbir şey yazmaz.
    expect(await prisma.location.count({ where: { tenantId: TENANT_ID } })).toBe(0);
    // Ama denendiği kayda geçer.
    expect(report.batchId).toBeTruthy();
  });

  it("geometriyi uygular ve layout ucu 96 lokasyon döner", async () => {
    const { statusCode, report } = await upload("layout", csvFor("layout"), {
      dryRun: "0",
      activate: "1",
      unitsPerMeter: "7",
      dockAnchorX: "150",
      dockAnchorY: "376",
    });

    expect(statusCode).toBe(200);
    expect(report.status).toBe("APPLIED");
    expect(report.rowsAccepted).toBe(96);

    const [locations, zones, aisles, faces] = await Promise.all([
      prisma.location.count({ where: { tenantId: TENANT_ID } }),
      prisma.zone.count({ where: { tenantId: TENANT_ID } }),
      prisma.aisle.count({ where: { tenantId: TENANT_ID } }),
      prisma.rackFace.count({ where: { tenantId: TENANT_ID } }),
    ]);
    expect(locations).toBe(96);
    expect(zones).toBe(4);
    expect(aisles).toBe(12);
    expect(faces).toBe(24);

    const [graphNodes, graphEdges] = await Promise.all([
      prisma.graphNode.count({ where: { tenantId: TENANT_ID } }),
      prisma.graphEdge.count({ where: { tenantId: TENANT_ID } }),
    ]);
    expect(graphNodes).toBeGreaterThan(96);
    expect(graphEdges).toBeGreaterThan(96);

    // Dijital ikiz gerçekten servis ediliyor mu?
    const response = await app.inject({
      method: "GET",
      url: `/api/facilities/${FACILITY_CODE}/layout`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as FacilityLayoutResponse;
    expect(body.locations).toHaveLength(96);
    expect(body.layout.unitsPerMeter).toBe(7);

    // Uygulanan içe aktarma denetim kaydına düşer.
    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: TENANT_ID, action: "import.layout" },
    });
    expect(audit).not.toBeNull();
  });

  it("raf dışı alanları aktif sürüme yazar", async () => {
    const { statusCode, report } = await upload("floor-area", csvFor("floor-area"), {
      dryRun: "0",
    });
    expect(statusCode).toBe(200);
    expect(report.status).toBe("APPLIED");
    expect(await prisma.floorArea.count({ where: { tenantId: TENANT_ID } })).toBe(
      report.rowsAccepted,
    );

    const graphResponse = await app.inject({
      method: "GET",
      url: `/api/facilities/${FACILITY_CODE}/graph`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    expect(graphResponse.statusCode).toBe(200);
    expect(graphResponse.json().coverage).toMatchObject({
      locationCount: 96,
      mappedLocationCount: 96,
      coveragePct: 100,
    });

    const matrixResponse = await app.inject({
      method: "GET",
      url: `/api/facilities/${FACILITY_CODE}/distance-matrix`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    expect(matrixResponse.statusCode).toBe(200);
    const matrix = matrixResponse.json() as {
      locationCodes: string[];
      distancesM: Array<Array<number | null>>;
      computeDurationMs: number;
    };
    expect(matrix.locationCodes).toHaveLength(96);
    expect(matrix.distancesM).toHaveLength(96);
    expect(matrix.computeDurationMs).toBeLessThan(200);
  });

  it("SKU master'ı yazar, ölçüsü eksik olanları uyarı olarak raporlar", async () => {
    const { statusCode, report } = await upload("sku", csvFor("sku"), { dryRun: "0" });

    expect(statusCode).toBe(200);
    expect(report.status).toBe("APPLIED");
    expect(report.rowsAccepted).toBe(184);
    expect(await prisma.sku.count({ where: { tenantId: TENANT_ID } })).toBe(184);

    // Ölçü eksikliği satırı düşürmez ama sessizce de geçilmez.
    const missing = report.issues.filter((i) => i.code === "olcu-eksik");
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((i) => i.severity === "warning")).toBe(true);

    // Kaynak kimlik eşlemesi kuruldu.
    expect(
      await prisma.identityMap.count({
        where: { tenantId: TENANT_ID, entityType: "sku" },
      }),
    ).toBe(184);

    // Rezervdeki SKU'ların pick gözü yoktur; kalanı yerleşti.
    const placements = await prisma.skuPlacement.count({
      where: { tenantId: TENANT_ID, effectiveTo: null },
    });
    expect(placements).toBeGreaterThan(0);
    expect(placements).toBeLessThanOrEqual(96);

    const qualityResponse = await app.inject({
      method: "GET",
      url: `/api/data-quality?facility=${FACILITY_CODE}`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    expect(qualityResponse.statusCode).toBe(200);
    const quality = qualityResponse.json() as DataQualityResponse;
    expect(quality.coverage.find((row) => row.key === "graph-coverage")?.valuePct).toBe(100);
    expect(quality.coverage.find((row) => row.key === "identity")?.valuePct).toBe(100);
    expect(quality.publishGate.allowed).toBe(false);
    expect(quality.publishGate.blockingIssueCodes).toContain("DQ-SKU-PHYSICAL");
  });

  it("aynı dosyayı tekrar yüklemek yeni kayıt üretmez", async () => {
    const before = await prisma.sku.count({ where: { tenantId: TENANT_ID } });
    const { report } = await upload("sku", csvFor("sku"), { dryRun: "0" });
    expect(report.status).toBe("APPLIED");
    expect(await prisma.sku.count({ where: { tenantId: TENANT_ID } })).toBe(before);
  });

  it("kaynak kimliği başka bir SKU'ya bağlanamaz", async () => {
    // SKU-184'ün kaynak kimliğini yeni bir kanonik koda bağlamayı dener.
    const template = IMPORT_TEMPLATES.sku;
    const header = template.columns.map((c) => c.name);
    const row = header.map((name) => {
      if (name === "code") return "SKU-KOPYA";
      if (name === "name") return "Kimliği çalınmış ürün";
      if (name === "category") return "Test";
      if (name === "sourceSystem") return "seed";
      if (name === "sourceId") return "SKU-184";
      return "";
    });

    const { statusCode, report } = await upload("sku", toCsv([header, row], DELIMITER), {
      dryRun: "0",
    });

    expect(statusCode).toBe(422);
    expect(report.status).toBe("REJECTED");
    const conflict = report.issues.find((i) => i.code === "kimlik-catismasi");
    expect(conflict?.severity).toBe("error");
    expect(conflict?.message).toContain("SKU-184");
    expect(
      await prisma.sku.findFirst({
        where: { tenantId: TENANT_ID, code: "SKU-KOPYA" },
      }),
    ).toBeNull();
  });

  it("hız ve dalga dosyalarını yazar", async () => {
    const velocity = await upload("velocity", csvFor("velocity"), { dryRun: "0" });
    expect(velocity.report.status).toBe("APPLIED");
    expect(
      await prisma.velocitySnapshot.count({ where: { tenantId: TENANT_ID } }),
    ).toBe(184);

    const wave = await upload("wave", csvFor("wave"), { dryRun: "0" });
    expect(wave.report.status).toBe("APPLIED");
    expect(await prisma.wave.count({ where: { tenantId: TENANT_ID } })).toBe(38);
  });

  it("görev olaylarını yazar ve eventTime ile ingestTime'ı ayırır", async () => {
    const template = IMPORT_TEMPLATES["pick-task"];
    const header = template.columns.map((c) => c.name);
    // Örnek satırlar W-2240 dalgasına ve gerçek gözlere bağlıdır.
    const rows = template.sampleRows.map((sample) =>
      header.map((name, index) => {
        if (name === "skuCode") return "SKU-184";
        if (name === "locationCode") return "B-11-04";
        return sample[index];
      }),
    );

    const { statusCode, report } = await upload(
      "pick-task",
      toCsv([header, ...rows], DELIMITER),
      { dryRun: "0" },
    );

    expect(statusCode).toBe(200);
    expect(report.status).toBe("APPLIED");
    expect(await prisma.pickTask.count({ where: { tenantId: TENANT_ID } })).toBe(2);

    const events = await prisma.event.findMany({
      where: { tenantId: TENANT_ID },
      orderBy: { eventTime: "asc" },
    });
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.eventType)).toContain("TASK_COMPLETED");
    // Olay sahada 2026'da gerçekleşti; sisteme şimdi ulaştı.
    expect(events[0].eventTime.getTime()).toBeLessThan(events[0].ingestTime.getTime());

    // Başlangıç/bitiş çiftinden süre etiketi üretildi.
    const task = await prisma.pickTask.findFirst({
      where: { tenantId: TENANT_ID },
      orderBy: { startedAt: "asc" },
    });
    expect(task?.durationSec).toBe(69);

    const qualityResponse = await app.inject({
      method: "GET",
      url: `/api/data-quality?facility=${FACILITY_CODE}`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    const quality = qualityResponse.json() as DataQualityResponse;
    expect(
      quality.coverage.find((row) => row.key === "event-completeness")?.valuePct,
    ).toBe(100);

    // Tekrar yükleme yeni görev üretmez.
    const again = await upload("pick-task", toCsv([header, ...rows], DELIMITER), {
      dryRun: "0",
    });
    expect(again.report.issues.some((i) => i.code === "zaten-yuklu")).toBe(true);
    expect(await prisma.pickTask.count({ where: { tenantId: TENANT_ID } })).toBe(2);
  });

  it("pick-time modeli örnek eşiğini dürüstçe uygular ve yeni sürüm üretir", async () => {
    const before = await app.inject({
      method: "GET",
      url: `/api/facilities/${FACILITY_CODE}/picking-time`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json() as PickingTimeResponse;
    expect(beforeBody.actual).not.toBeNull();
    expect(beforeBody.model.calibrated).toBe(false);
    expect(beforeBody.model.parameters.meanTravelSec).toBeGreaterThan(0);

    const insufficient = await app.inject({
      method: "POST",
      url: `/api/facilities/${FACILITY_CODE}/pick-time-model/calibrate`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    const insufficientBody = insufficient.json() as PickTimeCalibrationResult;
    expect(insufficientBody.status).toBe("insufficient-data");
    expect(insufficientBody.calibrated).toBe(false);

    const wave = await prisma.wave.findFirstOrThrow({
      where: { tenantId: TENANT_ID, facilityId },
      select: { id: true },
    });
    const locations = await prisma.location.findMany({
      where: {
        tenantId: TENANT_ID,
        layoutVersion: { facilityId, isActive: true },
        blocked: false,
      },
      orderBy: { code: "asc" },
      take: 40,
      select: { code: true, distanceToDockM: true, congestionScore: true },
    });
    const baseTime = new Date("2026-08-08T10:00:00.000Z");
    await prisma.pickTask.createMany({
      data: Array.from({ length: 220 }, (_, index) => {
        const location = locations[index % locations.length];
        const completedAt = new Date(baseTime.getTime() + index * 60_000);
        const durationSec =
          38 + location.distanceToDockM * 0.55 + location.congestionScore * 12;
        return {
          tenantId: TENANT_ID,
          waveId: wave.id,
          sourceId: `CAL-${index}`,
          skuCode: "SKU-184",
          locationCode: location.code,
          quantity: 1,
          startedAt: new Date(completedAt.getTime() - durationSec * 1000),
          completedAt,
          durationSec,
        };
      }),
    });

    const calibrated = await app.inject({
      method: "POST",
      url: `/api/facilities/${FACILITY_CODE}/pick-time-model/calibrate`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    expect(calibrated.statusCode).toBe(200);
    const calibratedBody = calibrated.json() as PickTimeCalibrationResult & {
      modelVersion: string;
    };
    expect(calibratedBody.status).toBe("calibrated");
    expect(calibratedBody.sampleSize).toBeGreaterThanOrEqual(200);
    expect(calibratedBody.modelVersion).toBe("pick-time-1.0.1");

    const modelResponse = await app.inject({
      method: "GET",
      url: `/api/facilities/${FACILITY_CODE}/pick-time-model`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    const model = modelResponse.json() as PickTimeModelSnapshot;
    expect(model.calibrated).toBe(true);
    expect(model.algorithm).toBe("quantile-irls-v1");
    expect(model.p50MaeSec).not.toBeNull();
    expect(model.p90CoveragePct).toBeGreaterThan(80);
  });

  it("geometride tek bozuk satır bütün dosyayı reddeder ve yeni sürüm açmaz", async () => {
    const versionsBefore = await prisma.layoutVersion.count({
      where: { tenantId: TENANT_ID, facilityId },
    });

    const rows = goldenCsvRows("layout")!.map((row) => [...row]);
    const bayIndex = IMPORT_TEMPLATES.layout.columns.findIndex((c) => c.name === "bay");
    rows[5][bayIndex] = "iki";

    const { statusCode, report } = await upload("layout", toCsv(rows, DELIMITER), {
      dryRun: "0",
    });

    expect(statusCode).toBe(422);
    expect(report.status).toBe("REJECTED");
    expect(report.rowsAccepted).toBe(0);
    expect(report.rowsRejected).toBe(96);

    const issue = report.issues.find((i) => i.severity === "error");
    expect(issue?.column).toBe("bay");
    expect(issue?.line).toBe(6);
    expect(issue?.value).toBe("iki");

    expect(
      await prisma.layoutVersion.count({ where: { tenantId: TENANT_ID, facilityId } }),
    ).toBe(versionsBefore);
  });

  it("hız dosyasında bilinmeyen SKU satırını düşürür, kalanı yazar", async () => {
    const header = IMPORT_TEMPLATES.velocity.columns.map((c) => c.name);
    const good = ["SKU-184", "2026-01-01", "2026-01-15", "A", "10", "1", "0,5"];
    const bad = ["SKU-YOK", "2026-01-01", "2026-01-15", "A", "10", "1", "0,5"];

    const { statusCode, report } = await upload(
      "velocity",
      toCsv([header, good, bad], DELIMITER),
      { dryRun: "0" },
    );

    expect(statusCode).toBe(200);
    expect(report.status).toBe("APPLIED");
    expect(report.rowsAccepted).toBe(1);
    expect(report.rowsRejected).toBe(1);

    const issue = report.issues.find((i) => i.code === "bilinmeyen-sku");
    expect(issue?.line).toBe(3);
    expect(issue?.value).toBe("SKU-YOK");
  });

  it("saklanan parti raporu satır bazlı okunabilir", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/api/imports/batches?facility=${FACILITY_CODE}`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    expect(list.statusCode).toBe(200);
    const { batches } = list.json() as { batches: Array<{ id: string; kind: string }> };
    expect(batches.length).toBeGreaterThan(0);

    const detail = await app.inject({
      method: "GET",
      url: `/api/imports/batches/${batches[0].id}`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    expect(detail.statusCode).toBe(200);
    const report = detail.json() as ImportReport;
    expect(report.batchId).toBe(batches[0].id);
    expect(Array.isArray(report.issues)).toBe(true);
  });

  it("layout editörünün ürettiği geometri aynı hattan geçer", async () => {
    // Editörün ayrı bir yazma yolu yoktur; çıktısı elle doldurulmuş bir
    // dosyayla aynı doğrulamadan ve aynı sürümlemeden geçmelidir.
    const blueprint = {
      ...DEFAULT_BLUEPRINT,
      aisleCount: 4,
      zoning: DEFAULT_BLUEPRINT.zoning.slice(0, 4),
      blocked: { "A-02-01": "Raf ayağı hasar kaydı açık" },
    };
    const draft = buildLayoutDraft(blueprint);
    expect(draft.warnings).toEqual([]);

    const layout = await upload(
      "layout",
      toCsv(blueprintToLayoutCsvRows(blueprint), DELIMITER),
      {
        dryRun: "0",
        activate: "1",
        unitsPerMeter: String(blueprint.unitsPerMeter),
        dockAnchorX: String(draft.layout.dockAnchor.x),
        dockAnchorY: String(draft.layout.dockAnchor.y),
      },
    );
    expect(layout.statusCode).toBe(200);
    expect(layout.report.status).toBe("APPLIED");
    expect(layout.report.rowsAccepted).toBe(4 * 2 * 4);

    const floorAreas = await upload(
      "floor-area",
      toCsv(blueprintToFloorAreaCsvRows(blueprint), DELIMITER),
      { dryRun: "0" },
    );
    expect(floorAreas.report.status).toBe("APPLIED");

    const response = await app.inject({
      method: "GET",
      url: `/api/facilities/${FACILITY_CODE}/layout`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    const body = response.json() as FacilityLayoutResponse;
    expect(body.locations).toHaveLength(32);
    expect(body.layout.dockAnchor).toEqual(draft.layout.dockAnchor);
    expect(body.layout.floorAreas.some((a) => a.kind === "cross-aisle")).toBe(true);

    // Engel nedeni kaybolmadan geri geliyor.
    const blocked = body.locations.filter((l) => l.blocked);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].id).toBe("A-02-01");
    expect(blocked[0].blockedReason).toBe("Raf ayağı hasar kaydı açık");
  });

  it("şablon CSV'si Excel'in doğru açacağı biçimde iner", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/imports/templates/sku.csv",
      headers: { "x-tenant-id": TENANT_ID },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toContain("gbsoft-sku.csv");
    // BOM olmadan Excel Türkçe karakterleri bozar.
    expect(response.body.startsWith("\uFEFF")).toBe(true);
    expect(response.body.split("\r\n")[0]).toContain("code;name;category");
  });
});
