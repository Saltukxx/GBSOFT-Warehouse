import type { ImportKind } from "@gbsoft/domain";
import { IMPORT_TEMPLATES } from "@gbsoft/domain";
import { FACILITY } from "./facility.js";
import { FACILITY_LAYOUT, LOCATIONS, ZONE_LABELS } from "./layout.js";
import { MISSING_DIMENSION_SKUS, RESERVE_LOCATION, SKUS } from "./skus.js";

/**
 * Golden dataset'in içe aktarma şablonu karşılığı.
 *
 * İki işi birden yapar:
 *  1. Faz 1 çıkış koşulu — golden dataset gerçek import hattından geçirilir,
 *     seed script'inin doğrudan yazdığı veriyle aynı sonucu vermelidir.
 *  2. Kullanıcıya iki satırlık örnek yerine **dolu** bir dosya verir; yeni
 *     bir tesisi kurarken neyin nasıl doldurulacağı somut olarak görünür.
 *
 * Satır sırası ve değerler deterministiktir; üretici seed'li RNG kullanır.
 */

/** Ondalık ayraç olarak virgül yazar — Türkçe Excel'in beklediği biçim. */
function n(value: number, precision = 3): string {
  const rounded = Number(value.toFixed(precision));
  return String(rounded).replace(".", ",");
}

function b(value: boolean): string {
  return value ? "evet" : "hayır";
}

