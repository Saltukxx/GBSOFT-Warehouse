/**
 * İçe aktarma sözleşmesi.
 *
 * Müşteri yok senaryosunda konektör yerine kendi giriş yüzeyimiz var: veri
 * CSV şablonlarıyla girilir. Şablon tanımı burada, tek yerde durur; API
 * doğrulamayı bununla yapar, arayüz aynı tanımdan hem kolon dokümantasyonunu
 * hem indirilebilir şablonu üretir. İkisinin ayrı düşmesi mümkün değildir.
 *
 * İlke (PDF §17): hatalı kayıt sessizce atılmaz. Her reddedilen satır,
 * satır numarası, kolonu ve nedeniyle rapora girer.
 */

import { parseCsv, parseBooleanCell, parseDateCell, parseNumberCell } from "./csv.js";

/* ------------------------------------------------------------------ */
/* Tipler                                                              */
/* ------------------------------------------------------------------ */

export type ImportKind =
  | "layout"
  | "floor-area"
  | "sku"
  | "velocity"
  | "wave"
  | "pick-task";

export const IMPORT_KINDS: readonly ImportKind[] = [
  "layout",
  "floor-area",
  "sku",
  "velocity",
  "wave",
  "pick-task",
];

export function isImportKind(value: string): value is ImportKind {
  return (IMPORT_KINDS as readonly string[]).includes(value);
}

export type ImportColumnType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "enum";

export type ImportColumn = {
  name: string;
  type: ImportColumnType;
  required: boolean;
  description: string;
  example: string;
  enumValues?: readonly string[];
  min?: number;
  max?: number;
};

/**
 * Hatalı satır politikası.
 *
 * `partial`  — geçerli satırlar yazılır, hatalılar raporlanır.
 * `all-or-nothing` — tek hata bile dosyanın tamamını reddeder. Geometri
 * böyledir: yarım yazılmış bir dijital ikiz, hiç yazılmamışından kötüdür.
 */
export type ImportRejectPolicy = "partial" | "all-or-nothing";

export type ImportTemplate = {
  kind: ImportKind;
  title: string;
  description: string;
  /** Bu şablonun yazdığı tablolar — kullanıcı ne olacağını önceden görür. */
  targets: string[];
  rejectPolicy: ImportRejectPolicy;
  /** Bu türden önce yüklenmiş olması gereken türler. */
  requires: ImportKind[];
  columns: ImportColumn[];
  sampleRows: string[][];
};

export type ImportSeverity = "error" | "warning";

export type ImportIssue = {
  /** Dosyadaki 1 tabanlı satır. 0 ise sorun dosya seviyesindedir. */
  line: number;
  column?: string;
  code: string;
  message: string;
  severity: ImportSeverity;
  /** Sorunlu ham değer — kullanıcı dosyasında arayabilsin diye. */
  value?: string;
};

export type ImportCellValue = string | number | boolean | Date | null;

export type ImportRow = {
  line: number;
  values: Record<string, ImportCellValue>;
};

export type ImportValidation = {
  kind: ImportKind;
  delimiter: string;
  rowsTotal: number;
  /** Yalnız hatasız satırlar. */
  rows: ImportRow[];
  issues: ImportIssue[];
  /** Dosya bütünüyle reddedildi (başlık hatası veya all-or-nothing ihlali). */
  fatal: boolean;
};

export type ImportStatus = "VALIDATED" | "APPLIED" | "REJECTED";

/** Yükleme sonucunun tam raporu — hem yanıt gövdesi hem ImportBatch.report. */
export type ImportReport = {
  batchId: string | null;
  kind: ImportKind;
  fileName: string;
  facilityCode: string;
  /** true ise hiçbir şey yazılmadı; yalnız doğrulama yapıldı. */
  dryRun: boolean;
  status: ImportStatus;
  delimiter: string;
  rowsTotal: number;
  rowsAccepted: number;
  rowsRejected: number;
  issues: ImportIssue[];
  /** Rapor kırpıldıysa true; sayaçlar yine tam sayıyı gösterir. */
  issuesTruncated: boolean;
  errorCount: number;
  warningCount: number;
  /** İnsan tarafından okunan sonuç: "1 ikiz sürümü · 96 lokasyon". */
  summary: string[];
  startedAt: string;
  finishedAt: string;
  correlationId?: string;
};

