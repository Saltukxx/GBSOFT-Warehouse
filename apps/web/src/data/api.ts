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
export const LIVE_ENDPOINTS = ["layout"] as const;

/**
 * Henüz golden dataset'ten okunan uçlar. Demo modunda olmasak bile bunlar
 * kurgusal veridir; arayüz bunu kullanıcıya açıkça söyler.
 */
export const FIXTURE_ENDPOINTS = [
  "overview",
  "picking-time",
  "slot-plans",
  "move-tasks",
  "data-quality",
  "reoptimize",
  "publish",
] as const;

export const fetchLayout = DEMO_MODE ? demo.fetchLayout : http.fetchLayout;

// --- Aşağıdakiler sırasıyla canlıya bağlanacak (Faz 1-5) ---
export const fetchOverview = demo.fetchOverview;
export const fetchSkus = demo.fetchSkus;
export const fetchPickingTime = demo.fetchPickingTime;
export const fetchSlotPlan = demo.fetchSlotPlan;
export const fetchMoveTasks = demo.fetchMoveTasks;
export const fetchPlanVersions = demo.fetchPlanVersions;
export const fetchDataQuality = demo.fetchDataQuality;
export const reoptimize = demo.reoptimize;
export const publishMoveTasks = demo.publishMoveTasks;
