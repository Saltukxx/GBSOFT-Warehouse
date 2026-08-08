import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

/**
 * İstek bağlamı: kiracı ve correlation ID.
 *
 * Tek kiracı kurulumda tenantId varsayılandan gelir; çok kiracılıya geçişte
 * yalnız bu çözümleyici değişir, sorgular değişmez.
 */

declare module "fastify" {
  interface FastifyRequest {
    tenantId: string;
    correlationId: string;
  }
}

export function registerContext(app: FastifyInstance) {
  app.decorateRequest("tenantId", "");
  app.decorateRequest("correlationId", "");

  app.addHook("onRequest", async (request: FastifyRequest, reply) => {
    const header = request.headers["x-correlation-id"];
    request.correlationId =
      typeof header === "string" && header.length > 0 ? header : randomUUID();

    const tenantHeader = request.headers["x-tenant-id"];
    request.tenantId =
      typeof tenantHeader === "string" && tenantHeader.length > 0
        ? tenantHeader
        : config.DEFAULT_TENANT_ID;

    reply.header("x-correlation-id", request.correlationId);
  });
}