export type ImportBatchSummary = {
  id: string;
  kind: ImportKind;
  fileName: string;
  status: ImportStatus;
  dryRun: boolean;
  rowsTotal: number;
  rowsAccepted: number;
  rowsRejected: number;
  createdAt: string;
};

/** Layout içe aktarımının satırlardan okunamayan üst bilgileri. */
export type LayoutImportOptions = {
  version?: number;
  viewBoxWidth?: number;
  viewBoxHeight?: number;
  unitsPerMeter?: number;
  dockAnchorX?: number;
  dockAnchorY?: number;
  note?: string;
  /** Yazıldıktan sonra bu sürüm aktif ikiz olsun mu? */
  activate?: boolean;
};

/* ------------------------------------------------------------------ */
/* Şablonlar                                                           */
/* ------------------------------------------------------------------ */

function col(
  name: string,
  type: ImportColumnType,
  required: boolean,
  description: string,
  example: string,
  extra: Partial<Pick<ImportColumn, "enumValues" | "min" | "max">> = {},
): ImportColumn {
  return { name, type, required, description, example, ...extra };
}

const LAYOUT_TEMPLATE: ImportTemplate = {
  kind: "layout",
  title: "Tesis geometrisi ve göz kapasitesi",
  description:
    "Her satır bir pick gözüdür. Zon, koridor ve raf yüzü satırlardan " +
    "türetilir; tekrar eden değerlerin tutarlı olması beklenir. Yükleme " +
    "yeni bir dijital ikiz sürümü açar, mevcut sürümü değiştirmez.",
  targets: ["LayoutVersion", "Zone", "Aisle", "RackFace", "Location"],
  rejectPolicy: "all-or-nothing",
  requires: [],
  columns: [
    col("zoneCode", "string", true, "Zon kodu.", "A"),
    col("zoneName", "string", true, "Zon adı. Aynı kod için tutarlı olmalı.", "Hızlı hareket"),
    col("aisleNumber", "integer", true, "Koridor numarası.", "3", { min: 1 }),
    col("aisleX", "number", true, "Koridorun sol raf yüzünün x konumu.", "192"),
    col("walkwayWidth", "number", true, "Yürüme koridoru genişliği.", "20", { min: 0 }),
    col("aisleCongestion", "number", false, "0-1 arası koridor yoğunluğu. Boşsa 0.", "0,86", { min: 0, max: 1 }),
    col("side", "enum", true, "Gözün bağlı olduğu raf yüzü.", "left", {
      enumValues: ["left", "right"],
    }),
    col("faceX", "number", true, "Raf yüzünün x konumu.", "192"),
    col("faceWidth", "number", true, "Raf yüzünün genişliği.", "28", { min: 0 }),
    col("locationCode", "string", true, "Göz kodu. Dosya içinde benzersiz.", "A-03-02"),
    col("bay", "integer", true, "Koridor boyunca göz sırası; 1 dock'a en yakın.", "2", { min: 1 }),
    col("level", "integer", true, "Raf yüksekliği kademesi; 2 bel hizası.", "2", { min: 1 }),
    col("x", "number", true, "Gözün sol kenarı.", "192"),
    col("y", "number", true, "Gözün üst kenarı.", "108"),
    col("width", "number", true, "Göz genişliği.", "28", { min: 0 }),
    col("height", "number", true, "Göz yüksekliği.", "62", { min: 0 }),
    col("maxWeightKg", "number", true, "Taşıma kapasitesi. Hard constraint kaynağı.", "420", { min: 0 }),
    col("maxVolumeM3", "number", true, "Hacim kapasitesi. Hard constraint kaynağı.", "1,8", { min: 0 }),
    col("equipment", "enum", true, "Gözün gerektirdiği ekipman sınıfı.", "manual", {
      enumValues: ["manual", "cart", "forklift"],
    }),
    col("goldenZone", "boolean", true, "Bel hizası altın bölge mi?", "evet"),
    col("distanceToDockM", "number", true, "Dock'a yürüme mesafesi (m).", "34,5", { min: 0 }),
    col("congestionScore", "number", false, "Göz bazlı yoğunluk. Boşsa koridordan alınır.", "0,86", { min: 0, max: 1 }),
    col("blocked", "boolean", false, "Fiziksel olarak picking'e kapalı mı?", "hayır"),
    col("blockedReason", "string", false, "blocked=evet ise zorunlu.", ""),
    col("dataQuality", "number", false, "Kapasite verisi doğrulanmadıysa 1'in altında.", "1", { min: 0, max: 1 }),
  ],
  sampleRows: [
    // Göz 1 dock'a en yakındır ve haritanın altında durur; y yukarı doğru azalır.
    ["A", "Hızlı hareket", "3", "192", "20", "0,86", "left", "192", "28", "A-03-01", "1", "2", "192", "270", "28", "62", "420", "1,8", "manual", "evet", "28,4", "0,86", "hayır", "", "1"],
    ["A", "Hızlı hareket", "3", "192", "20", "0,86", "left", "192", "28", "A-03-02", "2", "2", "192", "202", "28", "62", "420", "1,8", "manual", "evet", "34,5", "0,86", "hayır", "", "1"],
    ["B", "Orta hareket", "3", "192", "20", "0,86", "right", "240", "28", "B-03-01", "1", "2", "240", "270", "28", "62", "380", "1,6", "cart", "hayır", "31,2", "0,72", "hayır", "", "1"],
  ],
};

