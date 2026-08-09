/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Ortam değişkenleri monorepo kökündeki tek .env dosyasından okunur;
  // web, API ve docker compose aynı değerleri paylaşır.
  envDir: "../..",
  // Varsayılan 5173; port meşgulse çağıran taraf PORT ile başka bir port
  // verebilir. API'nin CORS ayarı (WEB_ORIGIN) buna uymalıdır.
  server: { port: Number(process.env.PORT) || 5173 },
  test: {
    // Playwright senaryoları vitest tarafından çalıştırılmaz.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
