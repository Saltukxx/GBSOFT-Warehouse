/**
 * Raf sistemi geometrisi (Faz 6.4).
 *
 * 2B ikizde bir «göz» tek bir kademede durur: `A-03-02` koridor 3'ün 2. göz
 * pozisyonudur ve tek bir `level` taşır. Bu, pick yüzünü doğru anlatır ama
 * rafın kendisini anlatmaz — 3B'de gözler havada asılı bloklar gibi görünür.
 *
 * Gerçek raf şudur: her göz pozisyonunda birden çok kademe vardır; bunlardan
 * biri pick yüzüdür (genelde bel hizası), kalanı reserve stoktur. Bu modül
 * rafın taşıyıcı elemanlarını (dikme, traverse) ve bütün hücrelerini üretir.
 *
 * **Kapsam sınırı:** reserve hücreler v1'de slotting hedefi değildir. Solver
 * yalnız pick yüzü atar; buradaki hücreler kapasite görünürlüğü ve 3B içindir.
 */

import type { Box3D, GeometrySource } from "./geometry3d.js";
import { roundM } from "./geometry3d.js";
import type { RackSide, ZoneId } from "./warehouse.js";

/* ------------------------------------------------------------------ */
/* Profil                                                              */
/* ------------------------------------------------------------------ */

export type RackLevelSpec = {
  level: number;
  elevationM: number;
  clearHeightM: number;
};

/**
 * Bir raf yüzünün yapısal ölçüleri.
 *
 * Kademe listesi `scene3d.ts`'teki kot profilinden gelir — burada ikinci bir
 * varsayılan kademe tablosu tanımlanmaz, aksi hâlde iki kaynak zamanla ayrışır.
 */
export type RackProfile = {
  levels: RackLevelSpec[];
  /** Raf derinliği (m) — koridora dik yön. */
  depthM: number;
  /** Dikme kesiti (m). */
  uprightWidthM: number;
  /** Traverse yüksekliği (m). */
  beamHeightM: number;
  source: GeometrySource;
};

/** Ölçülmemiş tesiste kullanılan taşıyıcı eleman ölçüleri. */
export const DEFAULT_UPRIGHT_WIDTH_M = 0.09;
export const DEFAULT_BEAM_HEIGHT_M = 0.12;

/* ------------------------------------------------------------------ */
/* Çıktı                                                               */
/* ------------------------------------------------------------------ */

export type RackElement = { code: string; box: Box3D };

export type RackStructure = {
  rackCode: string;
  aisle: number;
  side: RackSide;
  zone: ZoneId;
  /** Düşey taşıyıcılar — göz pozisyonlarının kenarlarında. */
  uprights: RackElement[];
  /** Yatay traversler — her kademede, her göz pozisyonu boyunca. */
  beams: RackElement[];
  levelCount: number;
  topM: number;
};

export type StorageKind = "pick" | "reserve";

/**
 * Rafın tek bir hücresi.
 *
 * `pick` hücreler mevcut `Location` kayıtlarıyla birebir eşleşir ve onların
 * yerine geçmez; `reserve` hücreler rafın kalan kapasitesidir.
 */
export type StorageVolume = {
  code: string;
  rackCode: string;
  /** `pick` ise ilgili göz kodu; `reserve` ise `null`. */
  locationCode: string | null;
  bay: number;
  level: number;
  kind: StorageKind;
  zone: ZoneId;
  aisle: number;
  side: RackSide;
  box: Box3D;
};

/* ------------------------------------------------------------------ */
/* Üretim                                                              */
/* ------------------------------------------------------------------ */

/** Rafın tek bir göz pozisyonunun ayak izi (bir `Location`'ın kutusu). */
export type RackBayFootprint = {
  bay: number;
  /** Bu pozisyonda pick yüzü olan kademe. */
  pickLevel: number;
  locationCode: string;
  /** Ayak izi: merkez ve boyut (m). Kot bilgisi profilden gelir. */
  centerX: number;
  centerZ: number;
  depthM: number;
  lengthM: number;
};

export type BuildRackInput = {
  rackCode: string;
  aisle: number;
  side: RackSide;
  zone: ZoneId;
  bays: RackBayFootprint[];
  profile: RackProfile;
};

export type BuildRackResult = {
  structure: RackStructure;
  storage: StorageVolume[];
};

function levelCode(locationCode: string, level: number): string {
  return `${locationCode}-L${level}`;
}

