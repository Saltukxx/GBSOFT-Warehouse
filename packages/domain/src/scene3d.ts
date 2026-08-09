/**
 * 3B dijital ikiz sahnesi (Faz 6).
 *
 * 2B layout, çizim amacıyla SVG kullanıcı birimindedir. 3B sahne ise fiziksel
 * bir modeldir: **kanonik birim metredir**. Dönüşüm tek yerde, burada olur.
 *
 * Koordinat sistemi — three.js sağ el kuralı, Y yukarı:
 *
 *     x → doğu   (SVG x / unitsPerMeter)
 *     z → güney  (SVG y / unitsPerMeter)
 *     y → yukarı (kot; zemin y = 0)
 *
 * Bu, 2B haritanın üstten görünüşünü birebir korur: haritada aşağıda duran göz
 * sahnede de +z yönündedir. Kamera varsayılan olarak -z'den bakar.
 *
 * Dürüstlük kuralı: bir tesiste henüz ölçülmüş raf yüksekliği ve göz kotu
 * yoktur. Bu durumda geometri `DEFAULT_RACK_LEVELS` profilinden **türetilir**
 * ve sahne `geometrySource: "derived"` der. Arayüz bunu kullanıcıya söyler;
 * türetilmiş bir kotu ölçülmüş gibi göstermeyiz.
 */

import type { Box3D, GeometrySource, Vec3 } from "./geometry3d.js";
import { isMeasured, roundM as round } from "./geometry3d.js";
import type {
  RackLevelSpec,
  RackProfile,
  RackStructure,
  StorageVolume,
} from "./rack.js";
import {
  DEFAULT_BEAM_HEIGHT_M,
  DEFAULT_UPRIGHT_WIDTH_M,
  buildRackStructure,
} from "./rack.js";
import type {
  Equipment,
  FacilityLayout,
  FloorArea,
  FloorAreaKind,
  Location,
  RackSide,
  ZoneId,
  ZoneSummary,
} from "./warehouse.js";

/* ------------------------------------------------------------------ */
/* Tipler                                                              */
/* ------------------------------------------------------------------ */

/** Bir raf kademesinin kot tablosu. */
export type RackLevelProfile = {
  level: number;
  /** Kademe tabanının zeminden yüksekliği (m). */
  elevationM: number;
  /** Kademe net açıklığı (m). */
  clearHeightM: number;
  source: GeometrySource;
};

/** Tek bir pick gözünün 3B hacmi ve ısı katmanı verileri. */
export type BayVolume = {
  locationCode: string;
  zone: ZoneId;
  aisle: number;
  bay: number;
  level: number;
  side: RackSide;
  box: Box3D;
  equipment: Equipment;
  goldenZone: boolean;
  blocked: boolean;
  blockedReason?: string;
  /** Isı katmanları — 2B haritayla aynı kaynak, aynı sayı. */
  pickTimeSec: number;
  picksPerDay: number;
  replenishmentsPerDay: number;
  congestionScore: number;
  dataQuality: number;
  distanceToDockM: number;
};

/** Bir koridorun tek raf yüzünün tamamı — instanced render'ın gruplama birimi. */
export type RackModule = {
  code: string;
  aisle: number;
  side: RackSide;
  zone: ZoneId;
  /** Rafın dış zarfı: tabandan en üst kademenin tepesine. */
  box: Box3D;
  levels: number[];
  bayCodes: string[];
};

/** Raf dışı alanın hacmi. Dock ve staging yükseklik taşır, cross-aisle taşımaz. */
export type FloorVolume = {
  code: string;
  label: string;
  kind: FloorAreaKind;
  box: Box3D;
  /** Ekipman bu alandan geçebilir mi? */
  traversable: boolean;
};

export type TraversablePathKind = "aisle" | "cross-aisle" | "dock-approach";

/**
 * Ekipmanın geçebildiği yol ekseni. Yürüyüş grafı (Faz 2) rota *mesafesini*
 * verir; bu katman rotanın 3B'de nereden geçtiğini verir. İkisi aynı
 * geometriden türer, bu yüzden ayrışamazlar.
 */
