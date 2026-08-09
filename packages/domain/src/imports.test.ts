import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  parseCsv,
  parseDateCell,
  parseNumberCell,
  toCsv,
} from "./csv.js";
import {
  IMPORT_KINDS,
  IMPORT_TEMPLATES,
  templateToCsvRows,
  validateImportCsv,
} from "./imports.js";

describe("CSV ayrıştırıcı", () => {
  it("virgül, noktalı virgül ve sekme ayracını tanır", () => {
    expect(detectDelimiter("a,b,c")).toBe(",");
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
  });

  it("tırnak içindeki ayracı ayraç saymaz", () => {
    // Türkçe Excel çıktısı: ; ayraç, alan içinde virgül var.
    const table = parseCsv('kod;ad\nSKU-1;"Kulaklık, kablosuz"');
    expect(table.delimiter).toBe(";");
    expect(table.records[0].cells).toEqual(["SKU-1", "Kulaklık, kablosuz"]);
  });

  it("BOM'u atar ve kaçışlı tırnağı çözer", () => {
    // Excel, alan içindeki tırnağı ikizleyerek yazar: "15"" ekran".
    const table = parseCsv('\uFEFFkod,ad\nSKU-1,"15"" ekran"');
    expect(table.header).toEqual(["kod", "ad"]);
    expect(table.records[0].cells[1]).toBe('15" ekran');
  });

  it("tırnak içindeki satır sonunu tek alan sayar ve satır numarasını korur", () => {
    const table = parseCsv('kod,not\nSKU-1,"birinci\nikinci"\nSKU-2,tek');
    expect(table.records).toHaveLength(2);
    expect(table.records[0].cells[1]).toBe("birinci\nikinci");
    // İkinci kayıt dosyada 4. satırdadır; rapor bunu göstermelidir.
    expect(table.records[1].line).toBe(4);
  });

  it("tamamen boş satırları atlar", () => {
    const table = parseCsv("kod,ad\nSKU-1,A\n\n\nSKU-2,B\n");
    expect(table.records.map((r) => r.line)).toEqual([2, 5]);
  });
});

describe("sayı okuma", () => {
  it("Türkçe ve İngilizce ondalık yazımını çözer", () => {
    expect(parseNumberCell("1.234,56")).toBe(1234.56);
    expect(parseNumberCell("1,234.56")).toBe(1234.56);
    expect(parseNumberCell("0,86")).toBe(0.86);
    expect(parseNumberCell("34.5")).toBe(34.5);
    expect(parseNumberCell("-2")).toBe(-2);
  });

  it("birden çok grup ayracını binlik sayar", () => {
    expect(parseNumberCell("1.234.567")).toBe(1234567);
  });

  it("çözülemeyen değeri sessizce sıfıra düşürmez", () => {
    expect(parseNumberCell("yok")).toBeNull();
    expect(parseNumberCell("12kg")).toBeNull();
    expect(parseNumberCell("")).toBeNull();
  });
});

describe("tarih okuma", () => {
  it("ISO ve Türkçe yazımı kabul eder", () => {
    expect(parseDateCell("2026-08-08")?.getTime()).toBe(
      new Date("2026-08-08").getTime(),
    );
    const tr = parseDateCell("08.08.2026 09:14");
    expect(tr?.getFullYear()).toBe(2026);
    expect(tr?.getMonth()).toBe(7);
    expect(tr?.getHours()).toBe(9);
  });

  it("taşan tarihi kabul etmez", () => {
    // 31.02 sessizce 03.03'e kaymamalı.
    expect(parseDateCell("31.02.2026")).toBeNull();
  });
});