/**
 * Bir raf yüzünün taşıyıcı elemanlarını ve hücrelerini üretir.
 *
 * Saf fonksiyondur; aynı girdi her zaman aynı geometriyi verir.
 *
 * Dikmeler her göz pozisyonunun iki z kenarına konur ve çakışanlar teklenir.
 * Bitişik gözlerde dikme paylaşılır, aralarında boşluk olan gözlerde (cross-
 * aisle) ayrı ayrı durur — fiziksel olarak doğrusu budur.
 */
export function buildRackStructure(input: BuildRackInput): BuildRackResult {
  const { profile } = input;
  if (profile.levels.length === 0) {
    throw new Error("Raf profilinde kademe yok.");
  }

  const bays = [...input.bays].sort((a, b) => a.bay - b.bay);
  const topM = roundM(
    Math.max(...profile.levels.map((level) => level.elevationM + level.clearHeightM)),
  );

  // --- Dikmeler ---------------------------------------------------------
  const uprightByZ = new Map<string, RackElement>();
  for (const bay of bays) {
    const halfLength = bay.lengthM / 2;
    for (const edge of [bay.centerZ - halfLength, bay.centerZ + halfLength]) {
      const key = roundM(edge).toFixed(3);
      if (uprightByZ.has(key)) continue;
      uprightByZ.set(key, {
        code: `${input.rackCode}:U${key}`,
        box: {
          center: { x: roundM(bay.centerX), y: 0, z: roundM(edge) },
          size: {
            x: roundM(bay.depthM),
            y: topM,
            z: profile.uprightWidthM,
          },
        },
      });
    }
  }
  const uprights = [...uprightByZ.values()].sort((a, b) =>
    a.box.center.z - b.box.center.z,
  );

  // --- Traversler -------------------------------------------------------
  // Her kademede **iki** traverse vardır: rafın ön ve arka kenarında, koridor
  // boyunca uzanan raylar. Palet bu iki rayın üstüne oturur.
  //
  // Traversi gözün bütün ayak izi kadar geniş yapmak fiziksel olarak yanlıştır
  // ve görsel olarak da zarar verir: üstten bakışta rafın en üst traversi bir
  // kapak gibi pick yüzünü örter.
  //
  // Kot sıfırdaki kademe zemindir, traversi yoktur. Rafın tepesine bağlantı
  // traversi eklenir; taşıyıcı çerçeveyi kapatan odur.
  const beams: RackElement[] = [];
  const railWidthM = profile.uprightWidthM;
  for (const bay of bays) {
    const elevations = [
      ...profile.levels
        .map((level) => level.elevationM)
        .filter((elevation) => elevation > 0),
      topM,
    ];
    const rails: Array<["front" | "rear", number]> = [
      ["front", bay.centerX - bay.depthM / 2 + railWidthM / 2],
      ["rear", bay.centerX + bay.depthM / 2 - railWidthM / 2],
    ];
    for (const elevation of elevations) {
      for (const [side, x] of rails) {
        beams.push({
          code: `${input.rackCode}:B${bay.bay}:${roundM(elevation).toFixed(3)}:${side}`,
          box: {
            center: { x: roundM(x), y: roundM(elevation), z: roundM(bay.centerZ) },
            size: {
              x: railWidthM,
              y: profile.beamHeightM,
              z: roundM(bay.lengthM),
            },
          },
        });
      }
    }
  }

  // --- Hücreler ---------------------------------------------------------
  const storage: StorageVolume[] = [];
  for (const bay of bays) {
    for (const level of profile.levels) {
      const isPick = level.level === bay.pickLevel;
      storage.push({
        code: levelCode(bay.locationCode, level.level),
        rackCode: input.rackCode,
        locationCode: isPick ? bay.locationCode : null,
        bay: bay.bay,
        level: level.level,
        kind: isPick ? "pick" : "reserve",
        zone: input.zone,
        aisle: input.aisle,
        side: input.side,
        box: {
          center: {
            x: roundM(bay.centerX),
            y: roundM(level.elevationM),
            z: roundM(bay.centerZ),
          },
          size: {
            x: roundM(bay.depthM),
            y: roundM(level.clearHeightM),
            z: roundM(bay.lengthM),
          },
        },
      });
    }
  }

  return {
    structure: {
      rackCode: input.rackCode,
      aisle: input.aisle,
      side: input.side,
      zone: input.zone,
      uprights,
      beams,
      levelCount: profile.levels.length,
      topM,
    },
    storage: storage.sort((a, b) => a.code.localeCompare(b.code, "tr")),
  };
}