export type TraversablePath = {
  code: string;
  kind: TraversablePathKind;
  from: Vec3;
  to: Vec3;
  widthM: number;
  /** Yolun üstündeki net açıklık (m). */
  clearanceM: number;
  equipment: Equipment[];
};

export type Scene3D = {
  facilityCode: string;
  facilityName: string;
  layoutVersion: number;
  /** Kanonik birim. Sözleşmede sabittir; kaynak birim import tarafında korunur. */
  units: "m";
  bounds: { widthM: number; depthM: number; clearHeightM: number };
  /** Mesafe ölçümünün başladığı dock referansı (m). */
  dockAnchor: Vec3;
  geometrySource: GeometrySource;
  levelProfile: RackLevelProfile[];
  zones: ZoneSummary[];
  racks: RackModule[];
  bays: BayVolume[];
  /** Raf taşıyıcıları — dikme ve traversler. */
  structures: RackStructure[];
  /**
   * Rafın bütün hücreleri: pick yüzleri ve reserve gözler.
   *
   * `bays` pick yüzlerinin ısı verisini taşır; burası rafın düşey
   * kapasitesini gösterir. Reserve hücreler v1'de slotting hedefi değildir.
   */
  storage: StorageVolume[];
  floors: FloorVolume[];
  paths: TraversablePath[];
};

export type Scene3DResponse = {
  facility: { id: string; name: string; city: string };
  scene: Scene3D;
};

/* ------------------------------------------------------------------ */
/* Rota                                                                */
/* ------------------------------------------------------------------ */

/**
 * Yürüyüş grafında hesaplanmış tek bir bacak, sahne koordinatına çevrilmiş.
 *
 * Rota şematik değildir: noktalar Faz 2'de kalıcılaşan graf düğümlerinden
 * gelir, `distanceM` de aynı grafta ölçülen mesafedir. 3B'de gördüğünüz yol
 * ile mesafe matrisindeki sayı aynı kaynaktır.
 */
export type RouteLeg = {
  fromCode: string;
  toCode: string;
  distanceM: number;
  points: Vec3[];
};

export type RoutePlan = {
  facilityCode: string;
  layoutVersion: number;
  units: "m";
  /** İstenen ama grafta ulaşılamayan bacaklar — sessizce düşürülmez. */
  unreachable: Array<{ fromCode: string; toCode: string; reason: string }>;
  legs: RouteLeg[];
  totalDistanceM: number;
};

/* ------------------------------------------------------------------ */
/* Varsayılan raf profili                                              */
/* ------------------------------------------------------------------ */

/**
 * Ölçülmüş kot yokken kullanılan kademe profili.
 *
 * Kademe 2 bel–göz hizasıdır (şemadaki `level` yorumu: "2 bel hizası"); altın
 * bölge tanımı buradan gelir. Kademe 1 yer seviyesi ağır ürün rafı, kademe 3
 * ve üstü merdiven/forklift erişimidir.
 */
export const DEFAULT_RACK_LEVELS: ReadonlyArray<{
  level: number;
  elevationM: number;
  clearHeightM: number;
}> = [
  { level: 1, elevationM: 0.0, clearHeightM: 0.85 },
  { level: 2, elevationM: 0.85, clearHeightM: 0.85 },
  { level: 3, elevationM: 1.7, clearHeightM: 1.05 },
];

/** 3. kademeden sonrası bu adımla devam eder. */
const UPPER_LEVEL_PITCH_M = 1.05;

/** Ölçülmemiş bir tesiste bina net yüksekliği rafın üstüne bu pay eklenerek bulunur. */
const CLEAR_HEIGHT_HEADROOM_M = 2.5;

/** Cross-aisle ve koridor yollarının varsayılan net açıklığı (m). */
const DEFAULT_PATH_CLEARANCE_M = 3.5;

