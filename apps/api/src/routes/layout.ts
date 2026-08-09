import type { FastifyInstance } from "fastify";
import type { FacilityLayoutResponse } from "@gbsoft/domain";
import { loadActiveLayout } from "../twin/layout.js";

/**
 * GET /facilities/:code/layout
 *
 * Dijital ikizin aktif sürümünü ve pick gözlerini döner. Arayüz haritayı bu
 * yanıttan çizer; sabit ızgara varsayımı yoktur. Sorgu ve dönüşüm
 * `twin/layout.ts` içindedir — 3B sahne ucu da aynı yolu kullanır.
 */
export async function layoutRoutes(app: FastifyInstance) {
  app.get<{ Params: { code: string } }>(
    "/facilities/:code/layout",
    async (request, reply): Promise<FacilityLayoutResponse | undefined> => {
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
        facility: loaded.facility,
        layout: loaded.layout,
        locations: loaded.locations,
      };
    },
  );
}