const FLOOR_AREA_TEMPLATE: ImportTemplate = {
  kind: "floor-area",
  title: "Raf dışı alanlar",
  description:
    "Dock, staging, paketleme ve cross-aisle şeritleri. Haritada bağlam " +
    "verirler; cross-aisle koridor ayrımı olarak çizilir. Aktif dijital " +
    "ikiz sürümüne yazılır.",
  targets: ["FloorArea"],
  rejectPolicy: "partial",
  requires: ["layout"],
  columns: [
    col("code", "string", true, "Alan kodu. İkiz sürümü içinde benzersiz.", "DOCK-1"),
    col("label", "string", true, "Haritada görünen ad.", "Sevkiyat kapısı 1"),
    col("kind", "enum", true, "Alan türü.", "dock", {
      enumValues: ["dock", "staging", "packing", "cross-aisle", "other"],
    }),
    col("x", "number", true, "Sol kenar.", "120"),
    col("y", "number", true, "Üst kenar.", "360"),
    col("width", "number", true, "Genişlik.", "60", { min: 0 }),
    col("height", "number", true, "Yükseklik.", "40", { min: 0 }),
  ],
  sampleRows: [
    ["DOCK-1", "Sevkiyat kapısı 1", "dock", "120", "360", "60", "40"],
    ["CROSS-1", "Cross-aisle", "cross-aisle", "40", "176", "920", "20"],
  ],
};