/** Zemin alanlarının türetilmiş yükseklikleri (m). */
const DEFAULT_FLOOR_HEIGHT_M: Record<FloorAreaKind, number> = {
  dock: 0.9,
  staging: 0.15,
  packing: 0.95,
  "cross-aisle": 0,
  other: 0.1,
};

/** Ekipman bu alandan geçebilir mi — ölçülmemişse tür belirler. */
const DEFAULT_FLOOR_TRAVERSABLE: Record<FloorAreaKind, boolean> = {
  dock: true,
  staging: true,
  packing: false,
  "cross-aisle": true,
  other: false,
};

/**
 * Kademe listesinden raf profili.
 *
 * Taşıyıcı eleman ölçüleri (dikme kesiti, traverse yüksekliği) bugün
 * ölçülmüyor; `rack.ts`'teki varsayılanlardan gelir. Kademe kotları ise
 * sahnenin profilinden — iki ayrı kademe tablosu tutmuyoruz.
 */
function rackProfile(
  levels: RackLevelSpec[],
  source: GeometrySource,
): RackProfile {
  return {
    levels,
    // Derinlik göz bazlıdır ve `RackBayFootprint` üzerinden taşınır; profildeki
    // değer yalnız geriye dönük bir varsayılandır.
    depthM: 0,
    uprightWidthM: DEFAULT_UPRIGHT_WIDTH_M,
    beamHeightM: DEFAULT_BEAM_HEIGHT_M,
    source,
  };
}

export function defaultLevelGeometry(level: number): {
  elevationM: number;
  clearHeightM: number;
} {
  const known = DEFAULT_RACK_LEVELS.find((entry) => entry.level === level);
  if (known) return { elevationM: known.elevationM, clearHeightM: known.clearHeightM };

  const last = DEFAULT_RACK_LEVELS[DEFAULT_RACK_LEVELS.length - 1];
  const stepsAbove = Math.max(0, level - last.level);
  return {
    elevationM: round(last.elevationM + stepsAbove * UPPER_LEVEL_PITCH_M),
    clearHeightM: UPPER_LEVEL_PITCH_M,
  };
}

/* ------------------------------------------------------------------ */
/* Girdi                                                               */
/* ------------------------------------------------------------------ */

/** Ölçülmüş 3B alanları taşıyan göz. Alanlar boşsa profilden türetilir. */
export type Scene3DLocationInput = Location & {
  levelElevationM?: number | null;
  levelClearHeightM?: number | null;
  depthM?: number | null;
};

/** Ölçülmüş yükseklik ve geçilebilirlik taşıyan zemin alanı. */
export type Scene3DFloorAreaInput = FloorArea & {
  heightM?: number | null;
  traversable?: boolean | null;
};

export type Scene3DInput = {
  layout: FacilityLayout;
  locations: Scene3DLocationInput[];
  /** Bina net yüksekliği (m). Boşsa raf tepesinden türetilir. */
  clearHeightM?: number | null;
  /** Boşsa `layout.floorAreas` türetilmiş yüksekliklerle kullanılır. */
  floorAreas?: Scene3DFloorAreaInput[];
};

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

/**
 * Gözün hangi raf yüzünde durduğunu ayak izinden bulur.
 *
 * Zon üzerinden eşleştirmek yeterli değildir: bir koridorun iki yüzüne aynı
 * zon atanabilir. Konum aralığı tek doğru ayrımdır.
 */
function sideOf(
  layout: FacilityLayout,
  location: Pick<Location, "aisle" | "zone" | "x" | "width">,
): RackSide {
  const aisle = layout.aisles.find((item) => item.number === location.aisle);
  if (!aisle) return "left";

  const center = location.x + location.width / 2;
  const containing = aisle.faces.find(
    (face) => center >= face.x && center <= face.x + face.width,
  );
  if (containing) return containing.side;

  const byZone = aisle.faces.find((face) => face.zone === location.zone);
  if (byZone) return byZone.side;

  // Son çare: koridorun sol yüzüne göre konum.
  const sorted = [...aisle.faces].sort((a, b) => a.x - b.x);
  return sorted.length > 0 && center > sorted[0].x + sorted[0].width ? "right" : "left";
}

