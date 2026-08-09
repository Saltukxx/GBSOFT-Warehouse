/**
 * Aktif dijital ikiz sürümünün tek yükleme yolu.
 *
 * 2B layout ucu ve 3B sahne ucu aynı sorgudan ve aynı dönüşümden beslenir.
 * İkisi ayrı sorgu yazsaydı, zamanla iki farklı geometri anlamı doğardı —
 * haritada duran göz sahnede başka yerde çıkardı.
 */

import type {
  AisleGeometry,
  Equipment,
  Facility,
  FacilityLayout,
  FloorAreaKind,
  Location,
  PickTimeModelParameters,
  RackSide,
  Scene3DFloorAreaInput,
  Scene3DLocationInput,
  ZoneId,
} from "@gbsoft/domain";
import {
  DEFAULT_PICK_TIME_PARAMETERS,
  estimateLocationPickTimeSec,
} from "@gbsoft/domain";
import { prisma } from "../db.js";

const EQUIPMENT: Record<string, Equipment> = {
  MANUAL: "manual",
  CART: "cart",
  FORKLIFT: "forklift",
};

/** Vardiya, tesis saatine göre belirlenir. */
function currentShift(now: Date): string {
  const hour = now.getHours();
  if (hour >= 6 && hour < 14) return "Vardiya 1";
  if (hour >= 14 && hour < 22) return "Vardiya 2";
  return "Vardiya 3";
}

export type LoadedLayout = {
  facilityRow: { id: string; code: string; name: string; city: string };
  facility: Facility;
  layout: FacilityLayout;
  locations: Location[];
  /** Aynı gözler, 3B alanlarıyla birlikte. Ölçülmemiş alanlar `null`'dır. */
  scene3dLocations: Scene3DLocationInput[];
  scene3dFloorAreas: Scene3DFloorAreaInput[];
  /** Ölçülmüş bina net yüksekliği (m) veya `null`. */
  clearHeightM: number | null;
};

/**
 * Yükleme sonucu. Eksik tesis ile eksik ikiz sürümü ayrı sonuçlardır: ilki
 * yanlış tesis kodu, ikincisi henüz içe aktarılmamış geometri demektir ve
 * kullanıcının yapması gereken şey farklıdır.
 */
export type LayoutLoadResult =
  | ({ found: true } & LoadedLayout)
  | { found: false; missing: "facility" | "layout-version" };