describe("şablon doğrulama", () => {
  const template = IMPORT_TEMPLATES.sku;

  function csvFor(rows: string[][]): string {
    return toCsv([template.columns.map((c) => c.name), ...rows]);
  }

  it("her şablonun örnek satırları kendi doğrulamasından geçer", () => {
    for (const kind of IMPORT_KINDS) {
      const csv = toCsv(templateToCsvRows(IMPORT_TEMPLATES[kind]));
      const result = validateImportCsv(kind, csv);
      const errors = result.issues.filter((i) => i.severity === "error");
      expect(
        errors,
        `${kind} şablonunun örnek satırları hatalı: ${JSON.stringify(errors)}`,
      ).toEqual([]);
      expect(result.rows).toHaveLength(IMPORT_TEMPLATES[kind].sampleRows.length);
    }
  });

  it("eksik zorunlu kolonu dosya seviyesinde reddeder", () => {
    const result = validateImportCsv("sku", "code,name\nSKU-1,Kulaklık");
    expect(result.fatal).toBe(true);
    expect(result.issues.some((i) => i.code === "eksik-kolon")).toBe(true);
    expect(result.rows).toEqual([]);
  });

  it("bilinmeyen kolonu uyarı olarak geçer, satırı düşürmez", () => {
    const csv = toCsv([
      [...template.columns.map((c) => c.name), "fazlalik"],
      [...template.sampleRows[0], "x"],
    ]);
    const result = validateImportCsv("sku", csv);
    expect(result.issues.some((i) => i.code === "bilinmeyen-kolon")).toBe(true);
    expect(result.rows).toHaveLength(1);
  });

  it("hatalı satırı düşürür, geçerli satırı korur ve nedeni raporlar", () => {
    const bad = [...template.sampleRows[0]];
    bad[0] = "SKU-999";
    bad[4] = "geniş"; // widthCm sayı olmalı
    const result = validateImportCsv("sku", csvFor([template.sampleRows[0], bad]));

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].values.code).toBe("SKU-184");

    const issue = result.issues.find((i) => i.severity === "error");
    expect(issue?.column).toBe("widthCm");
    expect(issue?.code).toBe("bicim");
    expect(issue?.value).toBe("geniş");
    // Rapor kullanıcının dosyasındaki satırı göstermeli: başlık 1, veri 2-3.
    expect(issue?.line).toBe(3);
  });

  it("enum dışındaki değeri seçenekleriyle birlikte reddeder", () => {
    const bad = [...template.sampleRows[0]];
    bad[3] = "kirilgan";
    const result = validateImportCsv("sku", csvFor([bad]));
    const issue = result.issues.find((i) => i.code === "gecersiz-deger");
    expect(issue?.message).toContain("fragile");
    expect(result.rows).toEqual([]);
  });

  it("aralık dışındaki değeri reddeder", () => {
    const layout = IMPORT_TEMPLATES.layout;
    const bad = [...layout.sampleRows[0]];
    const index = layout.columns.findIndex((c) => c.name === "aisleCongestion");
    bad[index] = "1,4";
    const result = validateImportCsv(
      "layout",
      toCsv([layout.columns.map((c) => c.name), bad]),
    );
    expect(result.issues.some((i) => i.code === "aralik")).toBe(true);
  });

  it("geometride tek hata bütün dosyayı düşürür", () => {
    // Yarım yazılmış dijital ikiz, hiç yazılmamışından kötüdür.
    const layout = IMPORT_TEMPLATES.layout;
    const bad = [...layout.sampleRows[1]];
    bad[layout.columns.findIndex((c) => c.name === "bay")] = "iki";
    const result = validateImportCsv(
      "layout",
      toCsv([layout.columns.map((c) => c.name), layout.sampleRows[0], bad]),
    );
    expect(result.fatal).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.rowsTotal).toBe(2);
  });

  it("alan sayısı tutmayan satırı nedeniyle raporlar", () => {
    const csv = `${template.columns.map((c) => c.name).join(",")}\nSKU-1,Yalnız iki alan`;
    const result = validateImportCsv("sku", csv);
    expect(result.issues[0].code).toBe("kolon-sayisi");
    expect(result.rows).toEqual([]);
  });

  it("boş dosyayı dosya seviyesinde reddeder", () => {
    const result = validateImportCsv("sku", "   ");
    expect(result.fatal).toBe(true);
    expect(result.issues[0].code).toBe("bos-dosya");
  });
});
