import type { Location } from "@gbsoft/domain";

/**
 * Isı haritası katmanları (§8.3). Rainbow palet kullanılmaz.
 *
 * Skalalar sabit eşiklerden değil, yüklenen lokasyon kümesinden hesaplanır;
 * böylece farklı tesislerde de doğru okunur.
 */

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

const fmt = (value: number, decimals = 0) =>
  new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);

type LayerSpec = {
  id: LayerId;
  label: string;
  unit: string;
  value: (loc: Location) => number;
  ramp: [string, string];
  decimals: number;
  lowLabel?: (min: number) => string;
  highLabel?: (max: number) => string;
};

const SPECS: LayerSpec[] = [
  {
    id: "pickTime",
    label: "Picking time",
    unit: "sn",
    value: (l) => l.pickTimeSec,
    ramp: ["#eef3f6", "#0b6e99"],
    decimals: 0,
    lowLabel: (min) => `${fmt(min)} sn`,
    highLabel: (max) => `${fmt(max)} sn`,
  },
  {
    id: "velocity",
    label: "Velocity",
    unit: "pick/gün",
    value: (l) => l.picksPerDay,
    ramp: ["#eef3f6", "#132c43"],
    decimals: 0,
    highLabel: (max) => `${fmt(max)} pick/gün`,
  },
  {
    id: "congestion",
    label: "Congestion",
    unit: "skor",
    value: (l) => l.congestionScore,
    ramp: ["#fbeceb", "#aa3f3a"],
    decimals: 2,
  },
  {
    id: "replenishment",
    label: "Replenishment",
    unit: "/gün",
    value: (l) => l.replenishmentsPerDay,
    ramp: ["#fff4dc", "#a76500"],
    decimals: 1,
    highLabel: (max) => `${fmt(max, 1)}/gün`,
  },
  {
    id: "dataQuality",
    label: "Veri kalitesi",
    unit: "",
    value: (l) => 1 - l.dataQuality,
    ramp: ["#eef3f6", "#66549c"],
    decimals: 2,
    lowLabel: () => "tam",
    highLabel: () => "eksik",
  },
];

const PLAN_CHANGE_LAYER: LayerDef = {
  id: "planChange",
  label: "Plan değişikliği",
  unit: "",
  value: () => 0,
  min: 0,
  max: 1,
  ramp: ["#f6f8fa", "#f6f8fa"],
  legendLow: "değişmiyor",
  legendHigh: "kaynak / hedef",
};

/** Yüklenen lokasyonlardan katman tanımlarını üretir. */
export function buildLayers(locations: readonly Location[]): LayerDef[] {
  const layers = SPECS.map((spec) => {
    const values = locations.map(spec.value);
    // Boş kümede skala 0-1'e düşer; harita yine çizilir.
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    return {
      id: spec.id,
      label: spec.label,
      unit: spec.unit,
      value: spec.value,
      min,
      // Bütün değerler eşitse rampanın çökmesini engelle.
      max: max > min ? max : min + 1,
      ramp: spec.ramp,
      legendLow: spec.lowLabel?.(min) ?? fmt(min, spec.decimals),
      legendHigh: spec.highLabel?.(max) ?? fmt(max, spec.decimals),
    } satisfies LayerDef;
  });

  return [...layers, PLAN_CHANGE_LAYER];
}

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
