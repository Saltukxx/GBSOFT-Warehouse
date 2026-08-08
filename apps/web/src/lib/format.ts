/** Türkçe sayı/tarih biçimlendirme. Ondalık ayırıcı virgüldür. */

const nf = (min: number, max: number) =>
  new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  });

export function num(value: number, decimals = 0): string {
  return nf(decimals, decimals).format(value);
}

/** Yüzde — işaretli. Örn. -7,6% */
export function pct(value: number, decimals = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${num(value, decimals)}%`;
}

/** İşaretsiz yüzde. Örn. %94 */
export function pctPlain(value: number, decimals = 0): string {
  return `%${num(value, decimals)}`;
}

/** Saniye — işaretli. Örn. +5,7 sn */
export function sec(value: number, decimals = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${num(value, decimals)} sn`;
}

export function secPlain(value: number, decimals = 1): string {
  return `${num(value, decimals)} sn`;
}

export function hours(value: number, decimals = 1): string {
  return `${num(value, decimals)} sa`;
}

export function signed(value: number, decimals = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${num(value, decimals)}`;
}

export function meters(value: number, decimals = 1): string {
  return `${num(value, decimals)} m`;
}

/** ISO tarihi 08.08.2026 14:32 biçimine çevirir. */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function timeOnly(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
