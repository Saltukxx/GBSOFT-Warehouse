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
  build: {
    rolldownOptions: {
      output: {
        /**
         * three.js kendi parçasına ayrılır.
         *
         * 3B sahneler zaten `lazy` yükleniyor, ama three ve @react-three
         * sahneyi ilk açan parçanın içine gömülüyordu: 900 kB'lik tek bir
         * dosya çıkıyor ve palet sahnesini açan kullanıcı araç sahnesinin
         * bağımlılığını da baştan indiriyordu. Ayrı parça hem üç sahne
         * arasında paylaşılır hem de tarayıcıda ayrı önbelleklenir; 3B'ye
         * hiç girmeyen kullanıcı ise hiç indirmez.
         */
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("/three/") ||
            id.includes("/@react-three/") ||
            id.includes("/three-stdlib/")
          ) {
            return "three";
          }
          return undefined;
        },
      },
    },
  },
  test: {
    // Playwright senaryoları vitest tarafından çalıştırılmaz.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
