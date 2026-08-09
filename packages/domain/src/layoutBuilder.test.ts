import { describe, expect, it } from "vitest";
import { toCsv } from "./csv.js";
import { validateImportCsv } from "./imports.js";
import {
  DEFAULT_BLUEPRINT,
  blueprintToFloorAreaCsvRows,
  blueprintToLayoutCsvRows,
  buildLayoutDraft,
} from "./layoutBuilder.js";
import type { LayoutBlueprint } from "./layoutBuilder.js";

function withBlueprint(patch: Partial<LayoutBlueprint>): LayoutBlueprint {
  return { ...DEFAULT_BLUEPRINT, ...patch };
}

describe("layout üreticisi", () => {
  it("varsayılan taslak Marmara DM geometrisini üretir", () => {
    const { layout, locations, warnings } = buildLayoutDraft(DEFAULT_BLUEPRINT);

    expect(locations).toHaveLength(96);
    expect(layout.aisles).toHaveLength(12);
    expect(layout.zones.map((z) => z.code)).toEqual(["A", "B", "C", "D"]);
    expect(warnings).toEqual([]);
  });

  it("göz konumları dijital ikizle aynı ızgaraya oturur", () => {
    const { locations } = buildLayoutDraft(DEFAULT_BLUEPRINT);
    const byId = new Map(locations.map((l) => [l.id, l]));

    // Koridor 1 sol yüz: x = originX. Göz 1 dock'a en yakın, en altta.
    expect(byId.get("A-01-01")).toMatchObject({ x: 40, y: 270, bay: 1 });
    expect(byId.get("A-01-02")).toMatchObject({ x: 40, y: 202 });
    // Cross-aisle göz 2 ile 3 arasından geçer: 3. gözde kayma yoktur.
    expect(byId.get("A-01-03")).toMatchObject({ y: 108 });
    expect(byId.get("A-01-04")).toMatchObject({ y: 40 });
    // Koridor 3 sol yüz: originX + 2 * pitch.
    expect(byId.get("A-03-01")?.x).toBe(192);
    // Sağ yüz raf genişliği + koridor kadar sağdadır.
    expect(byId.get("B-01-01")?.x).toBe(40 + 28 + 20);
  });

  it("cross-aisle şeridi göz sıraları arasına yerleşir", () => {
    const { layout } = buildLayoutDraft(DEFAULT_BLUEPRINT);
    const band = layout.floorAreas.find((a) => a.kind === "cross-aisle");
    expect(band).toMatchObject({ y: 176, height: 20 });
  });

  it("cross-aisle kapatılınca gözler bitişik dizilir", () => {
    const { locations, layout } = buildLayoutDraft(
      withBlueprint({ crossAisleAfterBay: 0 }),
    );
    const byId = new Map(locations.map((l) => [l.id, l]));
    expect(byId.get("A-01-01")?.y).toBe(40 + 3 * 68);
    expect(layout.floorAreas.some((a) => a.kind === "cross-aisle")).toBe(false);
  });

  it("mesafe dock'tan Manhattan olarak ölçülür ve göz 1 en yakındır", () => {
    const { locations } = buildLayoutDraft(DEFAULT_BLUEPRINT);
    const byId = new Map(locations.map((l) => [l.id, l]));
    const bay1 = byId.get("A-01-01")!;
    const bay4 = byId.get("A-01-04")!;
    expect(bay1.distanceToDockM).toBeLessThan(bay4.distanceToDockM);
    expect(bay1.distanceToDockM).toBeGreaterThan(0);
  });

  it("yeni tesiste ölçülmemiş etkinlik uydurulmaz", () => {
    const { locations } = buildLayoutDraft(DEFAULT_BLUEPRINT);
    expect(locations.every((l) => l.picksPerDay === 0)).toBe(true);
    expect(locations.every((l) => l.replenishmentsPerDay === 0)).toBe(true);
    expect(locations.every((l) => l.congestionScore === 0)).toBe(true);
  });

  it("koridor sayısı ve göz sayısı lokasyon adedini belirler", () => {
    const { locations } = buildLayoutDraft(
      withBlueprint({
        aisleCount: 3,
        baysPerFace: 2,
        crossAisleAfterBay: 0,
        zoning: [
          { aisle: 1, left: "A", right: "B" },
          { aisle: 2, left: "A", right: "B" },
          { aisle: 3, left: "C", right: "D" },
        ],
      }),
    );
    expect(locations).toHaveLength(3 * 2 * 2);
  });

  it("bir koridorun iki yüzüne aynı zon atanırsa kod çakışmasını söyler", () => {
    const { warnings } = buildLayoutDraft(
      withBlueprint({
        aisleCount: 1,
        zoning: [{ aisle: 1, left: "A", right: "A" }],
      }),
    );
    expect(warnings.some((w) => w.includes("çakışır"))).toBe(true);
  });

  it("nedensiz bloklamayı uyarır", () => {
    const { warnings } = buildLayoutDraft(
      withBlueprint({ blocked: { "A-01-01": "  " } }),
    );
    expect(warnings.some((w) => w.includes("neden girilmedi"))).toBe(true);
  });

  it("dock raf bloğuyla çakışırsa uyarır", () => {
    const { warnings } = buildLayoutDraft(
      withBlueprint({ dock: { x: 60, y: 60, width: 80, height: 40, label: "Dock" } }),
    );
    expect(warnings.some((w) => w.includes("çakışıyor"))).toBe(true);
  });
});

describe("layout üreticisinin CSV karşılığı", () => {
  it("ürettiği geometri kendi içe aktarma şablonundan geçer", () => {
    // Editörün ayrı bir yazma yolu yoktur: çıktısı elle doldurulmuş bir
    // dosyayla aynı doğrulamadan geçmek zorundadır.
    const csv = toCsv(blueprintToLayoutCsvRows(DEFAULT_BLUEPRINT), ";");
    const result = validateImportCsv("layout", csv);

    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.fatal).toBe(false);
    expect(result.rows).toHaveLength(96);
  });

  it("raf dışı alanlar da kendi şablonundan geçer", () => {
    const csv = toCsv(blueprintToFloorAreaCsvRows(DEFAULT_BLUEPRINT), ";");
    const result = validateImportCsv("floor-area", csv);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.rows).toHaveLength(2);
  });

  it("bloklu göz nedeniyle birlikte yazılır", () => {
    const csv = toCsv(
      blueprintToLayoutCsvRows(
        withBlueprint({ blocked: { "A-01-01": "Raf ayağı hasarlı" } }),
      ),
      ";",
    );
    const result = validateImportCsv("layout", csv);
    const row = result.rows.find((r) => r.values.locationCode === "A-01-01");
    expect(row?.values.blocked).toBe(true);
    expect(row?.values.blockedReason).toBe("Raf ayağı hasarlı");
  });

  it("ondalık değerler Türkçe biçimde yazılır ve geri okunur", () => {
    const rows = blueprintToLayoutCsvRows(DEFAULT_BLUEPRINT);
    const distanceIndex = rows[0].indexOf("distanceToDockM");
    expect(rows[1][distanceIndex]).toMatch(/^\d+(,\d+)?$/);

    const result = validateImportCsv("layout", toCsv(rows, ";"));
    expect(typeof result.rows[0].values.distanceToDockM).toBe("number");
  });
});
