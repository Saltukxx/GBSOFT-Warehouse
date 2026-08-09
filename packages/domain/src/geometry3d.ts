/**
 * 3B geometri ilkelleri.
 *
 * Sahne (`scene3d.ts`) ve raf yapısı (`rack.ts`) bu tipleri paylaşır. Ayrı bir
 * dosyada durmalarının sebebi teknik: sahne rafı kurar, raf da sahnenin
 * kutusunu kullanır — tipler ortak bir yerde olmasa iki modül birbirini
 * import ederdi.
 *
 * Kanonik birim **metre**dir. Koordinat sistemi three.js sağ el kuralı, Y
 * yukarı: `x` doğu, `z` güney, `y` kot. Zemin `y = 0`.
 */

export type Vec3 = { x: number; y: number; z: number };

/** Eksen hizalı kutu: taban merkezi + boyut. `center.y` taban kotudur. */
export type Box3D = {
  center: Vec3;
  size: { x: number; y: number; z: number };
};

/**
 * Geometrinin ölçülmüş mü türetilmiş mi olduğu.
 *
 * Sahne bunu gizlemez: ölçülmemiş bir raf kotunu ölçülmüş gibi göstermek,
 * kullanıcıya sahip olmadığı bir kesinliği satmak olurdu.
 */
export type GeometrySource = "measured" | "derived";

const PRECISION = 1_000;

/** Milimetreye yuvarlar. Sahne çıktısı deterministik olmak zorunda. */
export function roundM(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

/** Ölçülmüş sayı mı — `null`, `undefined`, `NaN` ve negatif değerler değildir. */
export function isMeasured(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
