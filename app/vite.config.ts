/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Playwright senaryoları vitest tarafından çalıştırılmaz.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
