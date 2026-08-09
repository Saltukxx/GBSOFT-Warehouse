import type { FastifyInstance } from "fastify";
import type { DataQualityResponse, RoutePlan, Scene3DResponse } from "@gbsoft/domain";
import { buildScene3D, distanceMatrix, graphCoverage } from "@gbsoft/domain";
import { prisma } from "../db.js";
import { evaluateDataQuality } from "../quality/engine.js";
import { loadStoredGraph } from "../twin/graph.js";
import { loadActiveLayout } from "../twin/layout.js";
import { routePlanForLayout } from "../twin/routes3d.js";

/** Her bacak ayrı bir Dijkstra çalıştırır; tek istek sınırsız iş üretemez. */
const MAX_ROUTE_STOPS = 120;

async function activeLayout(tenantId: string, facilityCode: string) {
  return prisma.layoutVersion.findFirst({
    where: {
      tenantId,
      isActive: true,
      facility: { code: facilityCode },
    },
    orderBy: { version: "desc" },
    include: {
      facility: { select: { id: true, code: true } },
      _count: { select: { locations: true } },
    },
  });
}

export async function twinRoutes(app: FastifyInstance) {
  /**
   * GET /facilities/:code/scene-3d
   *
   * Aktif ikizin 3B sahnesi — kanonik birim metre. Geometri 2B layout ile aynı
   * kaynaktan gelir; sahne yeni bir ayak izi uydurmaz. Ölçülmüş raf kotu yoksa
   * yanıt `geometrySource: "derived"` der ve arayüz bunu kullanıcıya söyler.
   */
  app.get<{ Params: { code: string } }>(
    "/facilities/:code/scene-3d",
    async (request, reply): Promise<Scene3DResponse | undefined> => {
      const { code } = request.params;
      const loaded = await loadActiveLayout(request.tenantId, code);

      if (!loaded.found) {
        return reply.notFound(
          loaded.missing === "facility"
            ? `Tesis bulunamadı: ${code}`
            : `${code} tesisinde aktif dijital ikiz sürümü yok. Önce layout içe aktarın.`,
        );
      }

      return {
        facility: {
          id: loaded.facilityRow.code,
          name: loaded.facilityRow.name,
          city: loaded.facilityRow.city,
        },
        scene: buildScene3D({
          layout: loaded.layout,
          locations: loaded.scene3dLocations,
          floorAreas: loaded.scene3dFloorAreas,
          clearHeightM: loaded.clearHeightM,
        }),
      };
    },
  );

  /**
   * GET /facilities/:code/routes?stops=DOCK,A-01-01,B-03-02
   *
   * Durak dizisinin yürüyüş grafındaki güzergâhı — 3B replay bunu çizer.
   * Rota mesafe matrisiyle aynı graftan çıkar; ikisi ayrışamaz.
   */
  app.get<{ Params: { code: string }; Querystring: { stops?: string } }>(
    "/facilities/:code/routes",
    async (request, reply): Promise<RoutePlan | undefined> => {
      const layout = await activeLayout(request.tenantId, request.params.code);
      if (!layout) return reply.notFound("Aktif dijital ikiz sürümü bulunamadı.");

      const stops = (request.query.stops ?? "")
        .split(",")
        .map((stop) => stop.trim())
        .filter(Boolean);

      if (stops.length < 2) {
        return reply.badRequest(
          "En az iki durak gerekir. Örnek: ?stops=DOCK,A-01-01,B-03-02",
        );
      }
      if (stops.length > MAX_ROUTE_STOPS) {
        return reply.badRequest(
          `Tek istekte en fazla ${MAX_ROUTE_STOPS} durak hesaplanır; ` +
            `${stops.length} durak istendi.`,
        );
      }

      return prisma.$transaction((tx) =>
        routePlanForLayout(
          tx,
          request.tenantId,
          {
            id: layout.id,
            version: layout.version,
            unitsPerMeter: layout.unitsPerMeter,
            facilityCode: layout.facility.code,
          },
          stops,
        ),
      );
    },
  );

  app.get<{ Params: { code: string } }>(
    "/facilities/:code/graph",
    async (request, reply) => {
      const layout = await activeLayout(request.tenantId, request.params.code);
      if (!layout) return reply.notFound("Aktif dijital ikiz sürümü bulunamadı.");

      const graph = await prisma.$transaction((tx) =>
        loadStoredGraph(tx, request.tenantId, layout.id),
      );
      const coverage = graphCoverage(graph);
      const mappedPct = layout._count.locations === 0
        ? 0
        : Math.round(
            (coverage.mappedLocationCount / layout._count.locations) * 100_000,
          ) / 1_000;
      return {
        facilityCode: layout.facility.code,
        layoutVersion: layout.version,
        coverage: {
          ...coverage,
          locationCount: layout._count.locations,
          coveragePct: Math.min(coverage.coveragePct, mappedPct),
        },
        graph,
      };
    },
  );

  app.get<{ Params: { code: string } }>(
    "/facilities/:code/distance-matrix",
    async (request, reply) => {
      const layout = await activeLayout(request.tenantId, request.params.code);
      if (!layout) return reply.notFound("Aktif dijital ikiz sürümü bulunamadı.");

      const graph = await prisma.$transaction((tx) =>
        loadStoredGraph(tx, request.tenantId, layout.id),
      );
      const started = performance.now();
      const matrix = distanceMatrix(graph);
      const computeDurationMs = Math.round((performance.now() - started) * 10) / 10;
      return {
        facilityCode: layout.facility.code,
        layoutVersion: layout.version,
        computeDurationMs,
        ...matrix,
      };
    },
  );

  app.get<{ Querystring: { facility?: string } }>(
    "/data-quality",
    async (request, reply): Promise<DataQualityResponse | undefined> => {
      const code = request.query.facility;
      const facilities = await prisma.facility.findMany({
        where: { tenantId: request.tenantId, ...(code ? { code } : {}) },
        select: { id: true },
        take: 2,
      });
      if (facilities.length !== 1) {
        return reply.notFound(
          code ? `Tesis bulunamadı: ${code}` : "Tesis belirtilmeli.",
        );
      }

      return prisma.$transaction((tx) =>
        evaluateDataQuality(tx, request.tenantId, facilities[0].id),
      );
    },
  );
}
