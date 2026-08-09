import type { FastifyInstance } from "fastify";
import type { DataQualityResponse } from "@gbsoft/domain";
import { distanceMatrix, graphCoverage } from "@gbsoft/domain";
import { prisma } from "../db.js";
import { evaluateDataQuality } from "../quality/engine.js";
import { loadStoredGraph } from "../twin/graph.js";

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
