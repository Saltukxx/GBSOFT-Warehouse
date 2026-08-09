/**
 * Çapraz doğrulama: Python çözücüsünün ürettiği palet planını, bağımsız
 * yazılmış TypeScript doğrulayıcısından geçirir.
 */
import {
  DEFAULT_PACKAGE_TYPES,
  validatePalletPlan,
  type PalletPlacement,
  type PackageType,
} from "@gbsoft/domain";

const types = DEFAULT_PACKAGE_TYPES;
const toProfile = (t: PackageType) => ({
  code: t.code,
  length_m: t.lengthM,
  width_m: t.widthM,
  height_m: t.heightM,
  rotation: t.rotation,
  max_top_load_kg: t.maxTopLoadKg,
  min_support_ratio: t.minSupportRatio,
  stackable: t.stackable,
  fragile: t.fragile,
  temperature_class: t.temperatureClass,
  segregation_group: t.segregationGroup ?? null,
});

const base = {
  package_type_code: "PALLET-EUR",
  length_m: 1.2,
  width_m: 0.8,
  deck_height_m: 0.144,
  max_height_m: 1.8,
  max_weight_kg: 1000,
};

// Karma yük: standart koli, kırılgan koli, çuval ve varil.
const items = [
  ...Array.from({ length: 22 }, (_, i) => ({
    hu_code: `CASE-${i + 1}`,
    package_type_code: "CASE-STD",
    gross_weight_kg: 12,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    hu_code: `FRAG-${i + 1}`,
    package_type_code: "CASE-FRAGILE",
    gross_weight_kg: 6,
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    hu_code: `SACK-${i + 1}`,
    package_type_code: "SACK",
    gross_weight_kg: 25,
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    hu_code: `DRUM-${i + 1}`,
    package_type_code: "DRUM-200L",
    gross_weight_kg: 210,
  })),
];

const response = await fetch("http://127.0.0.1:8001/solve/pallet", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    run_id: "crossvalidate",
    base,
    package_types: types.map(toProfile),
    items,
  }),
});
const result = (await response.json()) as any;

console.log(
  `solver ${result.solver_version} | ${result.status} | kalite ${result.solution_quality}`,
);
console.log(
  `${items.length} birim → ${result.pallets.length} palet ` +
    `(alt sınır ${result.lower_bound_pallets}) | yerleşemeyen ${result.unplaced_hu_codes.length}`,
);

let allValid = true;
for (const pallet of result.pallets) {
  const placements: PalletPlacement[] = pallet.placements.map((p: any) => ({
    huCode: p.hu_code,
    packageTypeCode: p.package_type_code,
    x: p.x,
    y: p.y,
    z: p.z,
    lengthM: p.length_m,
    widthM: p.width_m,
    heightM: p.height_m,
    grossWeightKg: p.gross_weight_kg,
    layer: p.layer,
    seq: p.seq,
  }));

  const validation = validatePalletPlan(
    {
      base: {
        code: `PAL-${pallet.seq}`,
        packageTypeCode: base.package_type_code,
        lengthM: base.length_m,
        widthM: base.width_m,
        deckHeightM: base.deck_height_m,
        maxHeightM: base.max_height_m,
        maxWeightKg: base.max_weight_kg,
      },
      placements,
    },
    types,
  );

  const mark = validation.valid ? "GEÇTİ" : "KALDI";
  console.log(
    `  Palet ${pallet.seq}: ${placements.length} birim · ` +
      `${validation.usedHeightM} m · ${validation.usedWeightKg} kg · ` +
      `hacim %${validation.volumeUtilizationPct} · taban %${validation.footprintUtilizationPct} · ${mark}`,
  );
  if (!validation.valid) {
    allValid = false;
    for (const violation of validation.violations.slice(0, 5)) {
      console.log(`      ✗ ${violation.code}: ${violation.message}`);
    }
  }
}

console.log(allValid ? "\nBağımsız doğrulayıcı: TÜM PALETLER GEÇTİ" : "\nİHLAL VAR");
