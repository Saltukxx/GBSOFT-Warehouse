import path from "node:path";
import { z } from "zod";

// Ortam değişkenleri monorepo kökündeki tek .env dosyasından okunur.
const rootEnv = path.resolve(import.meta.dirname, "../../../.env");
try {
  process.loadEnvFile(rootEnv);
} catch {
  // .env yoksa gerçek ortam değişkenleriyle devam edilir.
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_HOST: z.string().default("127.0.0.1"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  /// Tek kiracı kurulumda varsayılan kiracı. Şema baştan tenant-scoped'dır.
  DEFAULT_TENANT_ID: z.string().default("gbsoft-pilot"),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  OPTIMIZER_URL: z.string().url().default("http://127.0.0.1:8001"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Ortam değişkenleri eksik veya hatalı:\n${issues}\n\n` +
      `Kökte .env dosyası oluşturun: cp .env.example .env`,
  );
}

export const config = parsed.data;
