import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import { registerContext } from "./context.js";
import { importRoutes } from "./routes/imports.js";
import { layoutRoutes } from "./routes/layout.js";
import { pickingRoutes } from "./routes/picking.js";
import { optimizationRoutes } from "./routes/optimization.js";
import { pickOrderRoutes } from "./routes/pickOrders.js";
import { shipmentRoutes } from "./routes/shipments.js";
import { planRoutes } from "./routes/plans.js";
import { twinRoutes } from "./routes/twin.js";
import { vehicleRoutes } from "./routes/vehicles.js";
import { loadExecutionRoutes } from "./routes/loadExecution.js";
import { prisma } from "./db.js";
import { recoverOptimizationRuns } from "./optimizer/runner.js";

/**
 * Uygulama fabrikası. Test ve sunucu aynı örneği kurar; böylece route
 * testleri gerçek uygulamayı çalıştırır.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        process.env.NODE_ENV === "production"
          ? undefined
          : { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } },
    },
  });

  await app.register(sensible);
  await app.register(cors, {
    origin: [config.WEB_ORIGIN],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposedHeaders: ["x-correlation-id"],
  });

  registerContext(app);

  app.get("/health", async () => {
    // Veritabanı erişilebilir değilse sağlıklı sayılmaz.
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", tenant: config.DEFAULT_TENANT_ID };
  });

  await app.register(layoutRoutes, { prefix: "/api" });
  await app.register(importRoutes, { prefix: "/api" });
  await app.register(twinRoutes, { prefix: "/api" });
  await app.register(pickingRoutes, { prefix: "/api" });
  await app.register(optimizationRoutes, { prefix: "/api" });
  await app.register(pickOrderRoutes, { prefix: "/api" });
  await app.register(shipmentRoutes, { prefix: "/api" });
  await app.register(planRoutes, { prefix: "/api" });
  await app.register(vehicleRoutes, { prefix: "/api" });
  await app.register(loadExecutionRoutes, { prefix: "/api" });

  app.addHook("onReady", async () => {
    const recovered = await recoverOptimizationRuns();
    if (recovered > 0) app.log.warn({ recovered }, "Kalıcı optimizer kuyruğu yeniden başlatıldı");
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    request.log.error({ err: error, correlationId: request.correlationId });

    const fastifyError = error as { statusCode?: number; message?: string };
    const status = fastifyError.statusCode ?? 500;

    // 5xx'te iç detay dışarı sızmaz; ilişkilendirme correlation ID ile yapılır.
    reply.status(status).send({
      error: {
        message:
          status >= 500
            ? "Beklenmeyen bir hata oluştu."
            : (fastifyError.message ?? "İstek işlenemedi."),
        correlationId: request.correlationId,
      },
    });
  });

  return app;
}
