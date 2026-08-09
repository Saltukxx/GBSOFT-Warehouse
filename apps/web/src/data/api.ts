/**
 * Veri erişim katmanı.
 *
 * Arayüz her zaman buradan okur; verinin gerçek API'den mi yoksa golden
 * dataset'ten mi geldiğini bilmez.
 *
 *  - `VITE_DEMO_MODE=1`  → her şey demo adaptöründen (backend gerekmez)
 *  - aksi halde          → canlı uçlar API'den, kalanlar demo adaptöründen
 *
 * Bir uç canlıya bağlandıkça buradaki listeden çıkarılır. Böylece ürünün
 * gerçekte ne kadarının canlı olduğu tek bakışta görülür.
 */

import * as demo from "./demoAdapter";
import * as http from "./httpClient";

export { ApiError } from "./demoAdapter";

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "1";

/** Canlı API'ye bağlanmış uçlar. */
export const LIVE_ENDPOINTS = [
  "layout",
  "imports",
  "data-quality",
  "picking-time",
  "reoptimize",
  "slot-plans",
  "move-tasks",
  "publish",
  "rollback",
] as const;

/**
 * Henüz golden dataset'ten okunan uçlar. Demo modunda olmasak bile bunlar
 * kurgusal veridir; arayüz bunu kullanıcıya açıkça söyler.
 */
export const FIXTURE_ENDPOINTS = [
  "overview",
] as const;

export const fetchLayout = DEMO_MODE ? demo.fetchLayout : http.fetchLayout;

// Veri girişi. Demo modunda doğrulama tarayıcıda gerçekten çalışır — aynı
// @gbsoft/domain motoru — ama yazma yapılmaz ve arayüz bunu söyler.
export const fetchImportTemplates = DEMO_MODE
  ? demo.fetchImportTemplates
  : http.fetchImportTemplates;
export const importTemplateUrl = DEMO_MODE
  ? demo.importTemplateUrl
  : http.importTemplateUrl;
export const uploadImport = DEMO_MODE ? demo.uploadImport : http.uploadImport;
export const fetchImportBatches = DEMO_MODE
  ? demo.fetchImportBatches
  : http.fetchImportBatches;
export const fetchImportBatch = DEMO_MODE
  ? demo.fetchImportBatch
  : http.fetchImportBatch;

export const fetchDataQuality = DEMO_MODE
  ? demo.fetchDataQuality
  : http.fetchDataQuality;

export const fetchPickingTime = DEMO_MODE
  ? demo.fetchPickingTime
  : http.fetchPickingTime;

// --- Aşağıdakiler Faz 5'te canlıya bağlanacak ---
export const fetchOverview = demo.fetchOverview;
export const fetchSkus = demo.fetchSkus;
export const fetchSlotPlan = DEMO_MODE ? demo.fetchSlotPlan : http.fetchSlotPlan;
export const fetchMoveTasks = DEMO_MODE ? demo.fetchMoveTasks : http.fetchMoveTasks;
export const fetchPlanVersions = DEMO_MODE ? demo.fetchPlanVersions : http.fetchPlanVersions;
export const reoptimize = DEMO_MODE ? demo.reoptimize : http.reoptimize;
export const publishMoveTasks = DEMO_MODE ? demo.publishMoveTasks : http.publishMoveTasks;
export const rollbackSlotPlan = DEMO_MODE ? demo.rollbackSlotPlan : http.rollbackSlotPlan;