export async function loadActiveLayout(
  tenantId: string,
  facilityCode: string,
): Promise<LayoutLoadResult> {
  const facility = await prisma.facility.findUnique({
    where: { tenantId_code: { tenantId, code: facilityCode } },
  });
  if (!facility) return { found: false, missing: "facility" };

  const layoutVersion = await prisma.layoutVersion.findFirst({
    where: { tenantId, facilityId: facility.id, isActive: true },
    orderBy: { version: "desc" },
    include: {
      zones: { orderBy: { code: "asc" } },
      floorAreas: { orderBy: { x: "asc" } },
      aisles: {
        orderBy: { number: "asc" },
        include: {
          rackFaces: { orderBy: { side: "asc" }, include: { zone: true } },
        },
      },
      locations: {
        orderBy: [{ code: "asc" }],
        include: { zone: true, aisle: true },
      },
    },
  });
  if (!layoutVersion) return { found: false, missing: "layout-version" };

  const [waveCount, waveTotals, skuCount, pickTimeModel, placements] =
    await Promise.all([
      prisma.wave.count({ where: { tenantId, facilityId: facility.id } }),
      prisma.wave.aggregate({
        where: { tenantId, facilityId: facility.id },
        _sum: { orderLines: true },
      }),
      prisma.sku.count({ where: { tenantId, facilityId: facility.id } }),
      prisma.pickTimeModel.findFirst({
        where: { tenantId, facilityId: facility.id, isActive: true },
        orderBy: { createdAt: "desc" },
      }),
      // Aktif yerleşimler: gözün hız ve replenishment katmanları buradan gelir.
      prisma.skuPlacement.findMany({
        where: { tenantId, effectiveTo: null },
        select: { locationId: true, skuId: true },
      }),
    ]);

  const parameters: PickTimeModelParameters = pickTimeModel
    ? {
        ...DEFAULT_PICK_TIME_PARAMETERS,
        ...(pickTimeModel.parameters as Partial<PickTimeModelParameters>),
      }
    : DEFAULT_PICK_TIME_PARAMETERS;

  // Gözdeki SKU'nun güncel hız anlık görüntüsü.
  const skuIds = placements.map((p) => p.skuId);
  const velocities = skuIds.length
    ? await prisma.velocitySnapshot.findMany({
        where: { tenantId, skuId: { in: skuIds } },
        orderBy: { windowEnd: "desc" },
      })
    : [];
  const velocityBySku = new Map<
    string,
    { picksPerDay: number; replenishmentsPerDay: number }
  >();
  for (const v of velocities) {
    if (!velocityBySku.has(v.skuId)) {
      velocityBySku.set(v.skuId, {
        picksPerDay: v.picksPerDay,
        replenishmentsPerDay: v.replenishmentsPerDay,
      });
    }
  }
  const activityByLocation = new Map<
    string,
    { picksPerDay: number; replenishmentsPerDay: number }
  >();
  for (const placement of placements) {
    const velocity = velocityBySku.get(placement.skuId);
    if (velocity) activityByLocation.set(placement.locationId, velocity);
  }

  const meanDistanceToDockM =
    layoutVersion.locations.reduce((sum, loc) => sum + loc.distanceToDockM, 0) /
    Math.max(1, layoutVersion.locations.length);

  const facilitySummary: Facility = {
    id: facility.code,
    name: facility.name,
    city: facility.city,
    zoneCount: layoutVersion.zones.length,
    aisleCount: layoutVersion.aisles.length,
    locationCount: layoutVersion.locations.length,
    skuCount,
    openWaveCount: waveCount,
    dailyOrderLines: waveTotals._sum.orderLines ?? 0,
    snapshotAt: layoutVersion.createdAt.toISOString(),
    shift: currentShift(new Date()),
  };

  const aisles: AisleGeometry[] = layoutVersion.aisles.map((aisle) => ({
    number: aisle.number,
    x: aisle.x,
    walkwayWidth: aisle.walkwayWidth,
    congestionScore: aisle.congestionScore,
    faces: aisle.rackFaces.map((face) => ({
      side: face.side.toLowerCase() as RackSide,
      zone: face.zone.code as ZoneId,
      x: face.x,
      width: face.width,
    })),
  }));

  const layout: FacilityLayout = {
    facilityCode: facility.code,
    facilityName: facility.name,
    layoutVersion: layoutVersion.version,
    viewBox: {
      width: layoutVersion.viewBoxWidth,
      height: layoutVersion.viewBoxHeight,
    },
    unitsPerMeter: layoutVersion.unitsPerMeter,
    dockAnchor: { x: layoutVersion.dockAnchorX, y: layoutVersion.dockAnchorY },
    zones: layoutVersion.zones.map((zone) => ({
      code: zone.code as ZoneId,
      name: zone.name,
      description: zone.description ?? undefined,
    })),
    aisles,
    floorAreas: layoutVersion.floorAreas.map((area) => ({
      id: area.code,
      label: area.label,
      kind: area.kind as FloorAreaKind,
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
    })),
  };

  // Isı katmanı verileri lokasyon üzerinde taşınır; arayüz skalayı yüklenen
  // kümeden hesaplar, sabit eşik varsaymaz.
  const locations: Location[] = layoutVersion.locations.map((loc) => {
    const activity = activityByLocation.get(loc.id);
    return {
      id: loc.code,
      zone: loc.zone.code as ZoneId,
      aisle: loc.aisle.number,
      bay: loc.bay,
      level: loc.level,
      x: loc.x,
      y: loc.y,
      width: loc.width,
      height: loc.height,
      maxWeightKg: loc.maxWeightKg,
      maxVolumeM3: loc.maxVolumeM3,
      equipment: EQUIPMENT[loc.equipment] ?? "manual",
      goldenZone: loc.goldenZone,
      congestionScore: loc.congestionScore,
      blocked: loc.blocked,
      blockedReason: loc.blockedReason ?? undefined,
      distanceToDockM: loc.distanceToDockM,
      pickTimeSec: estimateLocationPickTimeSec({
        distanceToDockM: loc.distanceToDockM,
        meanDistanceToDockM,
        congestionScore: loc.congestionScore,
        goldenZone: loc.goldenZone,
        parameters,
      }),
      picksPerDay: Math.round(activity?.picksPerDay ?? 0),
      replenishmentsPerDay:
        Math.round((activity?.replenishmentsPerDay ?? 0) * 10) / 10,
      dataQuality: loc.dataQuality,
    };
  });

  const elevationByCode = new Map(
    layoutVersion.locations.map((loc) => [
      loc.code,
      {
        levelElevationM: loc.levelElevationM,
        levelClearHeightM: loc.levelClearHeightM,
        depthM: loc.depthM,
      },
    ]),
  );

  return {
    found: true,
    facilityRow: {
      id: facility.id,
      code: facility.code,
      name: facility.name,
      city: facility.city,
    },
    facility: facilitySummary,
    layout,
    locations,
    scene3dLocations: locations.map((location) => ({
      ...location,
      ...(elevationByCode.get(location.id) ?? {}),
    })),
    scene3dFloorAreas: layoutVersion.floorAreas.map((area) => ({
      id: area.code,
      label: area.label,
      kind: area.kind as FloorAreaKind,
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      heightM: area.heightM,
      traversable: area.traversable,
    })),
    clearHeightM: layoutVersion.clearHeightM,
  };
}
