import path from "node:path";
import { defineConfig } from "prisma/config";

// Ortam değişkenleri monorepo kökündeki tek .env dosyasından okunur;
// böylece web, api ve docker compose aynı değerleri paylaşır.
const rootEnv = path.resolve(import.meta.dirname, "../../.env");
try {
  process.loadEnvFile(rootEnv);
} catch {
  // .env yoksa gerçek ortam değişkenleriyle devam edilir (CI, üretim).
}

export default defineConfig({
  schema: path.join(import.meta.dirname, "prisma", "schema.prisma"),
  migrations: {
    path: path.join(import.meta.dirname, "prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});
