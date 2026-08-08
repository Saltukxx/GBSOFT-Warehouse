/**
 * Deterministik sayı üretimi.
 *
 * Demo hiçbir yerde Math.random kullanmaz (§15.4, §23/4). Aynı seed her
 * zaman aynı diziyi üretir; böylece harita, heatmap ve tablolar hard refresh
 * sonrası birebir aynı görünür.
 */

export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — küçük, hızlı ve tekrarlanabilir PRNG. */
export function makeRng(seed: number | string) {
  let a = typeof seed === "string" ? hashSeed(seed) : seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [min, max] aralığında `decimals` basamağa yuvarlanmış deterministik değer. */
export function seededRange(
  seed: string,
  min: number,
  max: number,
  decimals = 0,
): number {
  const value = min + makeRng(seed)() * (max - min);
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Fisher-Yates — seed'e bağlı deterministik karıştırma. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rng = makeRng(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
