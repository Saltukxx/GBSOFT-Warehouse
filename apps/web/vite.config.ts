/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Ortam değişkenleri monorepo kökündeki tek .env dosyasından okunur;
  // web, API ve docker compose aynı değerleri paylaşır.
  envDir: "../..",
  test: {
    // Playwright senaryoları vitest tarafından çalıştırılmaz.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