const SKU_TEMPLATE: ImportTemplate = {
  kind: "sku",
  title: "SKU master, ölçü ve ağırlık",
  description:
    "Ürün ana verisi. Ölçü ve ağırlık ayrı tutulur: kaynağı, ölçüm zamanı " +
    "ve toleransı kayıtlıdır. Ölçüsü olmayan SKU slot planına alınmaz ve " +
    "bu bir uyarı olarak raporlanır. Kaynak sistem kimliği asla üzerine " +
    "yazılmaz; başka bir SKU'ya bağlıysa satır reddedilir.",
  targets: ["Sku", "SkuDimension", "SkuPlacement", "IdentityMap"],
  rejectPolicy: "partial",
  requires: [],
  columns: [
    col("code", "string", true, "Kanonik SKU kodu.", "SKU-184"),
    col("name", "string", true, "Ürün adı.", "Kablosuz kulaklık"),
    col("category", "string", true, "Kategori.", "Elektronik"),
    col("handling", "enum", false, "Elleçleme sınıfı. Boşsa standard.", "standard", {
      enumValues: ["standard", "fragile", "heavy"],
    }),
    col("widthCm", "number", false, "Genişlik (cm).", "18,5", { min: 0 }),
    col("depthCm", "number", false, "Derinlik (cm).", "12", { min: 0 }),
    col("heightCm", "number", false, "Yükseklik (cm).", "8", { min: 0 }),
    col("weightKg", "number", false, "Ağırlık (kg).", "0,42", { min: 0 }),
    col("dimensionSource", "enum", false, "Ölçünün kaynağı. Boşsa import.", "dimensioner", {
      enumValues: ["manual", "wms", "dimensioner", "import"],
    }),
    col("measuredAt", "date", false, "Ölçüm zamanı.", "2026-07-28"),
    col("toleranceP", "number", false, "Ölçü toleransı (oran). Boşsa 0,05.", "0,05", { min: 0, max: 1 }),
    col("currentLocationCode", "string", false, "Mevcut pick gözü. Boşsa rezervde sayılır.", "A-03-02"),
    col("sourceSystem", "string", false, "Kaynak sistem adı.", "SAP-EWM"),
    col("sourceId", "string", false, "Kaynak sistemdeki kimlik.", "000000000184"),
    col("gtin", "string", false, "Barkod.", "8690000001842"),
  ],
  sampleRows: [
    ["SKU-184", "Kablosuz kulaklık", "Elektronik", "standard", "18,5", "12", "8", "0,42", "dimensioner", "2026-07-28", "0,05", "A-03-02", "SAP-EWM", "000000000184", "8690000001842"],
    ["SKU-072", "Cam sürahi", "Mutfak", "fragile", "14", "14", "26", "0,88", "manual", "2026-06-02", "0,1", "B-05-01", "SAP-EWM", "000000000072", ""],
  ],
};

const VELOCITY_TEMPLATE: ImportTemplate = {
  kind: "velocity",
  title: "Hız anlık görüntüsü",
  description:
    "Belirli bir ölçüm penceresinde SKU hızı. Plan hangi snapshot ile " +
    "üretildiyse onu referans alır; sonradan gelen veri geçmiş planı " +
    "değiştirmez. Aynı SKU ve pencere için tekrar yükleme değeri günceller.",
  targets: ["VelocitySnapshot"],
  rejectPolicy: "partial",
  requires: ["sku"],
  columns: [
    col("skuCode", "string", true, "Kanonik SKU kodu. Kayıtlı olmalı.", "SKU-184"),
    col("windowStart", "date", true, "Ölçüm penceresi başlangıcı.", "2026-07-25"),
    col("windowEnd", "date", true, "Ölçüm penceresi sonu.", "2026-08-08"),
    col("velocityClass", "enum", true, "Hız sınıfı.", "A", { enumValues: ["A", "B", "C"] }),
    col("picksPerDay", "number", true, "Günlük toplama sayısı.", "24,5", { min: 0 }),
    col("unitsPerPick", "number", true, "Toplama başına adet.", "1,8", { min: 0 }),
    col("replenishmentsPerDay", "number", true, "Günlük ikmal sayısı.", "0,8", { min: 0 }),
  ],
  sampleRows: [
    ["SKU-184", "2026-07-25", "2026-08-08", "A", "24,5", "1,8", "0,8"],
    ["SKU-072", "2026-07-25", "2026-08-08", "C", "1,2", "1", "0,1"],
  ],
};

