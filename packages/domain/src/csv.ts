/**
 * CSV ayrıştırma ve hücre dönüşümü.
 *
 * Saf fonksiyonlardır: dosya sistemi, ağ veya kütüphane bağımlılığı yoktur.
 * Hem API (içe aktarma), hem arayüz (yükleme öncesi doğrulama) aynı kodu
 * kullanır; kullanıcı sunucuya göndermeden aynı hatayı görür.
 *
 * Türkçe Excel gerçeği: "CSV UTF-8" olarak kaydedilen dosya ayraç olarak
 * noktalı virgül, ondalık ayraç olarak virgül kullanır ve başına BOM koyar.
 * Üçü de burada ele alınır; kullanıcıdan dosyasını düzeltmesi istenmez.
 */

export type CsvRecord = {
  /** Dosyadaki 1 tabanlı satır numarası — hata raporu bunu gösterir. */
  line: number;
  cells: string[];
};

export type CsvTable = {
  /** Tespit edilen ayraç. Rapor bunu gösterir; sessiz varsayım yapılmaz. */
  delimiter: string;
  header: string[];
  headerLine: number;
  records: CsvRecord[];
};

const DELIMITERS = [",", ";", "\t"] as const;

/** Tırnak dışındaki ayraçları sayar; tırnak içindeki metin göz ardı edilir. */
function countOutsideQuotes(text: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) count += 1;
  }
  return count;
}

/** İlk satırdaki ayraç adaylarından en çok alan üretenini seçer. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best: string = ",";
  let bestCount = 0;
  for (const candidate of DELIMITERS) {
    const count = countOutsideQuotes(firstLine, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * RFC 4180 tarayıcısı. Tırnak içinde satır sonu ve kaçışlı tırnak ("")
 * desteklenir; tamamen boş satırlar atlanır ama satır numaraları kayar,
 * çünkü rapor kullanıcının dosyasındaki gerçek satırı göstermelidir.
 */
function scanRecords(text: string, delimiter: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let hasContent = false;

  const endField = () => {
    cells.push(field);
    field = "";
  };

  const endRecord = () => {
    endField();
    if (hasContent) records.push({ line: recordLine, cells });
    cells = [];
    hasContent = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
      hasContent = true;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      // Tırnaklı boş alan ("") da içerik sayılır: kullanıcı bilerek yazmıştır.
      hasContent = true;
      continue;
    }
    if (ch === delimiter) {
      endField();
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      endRecord();
      line += 1;
      recordLine = line;
      continue;
    }

    field += ch;
    if (ch.trim() !== "") hasContent = true;
  }

  endRecord();
  return records;
}

/** Başlık adlarını normalize eder: BOM, kenar boşluğu ve tırnak temizlenir. */
function normalizeHeader(raw: string): string {
  return raw.replace(/^\uFEFF/, "").trim();
}

export function parseCsv(text: string): CsvTable {
  const clean = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(clean);
  const records = scanRecords(clean, delimiter);

  if (records.length === 0) {
    return { delimiter, header: [], headerLine: 0, records: [] };
  }

  const [headerRecord, ...rest] = records;
  return {
    delimiter,
    header: headerRecord.cells.map(normalizeHeader),
    headerLine: headerRecord.line,
    records: rest,
  };
}

/* ------------------------------------------------------------------ */
/* Hücre dönüşümü                                                      */
/* ------------------------------------------------------------------ */

/**
 * Sayı okur. Hem "1.234,56" (tr) hem "1,234.56" (en) hem "1234.56" kabul
 * edilir: iki ayraç birlikte varsa sonuncusu ondalık ayraçtır.
 * Çözülemeyen değer için null döner — sessizce 0'a düşmez.
 */
export function parseNumberCell(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "");
  if (s === "") return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Tek virgül ondalıktır; birden çoksa binlik grup ayracıdır.
    normalized =
      (s.match(/,/g) ?? []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else {
    normalized =
      (s.match(/\./g) ?? []).length > 1 ? s.replace(/\./g, "") : s;
  }

  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const TRUE_WORDS = new Set(["true", "1", "evet", "e", "yes", "y", "var"]);
const FALSE_WORDS = new Set(["false", "0", "hayir", "hayır", "h", "no", "n", "yok"]);

export function parseBooleanCell(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (s === "") return null;
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return null;
}

/**
 * Tarih okur. ISO 8601 tercih edilir; Türkçe yazımlar (GG.AA.YYYY,
 * GG/AA/YYYY, isteğe bağlı saat) da kabul edilir ve yerel saat olarak
 * yorumlanır. Belirsiz biçimler için null döner.
 */
export function parseDateCell(raw: string): Date | null {
  const s = raw.trim();
  if (s === "") return null;

  if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(s)) {
    const value = new Date(s.replace(" ", "T"));
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const match = s.match(
    /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!match) return null;

  const [, day, month, year, hour, minute, second] = match;
  const value = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? 0),
    Number(minute ?? 0),
    Number(second ?? 0),
  );
  if (Number.isNaN(value.getTime())) return null;
  // 31.02.2026 gibi taşan tarihler sessizce 03.03'e kaymamalı.
  if (value.getDate() !== Number(day) || value.getMonth() !== Number(month) - 1) {
    return null;
  }
  return value;
}

/** Bir hücreyi CSV alanı olarak kaçışlar — şablon üretimi bunu kullanır. */
export function toCsvField(value: string, delimiter: string): string {
  if (value === "") return value;
  const needsQuotes =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: string[][], delimiter = ","): string {
  return rows
    .map((row) => row.map((cell) => toCsvField(cell, delimiter)).join(delimiter))
    .join("\r\n");
}
