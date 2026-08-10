import { describe, expect, it } from "vitest";
import {
  DEFAULT_PACKAGE_TYPES,
  allowedFootprints,
  type PackageType,
} from "./packaging.js";
import {
  validatePalletPlan,
  type PalletBase,
  type PalletPlacement,
  type PalletPlan,
} from "./palletize.js";

const TYPES = DEFAULT_PACKAGE_TYPES;

const BASE: PalletBase = {
  code: "PAL-001",
  packageTypeCode: "PALLET-EUR",
  lengthM: 1.2,
  widthM: 0.8,
  deckHeightM: 0.144,
  // Güverte + 1.656 m yük = 1.8 m toplam.
  maxHeightM: 1.8,
  maxWeightKg: 1_000,
};

/** Standart koli: 0.6 × 0.4 × 0.3. Euro palete katman başına 4 tane sığar. */
function box(
  huCode: string,
  seq: number,
  x: number,
  y: number,
  z: number,
  overrides: Partial<PalletPlacement> = {},
): PalletPlacement {
  return {
    huCode,
    packageTypeCode: "CASE-STD",
    x,
    y,
    z,
    lengthM: 0.6,
    widthM: 0.4,
    heightM: 0.3,
    grossWeightKg: 10,
    layer: Math.round(y / 0.3) + 1,
    seq,
    ...overrides,
  };
}

/** Tabanı tam kaplayan bir katman: 2 × 2 koli. */
function fullLayer(y: number, startSeq: number, overrides: Partial<PalletPlacement> = {}) {
  return [
    box("A", startSeq, 0, y, 0, overrides),
    box("B", startSeq + 1, 0.6, y, 0, overrides),
    box("C", startSeq + 2, 0, y, 0.4, overrides),
    box("D", startSeq + 3, 0.6, y, 0.4, overrides),
  ].map((placement, index) => ({
    ...placement,
    huCode: `${placement.huCode}${Math.round(y * 10)}`,
    seq: startSeq + index,
  }));
}

function plan(placements: PalletPlacement[], base: PalletBase = BASE): PalletPlan {
  return { base, placements };
}

describe("paket profilleri", () => {
  it("sabit yönelimde tek aday üretir", () => {
    const fixed = TYPES.find((type) => type.code === "CASE-FRAGILE")!;
    expect(allowedFootprints(fixed)).toHaveLength(1);
  });

  it("yaw yöneliminde iki aday üretir, kare tabanda tekler", () => {
    const rectangular = TYPES.find((type) => type.code === "CASE-STD")!;
    expect(allowedFootprints(rectangular)).toHaveLength(2);

    // Varil kare tabanlıdır ve zaten fixed; kare tabanlı bir yaw yükü
    // ikinci adayı üretmemeli.
    const square: PackageType = { ...rectangular, lengthM: 0.5, widthM: 0.5 };
    expect(allowedFootprints(square)).toHaveLength(1);
  });

  it("serbest yönelimde altı eksen hizalı adayı tekilleştirerek verir", () => {
    const free: PackageType = {
      ...TYPES[0],
      rotation: "any",
      lengthM: 0.6,
      widthM: 0.4,
      heightM: 0.3,
    };
    expect(allowedFootprints(free)).toHaveLength(6);
  });
});

