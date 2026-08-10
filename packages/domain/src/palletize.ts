/**
 * Palet planı ve **solver'dan bağımsız doğrulayıcı** (Faz 7).
 *
 * Yol haritasının açık şartı: paketleme çözücüsünden bağımsız ikinci bir
 * doğrulayıcı olacak ve plan bu doğrulayıcıdan geçmeden yayınlanamayacak.
 * Sebebi basit — bir çözücü kendi ürettiği çözümü kendi kısıtlarıyla kontrol
 * ederse, kısıtı yanlış modellediği yerde iki kez yanılır.
 *
 * Bu modül çözücünün hiçbir iç yapısını bilmez. Elinde yalnız yerleştirilmiş
 * kutular ve paket profilleri vardır; geometriyi ve fiziği sıfırdan yeniden
 * hesaplar.
 *
 * Koordinat sistemi palet yereldir ve `geometry3d.ts` ile aynı yöndedir:
 *
 *     x → palet uzunluğu boyunca
 *     z → palet genişliği boyunca
 *     y → yukarı (paletin güverte üstü `deckHeightM`'den başlar)
 *
 * Origin paletin sol-ön-alt köşesidir.
 */

import type { Vec3 } from "./geometry3d.js";
import { roundM } from "./geometry3d.js";
import {
  allowedFootprints,
  type PackageType,
  type TemperatureClass,
} from "./packaging.js";

/* ------------------------------------------------------------------ */
/* Plan tipleri                                                        */
/* ------------------------------------------------------------------ */

export type PalletPlacement = {
  huCode: string;
  packageTypeCode: string;
  /** Sol-ön-alt köşe konumu (m). */
  x: number;
  y: number;
  z: number;
  /** Yönelim uygulandıktan **sonraki** dış ölçü (m). */
  lengthM: number;
  widthM: number;
  heightM: number;
  grossWeightKg: number;
  /** Katman numarası — layer-building çıktısı, 1'den başlar. */
  layer: number;
  /**
   * Yerleştirme sırası.
   *
   * Yükleme talimatının ve Faz 8'deki precedence grafının kaynağı budur:
   * destekleyen kutu, üstündekinden önce yerleşmek zorundadır.
   */
  seq: number;
};

export type PalletBase = {
  code: string;
  packageTypeCode: string;
  lengthM: number;
  widthM: number;
  /** Paletin kendi kalınlığı; yükler bunun üstünden başlar. */
  deckHeightM: number;
  /** Palet + yük için izin verilen toplam yükseklik (m). */
  maxHeightM: number;
  /** Paletin taşıyabileceği net yük (kg); paletin darası hariç. */
  maxWeightKg: number;
};

export type PalletPlan = {
  base: PalletBase;
  placements: PalletPlacement[];
};

/* ------------------------------------------------------------------ */
/* Doğrulama sonucu                                                    */
/* ------------------------------------------------------------------ */

export type PalletViolationCode =
  | "unknown-package-type"
  | "invalid-orientation"
  | "overlap"
  | "out-of-bounds"
  | "over-height"
  | "over-weight"
  | "floating"
  | "insufficient-support"
  | "top-load-exceeded"
  | "not-stackable"
  | "fragile-under-load"
  | "segregation"
  | "temperature-mix"
  | "cog-outside-envelope"
  | "precedence";

export type PalletViolation = {
  code: PalletViolationCode;
  /** İhlale karışan elleçleme birimleri. */
  huCodes: string[];
  message: string;
};

export type PalletMetrics = {
  usedHeightM: number;
  usedWeightKg: number;
  /** Palet hacim zarfının doluluk oranı (%). */
  volumeUtilizationPct: number;
  /** Taban alanının kaplanma oranı (%) — en alt katman. */
  footprintUtilizationPct: number;
  /** Yükün ağırlık merkezi, palet yereli (m). */
  centerOfGravity: Vec3;
  /** Her kutunun taşıdığı toplam üst yük (kg). */
  carriedKg: Record<string, number>;
};

export type PalletValidation = PalletMetrics & {
  valid: boolean;
  violations: PalletViolation[];
};

/* ------------------------------------------------------------------ */
/* Sabitler                                                            */
/* ------------------------------------------------------------------ */

/** Ölçü karşılaştırma toleransı (m) — 0.1 mm. Solver çıktısı mm'ye yuvarlanır. */
const EPSILON = 1e-4;

