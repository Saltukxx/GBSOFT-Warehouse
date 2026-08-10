import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { toVehicleTemplate } from "../truckload/vehicle.js";

export async function vehicleRoutes(app: FastifyInstance) {
  app.get("/vehicle-templates", async (request) => {
    const rows = await prisma.vehicleTemplate.findMany({
      where: { tenantId: request.tenantId },
      orderBy: { code: "asc" },
    });
    return { templates: rows.map(toVehicleTemplate) };
  });

  app.get<{ Params: { code: string } }>("/vehicle-templates/:code", async (request, reply) => {
    const row = await prisma.vehicleTemplate.findFirst({
      where: { tenantId: request.tenantId, code: request.params.code },
    });
    if (!row) return reply.notFound("Araç şablonu bulunamadı.");
    return toVehicleTemplate(row);
  });
}