const WAVE_TEMPLATE: ImportTemplate = {
  kind: "wave",
  title: "Dalga (wave) geçmişi",
  description:
    "Sipariş dalgalarının planlanan başlangıcı, SLA kesimi ve satır sayısı. " +
    "Görev olayları bu dalgalara bağlanır.",
  targets: ["Wave"],
  rejectPolicy: "partial",
  requires: [],
  columns: [
    col("code", "string", true, "Dalga kodu. Tesis içinde benzersiz.", "W-2240"),
    col("plannedStart", "date", true, "Planlanan başlangıç.", "2026-08-08 08:00"),
    col("slaCutoff", "date", true, "SLA kesim saati.", "2026-08-08 18:00"),
    col("status", "string", true, "Durum: acik, risk, kapali.", "acik"),
    col("orderLines", "integer", true, "Dalgadaki sipariş satırı sayısı.", "74", { min: 0 }),
  ],
  sampleRows: [
    ["W-2240", "2026-08-08 08:00", "2026-08-08 18:00", "acik", "74"],
    ["W-2241", "2026-08-08 08:15", "2026-08-08 18:00", "risk", "74"],
  ],
};

const PICK_TASK_TEMPLATE: ImportTemplate = {
  kind: "pick-task",
  title: "Toplama görevi olayları",
  description:
    "Gerçekleşen toplama görevleri. Süre modelinin etiket kaynağıdır: " +
    "başlangıç/bitiş çiftinden süre üretilir ve TASK_STARTED / " +
    "TASK_COMPLETED olayları yazılır. Olayın sahada gerçekleştiği an " +
    "(eventTime) ile sisteme ulaştığı an (ingestTime) ayrı tutulur.",
  targets: ["PickTask", "Event"],
  rejectPolicy: "partial",
  requires: ["wave"],
  columns: [
    col("waveCode", "string", true, "Görevin bağlı olduğu dalga. Kayıtlı olmalı.", "W-2240"),
    col("sourceId", "string", false, "Kaynak WMS görev kimliği. Tekrar yüklemeyi engeller.", "TSK-99412"),
    col("skuCode", "string", true, "Toplanan SKU.", "SKU-184"),
    col("locationCode", "string", true, "Toplandığı göz.", "A-03-02"),
    col("quantity", "integer", true, "Toplanan adet.", "2", { min: 0 }),
    col("startedAt", "date", false, "Görevin başladığı an.", "2026-08-08 09:14:02"),
    col("completedAt", "date", false, "Görevin bittiği an.", "2026-08-08 09:15:11"),
    col("durationSec", "number", false, "Ölçülen süre. Boşsa başlangıç/bitişten hesaplanır.", "69", { min: 0 }),
    col("operatorRef", "string", false, "Operatör takma kimliği. KVKK gereği maskeli tutulur.", "OP-17"),
    col("exceptionCode", "string", false, "İstisna neden kodu.", ""),
  ],
  sampleRows: [
    ["W-2240", "TSK-99412", "SKU-184", "A-03-02", "2", "2026-08-08 09:14:02", "2026-08-08 09:15:11", "", "OP-17", ""],
    ["W-2240", "TSK-99413", "SKU-072", "B-05-01", "1", "2026-08-08 09:15:40", "2026-08-08 09:17:02", "", "OP-17", "STOK-YOK"],
  ],
};

export const IMPORT_TEMPLATES: Record<ImportKind, ImportTemplate> = {
  layout: LAYOUT_TEMPLATE,
  "floor-area": FLOOR_AREA_TEMPLATE,
  sku: SKU_TEMPLATE,
  velocity: VELOCITY_TEMPLATE,
  wave: WAVE_TEMPLATE,
  "pick-task": PICK_TASK_TEMPLATE,
};

/** Şablonun indirilebilir CSV karşılığı: başlık + örnek satırlar. */
export function templateToCsvRows(template: ImportTemplate): string[][] {
  return [template.columns.map((c) => c.name), ...template.sampleRows];
}

/* ------------------------------------------------------------------ */
/* Doğrulama                                                           */
/* ------------------------------------------------------------------ */