/**
 * Ağırlık merkezi paletin merkezinden en çok bu oranda kayabilir.
 *
 * Taban yarı ölçüsünün oranıdır: 0.25 → merkez, orta %50'lik bölgede kalmalı.
 * Devrilme güvenliği hard constraint'tir; objective ağırlıkları bunu
 * gevşetemez.
 */
const COG_ENVELOPE_RATIO = 0.25;

/* ------------------------------------------------------------------ */
/* Geometri yardımcıları                                               */
/* ------------------------------------------------------------------ */

/** İki dikdörtgenin kesişim alanı (m²). */
function overlapArea(
  a: Pick<PalletPlacement, "x" | "z" | "lengthM" | "widthM">,
  b: Pick<PalletPlacement, "x" | "z" | "lengthM" | "widthM">,
): number {
  const dx = Math.min(a.x + a.lengthM, b.x + b.lengthM) - Math.max(a.x, b.x);
  const dz = Math.min(a.z + a.widthM, b.z + b.widthM) - Math.max(a.z, b.z);
  return dx > EPSILON && dz > EPSILON ? dx * dz : 0;
}

/** Üç eksende de kesişiyor mu? */
function boxesIntersect(a: PalletPlacement, b: PalletPlacement): boolean {
  const dy = Math.min(a.y + a.heightM, b.y + b.heightM) - Math.max(a.y, b.y);
  return dy > EPSILON && overlapArea(a, b) > EPSILON;
}

function topOf(placement: PalletPlacement): number {
  return placement.y + placement.heightM;
}

/* ------------------------------------------------------------------ */
/* Doğrulama                                                           */
/* ------------------------------------------------------------------ */

/**
 * Palet planını bağımsız olarak doğrular.
 *
 * Saf fonksiyondur ve çözücüye hiçbir şekilde bağlı değildir. `valid: false`
 * dönen bir plan yayınlanamaz.
 */