/** Raf yüzleri arasındaki yürüyüş koridorunun orta ekseni (SVG birimi). */
function aisleWalkX(faces: FacilityLayout["aisles"][number]["faces"], walkwayWidth: number, aisleX: number): number {
  const sorted = [...faces].sort((a, b) => a.x - b.x);
  if (sorted.length >= 2) {
    return (sorted[0].x + sorted[0].width + sorted[1].x) / 2;
  }
  const faceWidth = sorted[0]?.width ?? 0;
  return aisleX + faceWidth + walkwayWidth / 2;
}

/* ------------------------------------------------------------------ */
/* Sahne üretimi                                                       */
/* ------------------------------------------------------------------ */

/**
 * 2B dijital ikiz sürümünden 3B sahne üretir.
 *
 * Saf fonksiyondur: aynı girdi her zaman aynı sahneyi verir. Ayak izi 2B
 * haritayla birebir aynıdır — sahne yeni bir geometri uydurmaz, mevcut ikizi
 * üçüncü boyuta taşır. Yeni olan tek şey düşey eksendir.
 */
export function buildScene3D(input: Scene3DInput): Scene3D {
  const { layout } = input;
  if (!(layout.unitsPerMeter > 0)) {
    throw new Error("unitsPerMeter sıfırdan büyük olmalı.");
  }

  const toM = (units: number) => round(units / layout.unitsPerMeter);

  // --- Kademe profili ---------------------------------------------------
  const levels = [...new Set(input.locations.map((loc) => loc.level))].sort(
    (a, b) => a - b,
  );

  const measuredByLevel = new Map<number, { elevationM: number; clearHeightM: number }>();
  for (const location of input.locations) {
    if (measuredByLevel.has(location.level)) continue;
    if (isMeasured(location.levelElevationM) && isMeasured(location.levelClearHeightM)) {
      measuredByLevel.set(location.level, {
        elevationM: location.levelElevationM,
        clearHeightM: location.levelClearHeightM,
      });
    }
  }

  const levelProfile: RackLevelProfile[] = levels.map((level) => {
    const measured = measuredByLevel.get(level);
    if (measured) {
      return {
        level,
        elevationM: round(measured.elevationM),
        clearHeightM: round(measured.clearHeightM),
        source: "measured" as const,
      };
    }
    const derived = defaultLevelGeometry(level);
    return { level, ...derived, source: "derived" as const };
  });

  const profileByLevel = new Map(levelProfile.map((entry) => [entry.level, entry]));

  // Tek bir türetilmiş kademe bile varsa sahnenin tamamı türetilmiş sayılır.
  // Kısmen ölçülmüş bir sahneyi "ölçülmüş" diye sunmak yanıltıcı olurdu.
  const geometrySource: GeometrySource = levelProfile.every(
    (entry) => entry.source === "measured",
  )
    ? "measured"
    : "derived";

  // --- Gözler -----------------------------------------------------------
  const bays: BayVolume[] = input.locations
    .map((location) => {
      const profile =
        profileByLevel.get(location.level) ?? defaultLevelGeometry(location.level);
      const depthM = isMeasured(location.depthM)
        ? round(location.depthM)
        : toM(location.width);
      const lengthM = toM(location.height);

      return {
        locationCode: location.id,
        zone: location.zone,
        aisle: location.aisle,
        bay: location.bay,
        level: location.level,
        side: sideOf(layout, location),
        box: {
          center: {
            x: toM(location.x + location.width / 2),
            y: round(profile.elevationM),
            z: toM(location.y + location.height / 2),
          },
          size: { x: depthM, y: round(profile.clearHeightM), z: lengthM },
        },
        equipment: location.equipment,
        goldenZone: location.goldenZone,
        blocked: location.blocked,
        ...(location.blockedReason ? { blockedReason: location.blockedReason } : {}),
        pickTimeSec: location.pickTimeSec,
        picksPerDay: location.picksPerDay,
        replenishmentsPerDay: location.replenishmentsPerDay,
        congestionScore: location.congestionScore,
        dataQuality: location.dataQuality,
        distanceToDockM: location.distanceToDockM,
      } satisfies BayVolume;
    })
    .sort((a, b) => a.locationCode.localeCompare(b.locationCode, "tr"));

  // --- Eksiksiz kademe profili ------------------------------------------
  // `levelProfile` yalnız pick yüzü olan kademeleri içerir. Raf ise 1'den en
  // üst kademeye kadar süreklidir; aradaki kademeler reserve gözdür. Boşluklu
  // bir raf çizmek, var olan depolama kapasitesini yok saymak olurdu.
  const maxLevel = levelProfile.length > 0
    ? Math.max(...levelProfile.map((entry) => entry.level))
    : 1;
  const rackLevels: RackLevelSpec[] = [];
  for (let level = 1; level <= maxLevel; level += 1) {
    const known = profileByLevel.get(level);
    rackLevels.push(
      known
        ? { level, elevationM: known.elevationM, clearHeightM: known.clearHeightM }
        : { level, ...defaultLevelGeometry(level) },
    );
  }
  const rackTopM = round(
    Math.max(...rackLevels.map((level) => level.elevationM + level.clearHeightM)),
  );

  // --- Raf modülleri, taşıyıcıları ve hücreleri -------------------------
  const racks: RackModule[] = [];
  const structures: RackStructure[] = [];
  const storage: StorageVolume[] = [];
  const byModule = new Map<string, BayVolume[]>();
  for (const bay of bays) {
    const code = `R:A${bay.aisle}:${bay.side}`;
    const list = byModule.get(code) ?? [];
    list.push(bay);
    byModule.set(code, list);
  }

  for (const [code, members] of [...byModule].sort(([a], [b]) => a.localeCompare(b))) {
    const minX = Math.min(...members.map((m) => m.box.center.x - m.box.size.x / 2));
    const maxX = Math.max(...members.map((m) => m.box.center.x + m.box.size.x / 2));
    const minZ = Math.min(...members.map((m) => m.box.center.z - m.box.size.z / 2));
    const maxZ = Math.max(...members.map((m) => m.box.center.z + m.box.size.z / 2));

    racks.push({
      code,
      aisle: members[0].aisle,
      side: members[0].side,
      zone: members[0].zone,
      box: {
        center: { x: round((minX + maxX) / 2), y: 0, z: round((minZ + maxZ) / 2) },
        // Zarf artık pick yüzlerinin en üstüne değil, rafın gerçek tepesine
        // kadar çıkar; reserve kademeler de bu zarfın içindedir.
        size: { x: round(maxX - minX), y: rackTopM, z: round(maxZ - minZ) },
      },
      levels: rackLevels.map((level) => level.level),
      bayCodes: members.map((m) => m.locationCode),
    });

    const built = buildRackStructure({
      rackCode: code,
      aisle: members[0].aisle,
      side: members[0].side,
      zone: members[0].zone,
      bays: members.map((member) => ({
        bay: member.bay,
        pickLevel: member.level,
        locationCode: member.locationCode,
        centerX: member.box.center.x,
        centerZ: member.box.center.z,
        depthM: member.box.size.x,
        lengthM: member.box.size.z,
      })),
      profile: rackProfile(rackLevels, geometrySource),
    });
    structures.push(built.structure);
    storage.push(...built.storage);
  }

  // --- Bina zarfı -------------------------------------------------------
  const clearHeightM = isMeasured(input.clearHeightM)
    ? round(input.clearHeightM)
    : round(rackTopM + CLEAR_HEIGHT_HEADROOM_M);

  // --- Zemin alanları ---------------------------------------------------
  const floorAreas: Scene3DFloorAreaInput[] = input.floorAreas ?? layout.floorAreas;
  const floors: FloorVolume[] = floorAreas.map((area) => {
    const heightM = isMeasured(area.heightM)
      ? round(area.heightM)
      : DEFAULT_FLOOR_HEIGHT_M[area.kind];
    const traversable =
      typeof area.traversable === "boolean"
        ? area.traversable
        : DEFAULT_FLOOR_TRAVERSABLE[area.kind];

    return {
      code: area.id,
      label: area.label,
      kind: area.kind,
      box: {
        center: {
          x: toM(area.x + area.width / 2),
          y: 0,
          z: toM(area.y + area.height / 2),
        },
        size: { x: toM(area.width), y: heightM, z: toM(area.height) },
      },
      traversable,
    };
  });

  // --- Geçilebilir yollar -----------------------------------------------
  const paths: TraversablePath[] = [];
  const dockAnchor: Vec3 = {
    x: toM(layout.dockAnchor.x),
    y: 0,
    z: toM(layout.dockAnchor.y),
  };

  if (bays.length > 0) {
    const minZ = Math.min(...bays.map((b) => b.box.center.z - b.box.size.z / 2));
    const maxZ = Math.max(...bays.map((b) => b.box.center.z + b.box.size.z / 2));

    for (const aisle of [...layout.aisles].sort((a, b) => a.number - b.number)) {
      const walkX = toM(aisleWalkX(aisle.faces, aisle.walkwayWidth, aisle.x));
      paths.push({
        code: `P:A${aisle.number}`,
        kind: "aisle",
        from: { x: walkX, y: 0, z: round(minZ) },
        to: { x: walkX, y: 0, z: round(maxZ) },
        widthM: toM(aisle.walkwayWidth),
        clearanceM: clearHeightM,
        equipment: ["manual", "cart", "forklift"],
      });
    }

    // Cross-aisle şeritleri yatay omurgadır; koridorları birbirine bağlar.
    for (const area of floors) {
      if (area.kind !== "cross-aisle" || !area.traversable) continue;
      paths.push({
        code: `P:X:${area.code}`,
        kind: "cross-aisle",
        from: {
          x: round(area.box.center.x - area.box.size.x / 2),
          y: 0,
          z: area.box.center.z,
        },
        to: {
          x: round(area.box.center.x + area.box.size.x / 2),
          y: 0,
          z: area.box.center.z,
        },
        widthM: area.box.size.z,
        clearanceM: DEFAULT_PATH_CLEARANCE_M,
        equipment: ["manual", "cart", "forklift"],
      });
    }

    // Dock yaklaşımı: referans noktasından en yakın koridor ağzına.
    const aislePaths = paths.filter((path) => path.kind === "aisle");
    if (aislePaths.length > 0) {
      const mouths = aislePaths.map((path) => {
        const near =
          Math.abs(path.from.z - dockAnchor.z) <= Math.abs(path.to.z - dockAnchor.z)
            ? path.from
            : path.to;
        return { near, distance: Math.hypot(near.x - dockAnchor.x, near.z - dockAnchor.z) };
      });
      const nearest = mouths.sort((a, b) => a.distance - b.distance)[0];
      paths.push({
        code: "P:DOCK",
        kind: "dock-approach",
        from: dockAnchor,
        to: nearest.near,
        widthM: Math.max(...aislePaths.map((path) => path.widthM)),
        clearanceM: DEFAULT_PATH_CLEARANCE_M,
        equipment: ["manual", "cart", "forklift"],
      });
    }
  }

  return {
    facilityCode: layout.facilityCode,
    facilityName: layout.facilityName,
    layoutVersion: layout.layoutVersion,
    units: "m",
    bounds: {
      widthM: toM(layout.viewBox.width),
      depthM: toM(layout.viewBox.height),
      clearHeightM,
    },
    dockAnchor,
    geometrySource,
    levelProfile,
    zones: layout.zones,
    racks,
    bays,
    structures,
    storage,
    floors,
    paths,
  };
}
