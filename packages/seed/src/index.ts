/**
 * @gbsoft/seed — golden dataset.
 *
 * Marmara Dağıtım Merkezi kurgusal tesisi. Tek kaynak olarak üç yeri besler:
 *  1. Veritabanı seed'i (apps/api/prisma/seed.ts)
 *  2. Arayüzün demo modu (VITE_DEMO_MODE=1) — backend olmadan satış demosu
 *  3. Solver ve veri tutarlılık regresyon testleri
 *
 * Hiçbir değer rastgele üretilmez; tüm değişkenlik seed'li mulberry32
 * üzerinden gelir ve her çalıştırmada aynıdır.
 */

export * from "./rng.js";
export * from "./facility.js";
export * from "./layout.js";
export * from "./skus.js";
export * from "./pickingTime.js";
export * from "./slotPlan.js";
export * from "./moveTasks.js";
export * from "./overview.js";
export * from "./dataQuality.js";
