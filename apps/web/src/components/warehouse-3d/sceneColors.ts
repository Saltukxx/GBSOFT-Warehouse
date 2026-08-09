import type { BayVolume, FloorAreaKind, ZoneId } from "@gbsoft/domain";
import type { LayerDef } from "../warehouse-map/layers";
import { rampColor } from "../warehouse-map/layers";

/**
 * Sahne renkleri.
 *
 * Isı katmanı renkleri 2B haritayla **aynı** `rampColor` fonksiyonundan gelir;
 * aynı göz iki ekranda farklı renkte görünemez. Buradaki ek renkler yalnız
 * 3B'ye özgü olan şeyler içindir: zemin, raf iskeleti, zon ve durum vurgusu.
 */

export const SCENE_PALETTE = {
  ground: "#e7edf1",
  gridLine: "#cfdae1",
  rackFrame: "#8fa3b0",
  /** Dikme — taşıyıcı çelik, gözlerden koyu olmalı ki çerçeve okunsun. */
  rackSteel: "#5c7382",
  rackBeam: "#8fa3b0",
  /** Reserve hücre: hacmi var, doluluk verisi yok. */
  reserve: "#526879",
  path: "#1684ad",
  dock: "#0e817d",
  staging: "#a76500",
  packing: "#66549c",
  crossAisle: "#aebec8",
  other: "#aebec8",
  blocked: "#aa3f3a",
  selected: "#0b1f33",
  // Rota rengi hiçbir zon rengiyle karışmamalı: mavi Zone A, teal Zone B,
  // amber Zone C, mor Zone D. Koyu mürekkep hepsinden ve açık zeminden ayrışır.
  route: "#0b1f33",
  routeHead: "#a76500",
} as const;

export const ZONE_COLORS: Record<ZoneId, string> = {
  A: "#0b6e99",
  B: "#0e817d",
  C: "#a76500",
  D: "#66549c",
};

export const FLOOR_COLORS: Record<FloorAreaKind, string> = {
  dock: SCENE_PALETTE.dock,
  staging: SCENE_PALETTE.staging,
  packing: SCENE_PALETTE.packing,
  "cross-aisle": SCENE_PALETTE.crossAisle,
  other: SCENE_PALETTE.other,
};

/**
 * Renk modu.
 *
 * `zone` ve `plan` ısı rampası kullanmaz; ikisi de kategorik katmandır ve
 * ısı katmanlarıyla aynı listede durur.
 */
export type ColorMode = "layer" | "zone" | "plan";

/** Aktif planın gözle ilişkisi — 2B'deki `planChange` katmanının karşılığı. */
export type PlanRole = "source" | "target" | "unchanged";

export const PLAN_ROLE_COLORS: Record<PlanRole, string> = {
  source: "#a76500",
  target: "#287b56",
  unchanged: "#d5dfe5",
};

export const PLAN_ROLE_LABELS: Record<PlanRole, string> = {
  source: "Boşalacak göz",
  target: "Dolacak göz",
  unchanged: "Değişmiyor",
};

/**
 * Gözün rengi.
 *
 * Bloklu göz her modda kırmızıdır: fiziksel olarak kapalı bir gözü ısı
 * değerine göre boyamak, kullanılamaz bir yeri kullanılabilir gibi gösterir.
 */
export function bayColor(
  bay: BayVolume,
  mode: ColorMode,
  layer: LayerDef,
  planRole?: PlanRole,
): string {
  if (bay.blocked) return SCENE_PALETTE.blocked;
  if (mode === "zone") return ZONE_COLORS[bay.zone] ?? SCENE_PALETTE.rackFrame;
  if (mode === "plan") return PLAN_ROLE_COLORS[planRole ?? "unchanged"];
  return rampColor(layer, layer.value(bay));
}
