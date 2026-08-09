import type { FastifyInstance } from "fastify";
import type {
  PickTimeCalibrationResult,
  PickTimeModelSnapshot,
  PickingTimeResponse,
} from "@gbsoft/domain";
import { prisma } from "../db.js";
import {
  calibrateFacilityModel,
  getPickTimeModelSnapshot,
  getPickingTimeResponse,
} from "../picking/model.js";

async function facilityExists(tenantId: string, code: string): Promise<boolean> {
  return Boolean(
    await prisma.facility.findUnique({
      where: { tenantId_code: { tenantId, code } },
      select: { id: true },
    }),
  );
}

export async function pickingRoutes(app: FastifyInstance) {
  app.get<{ Params: { code: string } }>(
    "/facilities/:code/picking-time",
    async (request, reply): Promise<PickingTimeResponse | undefined> => {
      if (!(await facilityExists(request.tenantId, request.params.code))) {
        return reply.notFound(`Tesis bulunamadı: ${request.params.code}`);
      }
      return prisma.$transaction((tx) =>
        getPickingTimeResponse(tx, request.tenantId, request.params.code),
      );
    },
  );

  app.get<{ Params: { code: string } }>(
    "/facilities/:code/pick-time-model",
    async (request, reply): Promise<PickTimeModelSnapshot | undefined> => {
      if (!(await facilityExists(request.tenantId, request.params.code))) {
        return reply.notFound(`Tesis bulunamadı: ${request.params.code}`);
      }
      return prisma.$transaction((tx) =>
        getPickTimeModelSnapshot(tx, request.tenantId, request.params.code),
      );
    },
  );

  app.post<{ Params: { code: string } }>(
    "/facilities/:code/pick-time-model/calibrate",
    async (
      request,
      reply,
    ): Promise<(PickTimeCalibrationResult & { modelVersion: string | null }) | undefined> => {
      if (!(await facilityExists(request.tenantId, request.params.code))) {
        return reply.notFound(`Tesis bulunamadı: ${request.params.code}`);
      }
      return prisma.$transaction(
        (tx) => calibrateFacilityModel(tx, request.tenantId, request.params.code),
        { timeout: 60_000 },
      );
    },
  );
}
