import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import { registerContext } from "./context.js";
import { layoutRoutes } from "./routes/layout.js";
import { prisma } from "./db.js";

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
    // Correlation ID üretimi context.ts'te; Fastify'ın kendi requestId'si
    // ile karışmasın diye kapalı tutuluyor.
    disableRequestLogging: false,
  });

  await app.register(sensible);
  await app.register(cors, {
    origin: [config.WEB_ORIGIN],
    credentials: true,
    exposedHeaders: ["x-correlation-id"],
  });

  registerContext(app);

  app.get("/health", async () => {
    // Veritabanı erişilebilir değilse sağlıklı sayılmaz.
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", tenant: config.DEFAULT_TENANT_ID };
  });

  await app.register(layoutRoutes, { prefix: "/api" });

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