describe("palet doğrulayıcı", () => {
  it("düzgün istiflenmiş paleti geçerli sayar", () => {
    const result = validatePalletPlan(
      plan([...fullLayer(0, 1), ...fullLayer(0.3, 5)]),
      TYPES,
    );

    expect(result.violations).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.usedHeightM).toBeCloseTo(0.6, 3);
    expect(result.usedWeightKg).toBeCloseTo(80, 3);
    expect(result.footprintUtilizationPct).toBe(100);
  });

  it("çakışan kutuları yakalar", () => {
    const result = validatePalletPlan(
      plan([box("A", 1, 0, 0, 0), box("B", 2, 0.3, 0, 0)]),
      TYPES,
    );

    expect(result.valid).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("overlap");
  });

  it("palet dışına taşan kutuyu yakalar", () => {
    const result = validatePalletPlan(plan([box("A", 1, 0.9, 0, 0)]), TYPES);

    expect(result.violations.map((v) => v.code)).toContain("out-of-bounds");
  });

  it("yükseklik zarfını aşan kutuyu yakalar", () => {
    // Güverte üstü 1.656 m; 0.3 m'lik kutuyu 1.5 m'ye koyarsak taşar.
    const result = validatePalletPlan(plan([box("A", 1, 0, 1.5, 0)]), TYPES);

    expect(result.violations.map((v) => v.code)).toContain("over-height");
  });

  it("palet kapasitesini aşan yükü yakalar", () => {
    const heavy = fullLayer(0, 1, { grossWeightKg: 300 });
    const result = validatePalletPlan(plan(heavy), TYPES);

    expect(result.violations.map((v) => v.code)).toContain("over-weight");
  });

  it("boşlukta duran kutuyu yakalar", () => {
    // 0.6 m'de altında hiçbir şey yok.
    const result = validatePalletPlan(plan([box("A", 1, 0, 0.6, 0)]), TYPES);

    expect(result.violations.map((v) => v.code)).toContain("floating");
  });

  it("yetersiz destekli kutuyu yakalar", () => {
    // Alttaki tek kutu, üsttekinin ayak izinin yarısını destekliyor;
    // CASE-STD %75 istiyor.
    const result = validatePalletPlan(
      plan([box("ALT", 1, 0, 0, 0), box("UST", 2, 0.3, 0.3, 0)]),
      TYPES,
    );

    expect(result.violations.map((v) => v.code)).toContain("insufficient-support");
  });

  it("istiflenemez kutunun üstüne yük konmasını reddeder", () => {
    const bottom = box("ALT", 1, 0, 0, 0, {
      packageTypeCode: "IRREGULAR",
      lengthM: 1.0,
      widthM: 0.7,
      heightM: 0.65,
      grossWeightKg: 40,
    });
    const top = box("UST", 2, 0.2, 0.65, 0.15, { grossWeightKg: 10 });
    const result = validatePalletPlan(plan([bottom, top]), TYPES);

    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain("not-stackable");
  });

  it("kırılgan kutunun üstüne yük konmasını iki ayrı kuralla reddeder", () => {
    const bottom = box("ALT", 1, 0, 0, 0, { packageTypeCode: "CASE-FRAGILE" });
    const top = box("UST", 2, 0, 0.3, 0, { grossWeightKg: 12 });
    const result = validatePalletPlan(plan([bottom, top]), TYPES);

    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain("fragile-under-load");
    expect(codes).toContain("not-stackable");
    // maxTopLoadKg = 0 olduğu için üst yük kuralı da düşer.
    expect(codes).toContain("top-load-exceeded");
  });

  it("üst yükü destekleyiciler arasında oturma alanına göre paylaştırır", () => {
    // Üstteki kutu iki kutunun tam ortasına oturuyor: yük yarı yarıya.
    const left = box("SOL", 1, 0, 0, 0);
    const right = box("SAG", 2, 0.6, 0, 0);
    const top = box("UST", 3, 0.3, 0.3, 0, { grossWeightKg: 20 });
    const result = validatePalletPlan(plan([left, right, top]), TYPES);

    expect(result.carriedKg["SOL"]).toBeCloseTo(10, 3);
    expect(result.carriedKg["SAG"]).toBeCloseTo(10, 3);
    expect(result.carriedKg["UST"]).toBe(0);
  });

  it("üst yük sınırını aşan istifi yakalar", () => {
    // Alt kutu 120 kg taşıyabilir; üstüne 150 kg koyuyoruz.
    const bottom = box("ALT", 1, 0, 0, 0);
    const top = box("UST", 2, 0, 0.3, 0, { grossWeightKg: 150 });
    const result = validatePalletPlan(
      plan([bottom, top], { ...BASE, maxWeightKg: 5_000 }),
      TYPES,
    );

    expect(result.violations.map((v) => v.code)).toContain("top-load-exceeded");
    expect(result.carriedKg["ALT"]).toBeCloseTo(150, 3);
  });

  it("üst yükü zincir boyunca aşağı taşır", () => {
    const bottom = box("ALT", 1, 0, 0, 0);
    const middle = box("ORTA", 2, 0, 0.3, 0, { grossWeightKg: 15 });
    const top = box("UST", 3, 0, 0.6, 0, { grossWeightKg: 25 });
    const result = validatePalletPlan(plan([bottom, middle, top]), TYPES);

    // Alt kutu hem ortayı hem üstü taşır.
    expect(result.carriedKg["ALT"]).toBeCloseTo(40, 3);
    expect(result.carriedKg["ORTA"]).toBeCloseTo(25, 3);
  });

  it("ayrılması gereken grupları aynı palette kabul etmez", () => {
    const drum = box("VARIL", 1, 0, 0, 0, {
      packageTypeCode: "DRUM-200L",
      lengthM: 0.585,
      widthM: 0.585,
      heightM: 0.88,
      grossWeightKg: 200,
    });
    const result = validatePalletPlan(plan([drum, box("KOLI", 2, 0.6, 0, 0)]), TYPES);

    expect(result.violations.map((v) => v.code)).toContain("segregation");
  });

  it("farklı sıcaklık sınıflarını aynı palette kabul etmez", () => {
    const chilled: PackageType = {
      ...TYPES.find((type) => type.code === "CASE-STD")!,
      code: "CASE-CHILLED",
      temperatureClass: "chilled",
    };
    const result = validatePalletPlan(
      plan([box("A", 1, 0, 0, 0), box("B", 2, 0.6, 0, 0, { packageTypeCode: "CASE-CHILLED" })]),
      [...TYPES, chilled],
    );

    expect(result.violations.map((v) => v.code)).toContain("temperature-mix");
  });

  it("ağırlık merkezi güvenli zarfın dışına çıkarsa uyarır", () => {
    // Bütün yük paletin bir köşesinde.
    const result = validatePalletPlan(
      plan([box("A", 1, 0, 0, 0, { grossWeightKg: 200 })]),
      TYPES,
    );

    expect(result.violations.map((v) => v.code)).toContain("cog-outside-envelope");
  });

  it("destekleyicinin sonra yerleştirilmesini precedence ihlali sayar", () => {
    // Üstteki kutu (seq 1) alttakinden (seq 2) önce yerleşiyor — imkânsız.
    const bottom = box("ALT", 2, 0, 0, 0);
    const top = box("UST", 1, 0, 0.3, 0);
    const result = validatePalletPlan(plan([bottom, top]), TYPES);

    expect(result.violations.map((v) => v.code)).toContain("precedence");
  });

  it("bilinmeyen paket türünü sessizce geçmez", () => {
    const result = validatePalletPlan(
      plan([box("A", 1, 0, 0, 0, { packageTypeCode: "YOK" })]),
      TYPES,
    );

    expect(result.violations.map((v) => v.code)).toContain("unknown-package-type");
  });

  it("paket profilinin izin vermediği yönelimi reddeder", () => {
    const result = validatePalletPlan(
      plan([
        box("A", 1, 0, 0, 0, {
          packageTypeCode: "CASE-FRAGILE",
          lengthM: 0.4,
          widthM: 0.6,
        }),
      ]),
      TYPES,
    );

    expect(result.violations.map((v) => v.code)).toContain("invalid-orientation");
  });

  it("boş palet geçerlidir ve ölçüleri sıfırdır", () => {
    const result = validatePalletPlan(plan([]), TYPES);

    expect(result.valid).toBe(true);
    expect(result.usedHeightM).toBe(0);
    expect(result.usedWeightKg).toBe(0);
    expect(result.footprintUtilizationPct).toBe(0);
  });

  it("aynı girdi için deterministiktir", () => {
    const input = plan([...fullLayer(0, 1), ...fullLayer(0.3, 5)]);
    expect(JSON.stringify(validatePalletPlan(input, TYPES))).toBe(
      JSON.stringify(validatePalletPlan(input, TYPES)),
    );
  });
});