function typeLabel(column: ImportColumn): string {
  switch (column.type) {
    case "integer":
      return "tam sayı";
    case "number":
      return "sayı";
    case "boolean":
      return "evet/hayır";
    case "date":
      return "tarih (2026-08-08 veya 08.08.2026)";
    case "enum":
      return (column.enumValues ?? []).join(" | ");
    default:
      return "metin";
  }
}

function coerce(
  column: ImportColumn,
  raw: string,
  line: number,
): { value: ImportCellValue; issue?: ImportIssue } {
  const trimmed = raw.trim();

  if (trimmed === "") {
    if (column.required) {
      return {
        value: null,
        issue: {
          line,
          column: column.name,
          code: "zorunlu",
          message: `${column.name} zorunludur, boş bırakılamaz.`,
          severity: "error",
        },
      };
    }
    return { value: null };
  }

  const typeError = (): ImportIssue => ({
    line,
    column: column.name,
    code: "bicim",
    message: `${column.name} ${typeLabel(column)} olmalı.`,
    severity: "error",
    value: trimmed,
  });

  switch (column.type) {
    case "string":
      return { value: trimmed };

    case "enum": {
      const allowed = column.enumValues ?? [];
      // Kod değerleri küçük harf kabul edilir; zon kodu gibi büyük harfli
      // listelerde birebir eşleşme aranır.
      const match = allowed.find(
        (option) => option.toLowerCase() === trimmed.toLowerCase(),
      );
      if (!match) {
        return {
          value: null,
          issue: {
            line,
            column: column.name,
            code: "gecersiz-deger",
            message: `${column.name} şunlardan biri olmalı: ${allowed.join(", ")}.`,
            severity: "error",
            value: trimmed,
          },
        };
      }
      return { value: match };
    }

    case "number":
    case "integer": {
      const parsed = parseNumberCell(trimmed);
      if (parsed === null) return { value: null, issue: typeError() };
      if (column.type === "integer" && !Number.isInteger(parsed)) {
        return { value: null, issue: typeError() };
      }
      if (column.min !== undefined && parsed < column.min) {
        return {
          value: null,
          issue: {
            line,
            column: column.name,
            code: "aralik",
            message: `${column.name} en az ${column.min} olmalı.`,
            severity: "error",
            value: trimmed,
          },
        };
      }
      if (column.max !== undefined && parsed > column.max) {
        return {
          value: null,
          issue: {
            line,
            column: column.name,
            code: "aralik",
            message: `${column.name} en fazla ${column.max} olabilir.`,
            severity: "error",
            value: trimmed,
          },
        };
      }
      return { value: parsed };
    }

    case "boolean": {
      const parsed = parseBooleanCell(trimmed);
      return parsed === null
        ? { value: null, issue: typeError() }
        : { value: parsed };
    }

    case "date": {
      const parsed = parseDateCell(trimmed);
      return parsed === null
        ? { value: null, issue: typeError() }
        : { value: parsed };
    }
  }
}

/**
 * CSV metnini şablona göre doğrular.
 *
 * Yalnız kolon bazlı kurallar burada işletilir. Kayıt bütünlüğü (aynı kodun
 * tekrarı, var olmayan SKU'ya atıf, tutarsız koridor geometrisi) çağıran
 * tarafın işidir; bunlar veritabanı bağlamı gerektirir.
 */