/** Tesis saat diliminde ISO tarih — import bunu yerel saat olarak okur. */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isoMinute(value: Date): string {
  const pad = (x: number) => String(x).padStart(2, "0");
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}`
  );
}

const SNAPSHOT_AT = new Date(FACILITY.snapshotAt);

/** Koridor ve raf yüzü geometrisi — lokasyon satırlarında tekrar eder. */
const AISLE_BY_NUMBER = new Map(
  FACILITY_LAYOUT.aisles.map((aisle) => [aisle.number, aisle]),
);

/**
 * Kayıttan şablon kolon sırasına göre satır üretir.
 *
 * Değerleri elle sıralamak, şablona kolon eklendiğinde bütün satırların
 * sessizce kaymasına yol açar. Kolon adına bağlamak bunu imkânsız kılar;
 * bilinmeyen kolon boş kalır, ki opsiyonel kolonlar için doğru davranış budur.
 */
function rowFor(kind: ImportKind, record: Record<string, string>): string[] {
  return IMPORT_TEMPLATES[kind].columns.map((column) => record[column.name] ?? "");
}

function layoutRows(): string[][] {
  return LOCATIONS.map((location) => {
    const aisle = AISLE_BY_NUMBER.get(location.aisle)!;
    const face = aisle.faces.find((f) => f.zone === location.zone)!;
    // 3B kot kolonları bilinçli olarak boştur: golden dataset kurgusal bir
    // tesistir ve rafları ölçülmemiştir. Sahne bunu türetip öyle bildirir.
    return rowFor("layout", {
      zoneCode: location.zone,
      zoneName: ZONE_LABELS[location.zone],
      aisleNumber: String(location.aisle),
      aisleX: n(aisle.x),
      walkwayWidth: n(aisle.walkwayWidth),
      aisleCongestion: n(aisle.congestionScore),
      side: face.side,
      faceX: n(face.x),
      faceWidth: n(face.width),
      locationCode: location.id,
      bay: String(location.bay),
      level: String(location.level),
      x: n(location.x),
      y: n(location.y),
      width: n(location.width),
      height: n(location.height),
      maxWeightKg: n(location.maxWeightKg),
      maxVolumeM3: n(location.maxVolumeM3),
      equipment: location.equipment,
      goldenZone: b(location.goldenZone),
      distanceToDockM: n(location.distanceToDockM),
      congestionScore: n(location.congestionScore),
      blocked: b(location.blocked),
      blockedReason: location.blockedReason ?? "",
      dataQuality: n(location.dataQuality),
    });
  });
}

function floorAreaRows(): string[][] {
  return FACILITY_LAYOUT.floorAreas.map((area) =>
    rowFor("floor-area", {
      code: area.id,
      label: area.label,
      kind: area.kind,
      x: n(area.x),
      y: n(area.y),
      width: n(area.width),
      height: n(area.height),
    }),
  );
}

function skuRows(): string[][] {
  const missingDimensions = new Set(MISSING_DIMENSION_SKUS);
  return SKUS.map((sku) => {
    const measured = missingDimensions.has(sku.id);
    return [
      sku.id,
      sku.name,
      sku.category,
      sku.handling,
      sku.widthCm === null ? "" : n(sku.widthCm, 1),
      sku.depthCm === null ? "" : n(sku.depthCm, 1),
      sku.heightCm === null ? "" : n(sku.heightCm, 1),
      sku.weightKg === null ? "" : n(sku.weightKg, 2),
      measured ? "manual" : "import",
      measured ? "" : isoDate(SNAPSHOT_AT),
      "0,05",
      sku.currentLocationId === RESERVE_LOCATION ? "" : sku.currentLocationId,
      "seed",
      sku.id,
      "",
    ];
  });
}

function velocityRows(): string[][] {
  const windowStart = new Date(SNAPSHOT_AT);
  windowStart.setDate(windowStart.getDate() - 14);

  return SKUS.map((sku) => [
    sku.id,
    isoDate(windowStart),
    isoDate(SNAPSHOT_AT),
    sku.velocityClass,
    n(sku.picksPerDay, 1),
    n(sku.unitsPerPick, 2),
    n(sku.replenishmentsPerDay, 2),
  ]);
}

/**
 * Dalgalar. Dağılım deterministiktir: son dalga kalan farkı alır, böylece
 * toplam tesis özetiyle birebir eşleşir (seed script'iyle aynı kural).
 */
function waveRows(): string[][] {
  const slaCutoff = new Date(SNAPSHOT_AT);
  slaCutoff.setHours(18, 0, 0, 0);

  const basePerWave = Math.floor(FACILITY.dailyOrderLines / FACILITY.openWaveCount);

  return Array.from({ length: FACILITY.openWaveCount }, (_, index) => {
    const isLast = index === FACILITY.openWaveCount - 1;
    const orderLines = isLast
      ? FACILITY.dailyOrderLines - basePerWave * (FACILITY.openWaveCount - 1)
      : basePerWave;
    const plannedStart = new Date(SNAPSHOT_AT);
    plannedStart.setHours(8 + Math.floor(index / 4), (index % 4) * 15, 0, 0);

    return [
      `W-${2240 + index}`,
      isoMinute(plannedStart),
      isoMinute(slaCutoff),
      index < 6 ? "risk" : "acik",
      String(orderLines),
    ];
  });
}

/**
 * Görev olayları golden dataset'te yoktur: ölçülmüş süre üretmek, olmayan
 * bir kalibrasyonu varmış gibi göstermek olurdu. Şablonun örnek satırları
 * biçimi anlatır; gerçek etiketler ilk müşteriyle gelir.
 */
const GENERATORS: Record<ImportKind, (() => string[][]) | null> = {
  layout: layoutRows,
  "floor-area": floorAreaRows,
  sku: skuRows,
  velocity: velocityRows,
  wave: waveRows,
  "pick-task": null,
};

/** Golden dataset'in bu tür için satırları; yoksa null. */
export function goldenCsvRows(kind: ImportKind): string[][] | null {
  const generate = GENERATORS[kind];
  if (!generate) return null;
  return [IMPORT_TEMPLATES[kind].columns.map((c) => c.name), ...generate()];
}

/** Golden dataset'in kapsadığı türler, yükleme sırasına göre. */
export const GOLDEN_CSV_KINDS: ImportKind[] = [
  "layout",
  "floor-area",
  "sku",
  "velocity",
  "wave",
];
