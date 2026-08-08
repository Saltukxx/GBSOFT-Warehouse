import type { Location } from "../../domain/warehouse";
import { LOCATION_STATS } from "../../data/fixtures/layout";

/** Isı haritası katmanları (§8.3). Rainbow palet kullanılmaz. */

const fmt = (value: number, decimals = 0) =>
  new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);

export type LayerId =
  | "pickTime"
  | "velocity"
  | "congestion"
  | "replenishment"
  | "dataQuality"
  | "planChange";

export type LayerDef = {
  id: LayerId;
  label: string;
  unit: string;
  /** Değeri okur; planChange katmanı ayrı ele alınır. */
  value: (loc: Location) => number;
  min: number;
  max: number;
  /** Tek hue rampası: açık → koyu. */
  ramp: [string, string];
  legendLow: string;
  legendHigh: string;
};

export const LAYERS: LayerDef[] = [
  {
    id: "pickTime",
    label: "Picking time",
    unit: "sn",
    value: (l) => l.pickTimeSec,
    min: LOCATION_STATS.pickTime.min,
    max: LOCATION_STATS.pickTime.max,
    ramp: ["#eef3f6", "#0b6e99"],
    legendLow: `${fmt(LOCATION_STATS.pickTime.min)} sn`,
    legendHigh: `${fmt(LOCATION_STATS.pickTime.max)} sn`,
  },
  {
    id: "velocity",
    label: "Velocity",
    unit: "pick/gün",
    value: (l) => l.picksPerDay,
    min: LOCATION_STATS.picks.min,
    max: LOCATION_STATS.picks.max,
    ramp: ["#eef3f6", "#132c43"],
    legendLow: `${fmt(LOCATION_STATS.picks.min)}`,
    legendHigh: `${fmt(LOCATION_STATS.picks.max)} pick/gün`,
  },
  {
    id: "congestion",
    label: "Congestion",
    unit: "skor",
    value: (l) => l.congestionScore,
    min: LOCATION_STATS.congestion.min,
    max: LOCATION_STATS.congestion.max,
    ramp: ["#fbeceb", "#aa3f3a"],
    legendLow: fmt(LOCATION_STATS.congestion.min, 2),
    legendHigh: fmt(LOCATION_STATS.congestion.max, 2),
  },
  {
    id: "replenishment",
    label: "Replenishment",
    unit: "/gün",
    value: (l) => l.replenishmentsPerDay,
    min: LOCATION_STATS.replenishment.min,
    max: LOCATION_STATS.replenishment.max,
    ramp: ["#fff4dc", "#a76500"],
    legendLow: fmt(LOCATION_STATS.replenishment.min, 1),
    legendHigh: `${fmt(LOCATION_STATS.replenishment.max, 1)}/gün`,
  },
  {
    id: "dataQuality",
    label: "Veri kalitesi",
    unit: "",
    value: (l) => 1 - l.dataQuality,
    min: 0,
    max: 1,
    ramp: ["#eef3f6", "#66549c"],
    legendLow: "tam",
    legendHigh: "eksik",
  },
  {
    id: "planChange",
    label: "Plan değişikliği",
    unit: "",
    value: () => 0,
    min: 0,
    max: 1,
    ramp: ["#f6f8fa", "#f6f8fa"],
    legendLow: "değişmiyor",
    legendHigh: "kaynak / hedef",
  },
];

export const LAYER_BY_ID = new Map(LAYERS.map((l) => [l.id, l]));

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

export function rampColor(layer: LayerDef, value: number): string {
  const t = Math.max(
    0,
    Math.min(1, (value - layer.min) / (layer.max - layer.min)),
  );
  const [r1, g1, b1] = hexToRgb(layer.ramp[0]);
  const [r2, g2, b2] = hexToRgb(layer.ramp[1]);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
}

/** Koyu zeminde okunur metin rengi. */
export function contrastInk(layer: LayerDef, value: number): string {
  const t = Math.max(
    0,
    Math.min(1, (value - layer.min) / (layer.max - layer.min)),
  );
  return t > 0.55 ? "#ffffff" : "var(--ink-700)";
}