export function validateImportCsv(
  kind: ImportKind,
  text: string,
): ImportValidation {
  const template = IMPORT_TEMPLATES[kind];
  const table = parseCsv(text);
  const issues: ImportIssue[] = [];

  if (table.header.length === 0) {
    return {
      kind,
      delimiter: table.delimiter,
      rowsTotal: 0,
      rows: [],
      issues: [
        {
          line: 0,
          code: "bos-dosya",
          message: "Dosya boş veya başlık satırı okunamadı.",
          severity: "error",
        },
      ],
      fatal: true,
    };
  }

  // --- Başlık kontrolü -------------------------------------------------
  const headerIndex = new Map<string, number>();
  table.header.forEach((name, index) => {
    if (!headerIndex.has(name)) headerIndex.set(name, index);
  });

  const missing = template.columns
    .filter((c) => c.required && !headerIndex.has(c.name))
    .map((c) => c.name);

  for (const name of missing) {
    issues.push({
      line: table.headerLine,
      column: name,
      code: "eksik-kolon",
      message: `Zorunlu kolon eksik: ${name}.`,
      severity: "error",
    });
  }

  const known = new Set(template.columns.map((c) => c.name));
  for (const name of table.header) {
    if (name !== "" && !known.has(name)) {
      issues.push({
        line: table.headerLine,
        column: name,
        code: "bilinmeyen-kolon",
        message: `Bilinmeyen kolon yok sayıldı: ${name}.`,
        severity: "warning",
      });
    }
  }

  // Zorunlu kolon eksikse satırları okumanın anlamı yok.
  if (missing.length > 0) {
    return {
      kind,
      delimiter: table.delimiter,
      rowsTotal: table.records.length,
      rows: [],
      issues,
      fatal: true,
    };
  }

  // --- Satırlar --------------------------------------------------------
  const rows: ImportRow[] = [];

  for (const record of table.records) {
    const rowIssues: ImportIssue[] = [];

    if (record.cells.length !== table.header.length) {
      issues.push({
        line: record.line,
        code: "kolon-sayisi",
        message:
          `Satırda ${record.cells.length} alan var, başlıkta ` +
          `${table.header.length} kolon bekleniyor.`,
        severity: "error",
      });
      continue;
    }

    const values: Record<string, ImportCellValue> = {};

    for (const column of template.columns) {
      const index = headerIndex.get(column.name);
      const raw = index === undefined ? "" : (record.cells[index] ?? "");
      const { value, issue } = coerce(column, raw, record.line);
      if (issue) rowIssues.push(issue);
      values[column.name] = value;
    }

    issues.push(...rowIssues);
    if (rowIssues.length === 0) rows.push({ line: record.line, values });
  }

  const hasError = issues.some((i) => i.severity === "error");

  return {
    kind,
    delimiter: table.delimiter,
    rowsTotal: table.records.length,
    // all-or-nothing türlerde tek hata bütün dosyayı düşürür.
    rows: hasError && template.rejectPolicy === "all-or-nothing" ? [] : rows,
    issues,
    fatal: hasError && template.rejectPolicy === "all-or-nothing",
  };
}

/* ------------------------------------------------------------------ */
/* Satır okuyucular — applier'lar için                                 */
/* ------------------------------------------------------------------ */

export function readString(row: ImportRow, column: string): string | null {
  const value = row.values[column];
  return typeof value === "string" && value !== "" ? value : null;
}

export function readNumber(row: ImportRow, column: string): number | null {
  const value = row.values[column];
  return typeof value === "number" ? value : null;
}

export function readBoolean(row: ImportRow, column: string): boolean | null {
  const value = row.values[column];
  return typeof value === "boolean" ? value : null;
}

export function readDate(row: ImportRow, column: string): Date | null {
  const value = row.values[column];
  return value instanceof Date ? value : null;
}

/**
 * Zorunlu kolonu okur. Doğrulayıcı bu kolonun dolu olduğunu garanti eder;
 * buraya null gelirse şablon ile applier arasında tutarsızlık var demektir
 * — kullanıcı hatası değil, program hatasıdır.
 */
function required<T>(value: T | null, column: string, line: number): T {
  if (value === null) {
    throw new Error(
      `Şablon tutarsızlığı: ${column} kolonu ${line}. satırda zorunlu ama boş geldi.`,
    );
  }
  return value;
}

export function reqString(row: ImportRow, column: string): string {
  return required(readString(row, column), column, row.line);
}

export function reqNumber(row: ImportRow, column: string): number {
  return required(readNumber(row, column), column, row.line);
}

export function reqBoolean(row: ImportRow, column: string): boolean {
  return required(readBoolean(row, column), column, row.line);
}

export function reqDate(row: ImportRow, column: string): Date {
  return required(readDate(row, column), column, row.line);
}
