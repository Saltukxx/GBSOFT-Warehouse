import { buildApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";

const app = await buildApp();

async function shutdown(signal: string) {
  app.log.info({ signal }, "Kapatılıyor");
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