export function validatePalletPlan(
  plan: PalletPlan,
  packageTypes: readonly PackageType[],
): PalletValidation {
  const typeByCode = new Map(packageTypes.map((type) => [type.code, type]));
  const violations: PalletViolation[] = [];
  const placements = [...plan.placements].sort((a, b) => a.seq - b.seq);

  const add = (
    code: PalletViolationCode,
    huCodes: string[],
    message: string,
  ) => violations.push({ code, huCodes, message });

  /* --- Paket türleri --------------------------------------------------- */
  for (const placement of placements) {
    const type = typeByCode.get(placement.packageTypeCode);
    if (!type) {
      add(
        "unknown-package-type",
        [placement.huCode],
        `${placement.huCode} bilinmeyen paket türüne bağlı: ${placement.packageTypeCode}.`,
      );
      continue;
    }

    const orientationAllowed = allowedFootprints(type).some(
      (footprint) =>
        Math.abs(footprint.lengthM - placement.lengthM) <= EPSILON &&
        Math.abs(footprint.widthM - placement.widthM) <= EPSILON &&
        Math.abs(footprint.heightM - placement.heightM) <= EPSILON,
    );
    if (!orientationAllowed) {
      add(
        "invalid-orientation",
        [placement.huCode],
        `${placement.huCode} paket profilinin izin vermediği yönde çevrilmiş.`,
      );
    }
  }

  /* --- Sınırlar -------------------------------------------------------- */
  const maxLoadHeight = plan.base.maxHeightM - plan.base.deckHeightM;
  for (const placement of placements) {
    if (
      placement.x < -EPSILON ||
      placement.z < -EPSILON ||
      placement.x + placement.lengthM > plan.base.lengthM + EPSILON ||
      placement.z + placement.widthM > plan.base.widthM + EPSILON
    ) {
      add(
        "out-of-bounds",
        [placement.huCode],
        `${placement.huCode} palet ayak izinin dışına taşıyor.`,
      );
    }
    if (placement.y < -EPSILON) {
      add(
        "out-of-bounds",
        [placement.huCode],
        `${placement.huCode} güvertenin altında konumlanmış.`,
      );
    }
    if (topOf(placement) > maxLoadHeight + EPSILON) {
      add(
        "over-height",
        [placement.huCode],
        `${placement.huCode} izin verilen yükseklik zarfını aşıyor ` +
          `(${roundM(topOf(placement))} m > ${roundM(maxLoadHeight)} m).`,
      );
    }
  }

  /* --- Çakışma --------------------------------------------------------- */
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      if (boxesIntersect(placements[i], placements[j])) {
        add(
          "overlap",
          [placements[i].huCode, placements[j].huCode],
          `${placements[i].huCode} ile ${placements[j].huCode} aynı hacmi paylaşıyor.`,
        );
      }
    }
  }

  /* --- Ağırlık --------------------------------------------------------- */
  const usedWeightKg = placements.reduce(
    (sum, placement) => sum + placement.grossWeightKg,
    0,
  );
  if (usedWeightKg > plan.base.maxWeightKg + EPSILON) {
    add(
      "over-weight",
      placements.map((placement) => placement.huCode),
      `Toplam yük ${roundM(usedWeightKg)} kg, palet kapasitesi ` +
        `${plan.base.maxWeightKg} kg.`,
    );
  }

  /* --- Destek ve boşlukta durma ---------------------------------------- */
  // Bir kutu ya güverteye ya da altındaki kutuların üst yüzeyine oturur.
  // Destekleyen yüzey alanı, kendi ayak izinin `minSupportRatio` katından
  // az olamaz.
  for (const placement of placements) {
    const type = typeByCode.get(placement.packageTypeCode);
    const footprint = placement.lengthM * placement.widthM;
    if (footprint <= 0) continue;

    if (Math.abs(placement.y) <= EPSILON) continue; // güvertede duruyor

    const supporters = placements.filter(
      (other) =>
        other !== placement && Math.abs(topOf(other) - placement.y) <= EPSILON,
    );
    const supportedArea = supporters.reduce(
      (sum, supporter) => sum + overlapArea(placement, supporter),
      0,
    );

    if (supportedArea <= EPSILON) {
      add(
        "floating",
        [placement.huCode],
        `${placement.huCode} boşlukta duruyor: altında destek yok.`,
      );
      continue;
    }

    const ratio = supportedArea / footprint;
    const required = type?.minSupportRatio ?? 0.75;
    if (ratio + EPSILON < required) {
      add(
        "insufficient-support",
        [placement.huCode, ...supporters.map((s) => s.huCode)],
        `${placement.huCode} yeterli destek almıyor: ` +
          `%${Math.round(ratio * 100)} < %${Math.round(required * 100)}.`,
      );
    }
  }

  /* --- Üst yük --------------------------------------------------------- */
  // Yukarıdan aşağı yürüyerek her kutunun taşıdığı toplam yükü biriktiririz.
  // Bir kutu, üstündeki kutunun ağırlığını **oturduğu alan oranında** taşır;
  // bir kutu iki kutunun üstüne oturuyorsa yük ikisine paylaştırılır.
  const carriedKg: Record<string, number> = {};
  for (const placement of placements) carriedKg[placement.huCode] = 0;

  const topDown = [...placements].sort((a, b) => b.y - a.y);
  for (const placement of topDown) {
    const supporters = placements.filter(
      (other) =>
        other !== placement && Math.abs(topOf(other) - placement.y) <= EPSILON,
    );
    const totalSupport = supporters.reduce(
      (sum, supporter) => sum + overlapArea(placement, supporter),
      0,
    );
    if (totalSupport <= EPSILON) continue;

    const load = placement.grossWeightKg + carriedKg[placement.huCode];
    for (const supporter of supporters) {
      const share = overlapArea(placement, supporter) / totalSupport;
      carriedKg[supporter.huCode] += load * share;
    }
  }

  for (const placement of placements) {
    const type = typeByCode.get(placement.packageTypeCode);
    if (!type) continue;
    const carried = carriedKg[placement.huCode];
    if (carried <= EPSILON) continue;

    if (!type.stackable) {
      add(
        "not-stackable",
        [placement.huCode],
        `${placement.huCode} istiflenemez ama üstünde ${roundM(carried)} kg yük var.`,
      );
    }
    if (type.fragile) {
      add(
        "fragile-under-load",
        [placement.huCode],
        `${placement.huCode} kırılgan ve üstünde ${roundM(carried)} kg yük taşıyor.`,
      );
    }
    if (carried > type.maxTopLoadKg + EPSILON) {
      add(
        "top-load-exceeded",
        [placement.huCode],
        `${placement.huCode} üzerindeki yük ${roundM(carried)} kg, sınır ` +
          `${type.maxTopLoadKg} kg.`,
      );
    }
  }

  /* --- Ayrım ve sıcaklık ----------------------------------------------- */
  // Ayrım grubu olmayan yük kendi başına bir gruptur. "Kimyasal" etiketi
  // "başka kimyasallarla karışmasın" değil, "genel yükle karışmasın"
  // demektir; grupsuzu serbest saymak güvenlik kuralını gevşetirdi.
  const UNGROUPED = "(grupsuz)";
  const groups = new Set<string>();
  const temperatures = new Set<TemperatureClass>();
  for (const placement of placements) {
    const type = typeByCode.get(placement.packageTypeCode);
    if (!type) continue;
    groups.add(type.segregationGroup ?? UNGROUPED);
    temperatures.add(type.temperatureClass);
  }
  if (groups.size > 1) {
    add(
      "segregation",
      placements.map((placement) => placement.huCode),
      `Aynı palete ayrılması gereken gruplar konmuş: ${[...groups].sort().join(", ")}.`,
    );
  }
  if (temperatures.size > 1) {
    add(
      "temperature-mix",
      placements.map((placement) => placement.huCode),
      `Aynı palete farklı sıcaklık sınıfları konmuş: ${[...temperatures].sort().join(", ")}.`,
    );
  }

  /* --- Yerleştirme sırası ---------------------------------------------- */
  // Destekleyen kutu, üstündekinden önce yerleşmek zorundadır. Bu kural
  // yükleme talimatının doğruluğunu belirler ve Faz 8'in precedence grafına
  // temel olur.
  for (const placement of placements) {
    if (Math.abs(placement.y) <= EPSILON) continue;
    const supporters = placements.filter(
      (other) =>
        other !== placement &&
        Math.abs(topOf(other) - placement.y) <= EPSILON &&
        overlapArea(placement, other) > EPSILON,
    );
    for (const supporter of supporters) {
      if (supporter.seq > placement.seq) {
        add(
          "precedence",
          [supporter.huCode, placement.huCode],
          `${supporter.huCode} destekleyici ama ${placement.huCode}'den sonra ` +
            "yerleştiriliyor.",
        );
      }
    }
  }

  /* --- Ölçüler --------------------------------------------------------- */
  const usedHeightM = placements.reduce(
    (max, placement) => Math.max(max, topOf(placement)),
    0,
  );
  const envelopeVolume =
    plan.base.lengthM * plan.base.widthM * Math.max(EPSILON, maxLoadHeight);
  const loadVolume = placements.reduce(
    (sum, placement) =>
      sum + placement.lengthM * placement.widthM * placement.heightM,
    0,
  );
  const baseArea = plan.base.lengthM * plan.base.widthM;
  const groundArea = placements
    .filter((placement) => Math.abs(placement.y) <= EPSILON)
    .reduce((sum, placement) => sum + placement.lengthM * placement.widthM, 0);

  const totalWeight = usedWeightKg || 1;
  const centerOfGravity: Vec3 = {
    x: roundM(
      placements.reduce(
        (sum, p) => sum + (p.x + p.lengthM / 2) * p.grossWeightKg,
        0,
      ) / totalWeight,
    ),
    y: roundM(
      placements.reduce(
        (sum, p) => sum + (p.y + p.heightM / 2) * p.grossWeightKg,
        0,
      ) / totalWeight,
    ),
    z: roundM(
      placements.reduce(
        (sum, p) => sum + (p.z + p.widthM / 2) * p.grossWeightKg,
        0,
      ) / totalWeight,
    ),
  };

  if (placements.length > 0) {
    const offsetX = Math.abs(centerOfGravity.x - plan.base.lengthM / 2);
    const offsetZ = Math.abs(centerOfGravity.z - plan.base.widthM / 2);
    if (
      offsetX > (plan.base.lengthM / 2) * COG_ENVELOPE_RATIO + EPSILON ||
      offsetZ > (plan.base.widthM / 2) * COG_ENVELOPE_RATIO + EPSILON
    ) {
      add(
        "cog-outside-envelope",
        placements.map((placement) => placement.huCode),
        `Ağırlık merkezi güvenli zarfın dışında ` +
          `(x ${roundM(offsetX)} m, z ${roundM(offsetZ)} m sapma).`,
      );
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    usedHeightM: roundM(usedHeightM),
    usedWeightKg: roundM(usedWeightKg),
    volumeUtilizationPct:
      Math.round((loadVolume / envelopeVolume) * 1_000) / 10,
    footprintUtilizationPct: Math.round((groundArea / baseArea) * 1_000) / 10,
    centerOfGravity,
    carriedKg: Object.fromEntries(
      Object.entries(carriedKg).map(([code, value]) => [code, roundM(value)]),
    ),
  };
}
