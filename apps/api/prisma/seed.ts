/**
 * Golden dataset'i veritabanına yazar.
 *
 * Kaynak @gbsoft/seed paketidir; arayüzün demo modu ve solver regresyon
 * testleri de aynı üreticiyi kullanır. Script idempotenttir: aynı kiracı ve
 * tesis için tekrar çalıştırılırsa mevcut kayıtları siler ve yeniden kurar.
 *
 * Bu veri kurgusal bir tesise aittir. Gerçek müşteri verisi bağlanana kadar
 * plan KPI'ları "tahmin" olarak gösterilir; ölçülmüş kazanç değildir.
 */

import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { EquipmentClass, HandlingClass, Prisma, RackSide } from "@prisma/client";
import {
  DEFAULT_PACKAGE_TYPES,
  DEFAULT_VEHICLE_TEMPLATES,
  DEFAULT_PICK_TIME_PARAMETERS,
  PROFILE_PRESETS,
  type ObjectiveProfile,
} from "@gbsoft/domain";
import {
  AISLE_FACES,
  CURRENT_USER,
  DEMO_SLOT_PLAN,
  FACILITY,
  FACILITY_LAYOUT,
  LOCATIONS,
  MISSING_DIMENSION_SKUS,
  MOVE_TASKS,
  PACKAGE_LABELS,
  RECOMMENDATIONS,
  RESERVE_LOCATION,
  SKUS,
  VERSIONS,
  ZONE_LABELS,
} from "@gbsoft/seed";
import { evaluateDataQuality } from "../src/quality/engine.js";
import { rebuildLayoutGraph } from "../src/twin/graph.js";

// Ortam değişkenleri monorepo kökündeki tek .env dosyasından okunur.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
} catch {
  // .env yoksa gerçek ortam değişkenleriyle devam edilir.
}

const prisma = new PrismaClient();

const TENANT_ID = process.env.DEFAULT_TENANT_ID ?? "gbsoft-pilot";
const SNAPSHOT_AT = new Date(FACILITY.snapshotAt);

const EQUIPMENT: Record<string, EquipmentClass> = {
  manual: "MANUAL",
  cart: "CART",
  forklift: "FORKLIFT",
};

const HANDLING: Record<string, HandlingClass> = {
  standard: "STANDARD",
  fragile: "FRAGILE",
  heavy: "HEAVY",
};

async function main() {
  console.log(`Golden dataset yükleniyor · kiracı ${TENANT_ID}`);

  await prisma.$transaction(async (tx) => {
    // --- Kiracı ---------------------------------------------------------
    await tx.tenant.upsert({
      where: { id: TENANT_ID },
      update: {},
      create: { id: TENANT_ID, name: "GBSoft Pilot" },
    });

    // Tesis varsa bağımlılık sırasına göre temizlenir.
    //
    // Cascade'e güvenilmez: SlotRecommendation.sku ilişkisi bilinçli olarak
    // Restrict'tir (plana girmiş bir SKU sessizce silinemez), bu yüzden
    // çocuk tablolar önce boşaltılır.
    const existing = await tx.facility.findUnique({
      where: { tenantId_code: { tenantId: TENANT_ID, code: FACILITY.id } },
      select: { id: true },
    });

    if (existing) {
      const scope = { tenantId: TENANT_ID };
      const planIds = (
        await tx.slotPlan.findMany({
          where: { ...scope, facilityId: existing.id },
          select: { id: true },
        })
      ).map((p) => p.id);

      await tx.moveDependency.deleteMany({
        where: { ...scope, task: { planId: { in: planIds } } },
      });
      await tx.moveTask.deleteMany({ where: { ...scope, planId: { in: planIds } } });
      await tx.slotAlternative.deleteMany({
        where: { ...scope, recommendation: { planId: { in: planIds } } },
      });
      await tx.slotRecommendation.deleteMany({
        where: { ...scope, planId: { in: planIds } },
      });
      await tx.planLock.deleteMany({ where: { ...scope, planId: { in: planIds } } });
      await tx.planExclusion.deleteMany({
        where: { ...scope, planId: { in: planIds } },
      });
      await tx.slotPlan.deleteMany({ where: { ...scope, facilityId: existing.id } });
      await tx.optimizationRun.deleteMany({
        where: { ...scope, facilityId: existing.id },
      });
      await tx.skuPlacement.deleteMany({
        where: { ...scope, sku: { facilityId: existing.id } },
      });
      // Outbound tarafı (Faz 6.5 ve 7): satırlar SKU'ya `Restrict` ile
      // bağlıdır — plana girmiş bir SKU sessizce silinemez. Bu yüzden
      // sevkiyat ve yükleme siparişleri tesisten önce temizlenir.
      await tx.pickOrder.deleteMany({ where: { ...scope, facilityId: existing.id } });
      await tx.shipment.deleteMany({ where: { ...scope, facilityId: existing.id } });
      await tx.objectiveProfile.deleteMany({ where: scope });
      await tx.facility.delete({ where: { id: existing.id } });
    }

    const facility = await tx.facility.create({
      data: {
        tenantId: TENANT_ID,
        code: FACILITY.id,
        name: FACILITY.name,
        city: FACILITY.city,
      },
    });

    await tx.user.upsert({
      where: {
        tenantId_email: { tenantId: TENANT_ID, email: "ayse.yilmaz@gbsoft.example" },
      },
      update: {},
      create: {
        tenantId: TENANT_ID,
        email: "ayse.yilmaz@gbsoft.example",
        fullName: CURRENT_USER.name,
        role: "WAREHOUSE_MANAGER",
      },
    });

    // --- Dijital ikiz sürümü --------------------------------------------
    const layoutVersion = await tx.layoutVersion.create({
      data: {
        tenantId: TENANT_ID,
        facilityId: facility.id,
        version: FACILITY_LAYOUT.layoutVersion,
        viewBoxWidth: FACILITY_LAYOUT.viewBox.width,
        viewBoxHeight: FACILITY_LAYOUT.viewBox.height,
        unitsPerMeter: FACILITY_LAYOUT.unitsPerMeter,
        dockAnchorX: FACILITY_LAYOUT.dockAnchor.x,
        dockAnchorY: FACILITY_LAYOUT.dockAnchor.y,
        isActive: true,
        note: "Golden dataset · parametrik ikiz",
        createdAt: SNAPSHOT_AT,
      },
    });

    const zoneIdByCode = new Map<string, string>();
    for (const zone of FACILITY_LAYOUT.zones) {
      const row = await tx.zone.create({
        data: {
          tenantId: TENANT_ID,
          layoutVersionId: layoutVersion.id,
          code: zone.code,
          name: ZONE_LABELS[zone.code],
        },
      });
      zoneIdByCode.set(zone.code, row.id);
    }

    const aisleIdByNumber = new Map<number, string>();
    const rackFaceIdByKey = new Map<string, string>();
    for (const aisle of FACILITY_LAYOUT.aisles) {
      const aisleRow = await tx.aisle.create({
        data: {
          tenantId: TENANT_ID,
          layoutVersionId: layoutVersion.id,
          number: aisle.number,
          x: aisle.x,
          walkwayWidth: aisle.walkwayWidth,
          congestionScore: aisle.congestionScore,
        },
      });
      aisleIdByNumber.set(aisle.number, aisleRow.id);

      for (const face of aisle.faces) {
        const faceRow = await tx.rackFace.create({
          data: {
            tenantId: TENANT_ID,
            layoutVersionId: layoutVersion.id,
            aisleId: aisleRow.id,
            zoneId: zoneIdByCode.get(face.zone)!,
            side: face.side.toUpperCase() as RackSide,
            x: face.x,
            width: face.width,
          },
        });
        rackFaceIdByKey.set(`${aisle.number}:${face.side}`, faceRow.id);
      }
    }

    await tx.floorArea.createMany({
      data: FACILITY_LAYOUT.floorAreas.map((area) => ({
        tenantId: TENANT_ID,
        layoutVersionId: layoutVersion.id,
        code: area.id,
        label: area.label,
        kind: area.kind,
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
      })),
    });

    // --- Lokasyonlar -----------------------------------------------------
    const faceSideOf = (locationZone: string, aisleNumber: number) => {
      const faces = AISLE_FACES.find((f) => f.aisle === aisleNumber)!;
      return faces.left === locationZone ? "left" : "right";
    };

    await tx.location.createMany({
      data: LOCATIONS.map((loc) => ({
        tenantId: TENANT_ID,
        layoutVersionId: layoutVersion.id,
        zoneId: zoneIdByCode.get(loc.zone)!,
        aisleId: aisleIdByNumber.get(loc.aisle)!,
        rackFaceId: rackFaceIdByKey.get(
          `${loc.aisle}:${faceSideOf(loc.zone, loc.aisle)}`,
        )!,
        code: loc.id,
        bay: loc.bay,
        level: loc.level,
        x: loc.x,
        y: loc.y,
        width: loc.width,
        height: loc.height,
        maxWeightKg: loc.maxWeightKg,
        maxVolumeM3: loc.maxVolumeM3,
        equipment: EQUIPMENT[loc.equipment],
        goldenZone: loc.goldenZone,
        distanceToDockM: loc.distanceToDockM,
        congestionScore: loc.congestionScore,
        blocked: loc.blocked,
        blockedReason: loc.blockedReason ?? null,
        dataQuality: loc.dataQuality,
      })),
    });

    await rebuildLayoutGraph(tx, TENANT_ID, layoutVersion.id);

    const locationRows = await tx.location.findMany({
      where: { tenantId: TENANT_ID, layoutVersionId: layoutVersion.id },
      select: { id: true, code: true },
    });
    const locationIdByCode = new Map(locationRows.map((l) => [l.code, l.id]));

    // --- SKU'lar ---------------------------------------------------------
    const missingDims = new Set(MISSING_DIMENSION_SKUS);

    await tx.sku.createMany({
      data: SKUS.map((sku) => ({
        tenantId: TENANT_ID,
        facilityId: facility.id,
        code: sku.id,
        name: sku.name,
        category: sku.category,
        handling: HANDLING[sku.handling],
        sourceSystem: "seed",
        sourceId: sku.id,
      })),
    });

    const skuRows = await tx.sku.findMany({
      where: { tenantId: TENANT_ID, facilityId: facility.id },
      select: { id: true, code: true },
    });
    const skuIdByCode = new Map(skuRows.map((s) => [s.code, s.id]));

    await tx.identityMap.createMany({
      data: SKUS.map((sku) => ({
        tenantId: TENANT_ID,
        facilityId: facility.id,
        entityType: "sku",
        sourceSystem: "seed",
        sourceId: sku.id,
        canonicalCode: sku.id,
        firstSeenAt: SNAPSHOT_AT,
        lastSeenAt: SNAPSHOT_AT,
      })),
    });

    await tx.skuDimension.createMany({
      data: SKUS.map((sku) => ({
        tenantId: TENANT_ID,
        skuId: skuIdByCode.get(sku.id)!,
        widthCm: sku.widthCm,
        depthCm: sku.depthCm,
        heightCm: sku.heightCm,
        weightKg: sku.weightKg,
        source: missingDims.has(sku.id) ? "manual" : "import",
        measuredAt: missingDims.has(sku.id) ? null : SNAPSHOT_AT,
      })),
    });

    // Hız anlık görüntüsü: planın referans aldığı ölçüm penceresi.
    const windowStart = new Date(SNAPSHOT_AT);
    windowStart.setDate(windowStart.getDate() - 14);

    await tx.velocitySnapshot.createMany({
      data: SKUS.map((sku) => ({
        tenantId: TENANT_ID,
        skuId: skuIdByCode.get(sku.id)!,
        windowStart,
        windowEnd: SNAPSHOT_AT,
        velocityClass: sku.velocityClass,
        picksPerDay: sku.picksPerDay,
        unitsPerPick: sku.unitsPerPick,
        replenishmentsPerDay: sku.replenishmentsPerDay,
      })),
    });

    const affinities = SKUS.flatMap((sku) =>
      sku.affinitySkuIds
        .filter((related) => skuIdByCode.has(related))
        .map((related) => ({
          tenantId: TENANT_ID,
          skuId: skuIdByCode.get(sku.id)!,
          relatedSkuId: skuIdByCode.get(related)!,
          coPickRate: 0.42,
        })),
    );
    if (affinities.length > 0) {
      await tx.skuAffinity.createMany({ data: affinities });
    }

    // Yerleşim: rezervdeki SKU'ların pick gözü yoktur.
    await tx.skuPlacement.createMany({
      data: SKUS.filter(
        (sku) =>
          sku.currentLocationId !== RESERVE_LOCATION &&
          locationIdByCode.has(sku.currentLocationId),
      ).map((sku) => ({
        tenantId: TENANT_ID,
        skuId: skuIdByCode.get(sku.id)!,
        locationId: locationIdByCode.get(sku.currentLocationId)!,
        effectiveFrom: windowStart,
      })),
    });

    // --- Dalgalar --------------------------------------------------------
    // 38 açık wave, toplam 2.840 order line. Dağılım deterministiktir:
    // son wave kalan farkı alır, böylece toplam tesis özetiyle birebir eşleşir.
    const slaCutoff = new Date(SNAPSHOT_AT);
    slaCutoff.setHours(18, 0, 0, 0);

    const basePerWave = Math.floor(
      FACILITY.dailyOrderLines / FACILITY.openWaveCount,
    );
    const waveData = Array.from(
      { length: FACILITY.openWaveCount },
      (_, index) => {
        const isLast = index === FACILITY.openWaveCount - 1;
        const orderLines = isLast
          ? FACILITY.dailyOrderLines -
            basePerWave * (FACILITY.openWaveCount - 1)
          : basePerWave;
        const plannedStart = new Date(SNAPSHOT_AT);
        plannedStart.setHours(8 + Math.floor(index / 4), (index % 4) * 15, 0, 0);
        return {
          tenantId: TENANT_ID,
          facilityId: facility.id,
          code: `W-${2240 + index}`,
          plannedStart,
          slaCutoff,
          status: index < 6 ? "risk" : "acik",
          orderLines,
        };
      },
    );
    await tx.wave.createMany({ data: waveData });

    // --- Süre modeli -----------------------------------------------------
    await tx.pickTimeModel.create({
      data: {
        tenantId: TENANT_ID,
        facilityId: facility.id,
        version: VERSIONS.model,
        parameters: DEFAULT_PICK_TIME_PARAMETERS as unknown as Prisma.InputJsonValue,
        algorithm: "analytic-baseline-v1",
        metrics: {
          minimumSampleSize: 200,
          note: "Gerçek WMS görev etiketi gelene kadar baseline",
        },
        // Gerçek olay verisi bağlanana kadar model kalibre sayılmaz.
        calibrated: false,
        sampleSize: 0,
        isActive: true,
      },
    });

    // --- Paket profilleri (Faz 7) -----------------------------------------
    // Ölçüler saha varsayılanıdır ve **ölçülmemiştir**; gerçek tesiste
    // `package-type` verisiyle değiştirilir.
    const packageTypeIdByCode = new Map<string, string>();
    for (const type of DEFAULT_PACKAGE_TYPES) {
      const row = await tx.packageType.upsert({
        where: { tenantId_code: { tenantId: TENANT_ID, code: type.code } },
        update: {},
        create: {
          tenantId: TENANT_ID,
          code: type.code,
          name: type.name,
          shape: type.shape,
          lengthM: type.lengthM,
          widthM: type.widthM,
          heightM: type.heightM,
          tareKg: type.tareKg,
          rotation: type.rotation,
          maxTopLoadKg: type.maxTopLoadKg,
          minSupportRatio: type.minSupportRatio,
          stackable: type.stackable,
          fragile: type.fragile,
          compressionTolerancePct: type.compressionTolerancePct,
          temperatureClass: type.temperatureClass,
          segregationGroup: type.segregationGroup ?? null,
        },
      });
      packageTypeIdByCode.set(type.code, row.id);
    }

    // --- Araç şablonları (Faz 8.1) ------------------------------------
    // Bunlar demo/golden varsayımlardır; canlı kullanımdan önce üretici
    // belgesi veya saha ölçümüyle ayrı bir sürüm olarak doğrulanmalıdır.
    for (const vehicle of DEFAULT_VEHICLE_TEMPLATES) {
      const data = {
        name: vehicle.name,
        kind: vehicle.kind,
        internalLengthM: vehicle.internalLengthM,
        internalWidthM: vehicle.internalWidthM,
        internalHeightM: vehicle.internalHeightM,
        rearDoorWidthM: vehicle.rearDoor.widthM,
        rearDoorHeightM: vehicle.rearDoor.heightM,
        rearDoorSillM: vehicle.rearDoor.sillHeightM,
        maxPayloadKg: vehicle.maxPayloadKg,
        axleGroups: vehicle.axleGroups as unknown as Prisma.InputJsonValue,
        obstacles: vehicle.obstacles as unknown as Prisma.InputJsonValue,
        cogMinX: vehicle.cogEnvelope.minX,
        cogMaxX: vehicle.cogEnvelope.maxX,
        cogMinY: vehicle.cogEnvelope.minY,
        cogMaxY: vehicle.cogEnvelope.maxY,
        cogMaxZ: vehicle.cogEnvelope.maxZ,
        rulesVersion: vehicle.rulesVersion,
        geometrySource: vehicle.geometrySource,
      };
      await tx.vehicleTemplate.upsert({
        where: { tenantId_code: { tenantId: TENANT_ID, code: vehicle.code } },
        update: data,
        create: { tenantId: TENANT_ID, code: vehicle.code, ...data },
      });
    }

    // --- Örnek outbound sevkiyatı (Faz 7.3) -----------------------------
    // Plan seed'e gömülmez: kullanıcı Palet Studio'da aynı canlı API ve
    // optimizer hattıyla üretir. Böylece ekran statik bir 3B maket değildir.
    const shipment = await tx.shipment.create({
      data: {
        tenantId: TENANT_ID,
        facilityId: facility.id,
        code: "SHP-DEMO-001",
        carrierCode: "GBS-TR-34",
        status: "READY",
        plannedDepartureAt: new Date(SNAPSHOT_AT.getTime() + 6 * 60 * 60 * 1000),
        stops: {
          create: [
            { tenantId: TENANT_ID, seq: 1, code: "IST-01", name: "İstanbul Avrupa" },
            { tenantId: TENANT_ID, seq: 2, code: "GEB-02", name: "Gebze" },
            { tenantId: TENANT_ID, seq: 3, code: "BUR-03", name: "Bursa" },
          ],
        },
      },
      include: { stops: { select: { id: true, code: true } } },
    });
    const stopIdByCode = new Map(shipment.stops.map((stop) => [stop.code, stop.id]));
    const outboundTypes = [
      "CASE-STD",
      "CASE-STD",
      "CASE-FRAGILE",
      "SACK",
      "CASE-STD",
      "DRUM-200L",
    ];
    const outboundStops = ["IST-01", "GEB-02", "BUR-03", "IST-01", "GEB-02", "BUR-03"];
    const outboundQuantities = [6, 4, 3, 3, 4, 2];
    await tx.shipmentLine.createMany({
      data: SKUS.slice(0, 6).map((sku, index) => ({
        tenantId: TENANT_ID,
        shipmentId: shipment.id,
        stopId: stopIdByCode.get(outboundStops[index])!,
        lineNo: index + 1,
        skuId: skuIdByCode.get(sku.id)!,
        packageTypeId: packageTypeIdByCode.get(outboundTypes[index])!,
        quantity: outboundQuantities[index],
      })),
    });

    // --- Amaç profilleri -------------------------------------------------
    const profileIdByKey = new Map<string, string>();
    for (const key of Object.keys(PROFILE_PRESETS) as ObjectiveProfile[]) {
      const preset = PROFILE_PRESETS[key];
      const row = await tx.objectiveProfile.create({
        data: {
          tenantId: TENANT_ID,
          key,
          label: preset.label,
          description: preset.description,
          pickingTimeWeight: preset.weights.pickingTime,
          replenishmentWeight: preset.weights.replenishment,
          congestionWeight: preset.weights.congestion,
          moveCostWeight: preset.weights.moveCost,
          defaultMoveBudget: preset.moveBudget,
        },
      });
      profileIdByKey.set(key, row.id);
    }

    // --- Slot planı ------------------------------------------------------
    const plan = await tx.slotPlan.create({
      data: {
        tenantId: TENANT_ID,
        facilityId: facility.id,
        layoutVersionId: layoutVersion.id,
        code: DEMO_SLOT_PLAN.id,
        objectiveProfileId: profileIdByKey.get("balanced")!,
        state: "READY",
        snapshotAt: SNAPSHOT_AT,
        solverVersion: DEMO_SLOT_PLAN.solverVersion,
        modelVersion: DEMO_SLOT_PLAN.modelVersion,
        netOperationDeltaPct: DEMO_SLOT_PLAN.netOperationDeltaPct,
        pickingTimeDeltaPct: DEMO_SLOT_PLAN.pickingTimeDeltaPct,
        walkingDeltaPct: DEMO_SLOT_PLAN.walkingDeltaPct,
        replenishmentDeltaPct: DEMO_SLOT_PLAN.replenishmentDeltaPct,
        moveTaskCount: DEMO_SLOT_PLAN.moveTaskCount,
        moveHours: DEMO_SLOT_PLAN.moveHours,
        affectedSkuCount: DEMO_SLOT_PLAN.affectedSkuCount,
        hardViolationCount: DEMO_SLOT_PLAN.hardViolationCount,
        createdAt: new Date(DEMO_SLOT_PLAN.createdAt),
        createdByLabel: DEMO_SLOT_PLAN.createdBy,
      },
    });

    for (const rec of RECOMMENDATIONS) {
      const created = await tx.slotRecommendation.create({
        data: {
          tenantId: TENANT_ID,
          planId: plan.id,
          skuId: skuIdByCode.get(rec.skuId)!,
          sourceLocationId: locationIdByCode.get(rec.sourceLocationId)!,
          targetLocationId: locationIdByCode.get(rec.targetLocationId)!,
          expectedSecondsPerLineDelta: rec.expectedSecondsPerLineDelta,
          p90SecondsPerLineDelta: rec.p90SecondsPerLineDelta,
          replenishmentDeltaPerDay: rec.replenishmentDeltaPerDay,
          moveHours: rec.moveHours,
          reasons: rec.reasons,
          tradeoffs: rec.tradeoffs,
          hardConstraintsPassed: rec.hardConstraintsPassed,
          confidencePct: rec.confidencePct,
        },
      });

      const alternatives = rec.alternatives.filter((alt) =>
        locationIdByCode.has(alt.locationId),
      );
      if (alternatives.length > 0) {
        await tx.slotAlternative.createMany({
          data: alternatives.map((alt, index) => ({
            tenantId: TENANT_ID,
            recommendationId: created.id,
            locationId: locationIdByCode.get(alt.locationId)!,
            rank: index + 1,
            netSecondsDelta: alt.netSecondsDelta,
            pickingQuality: alt.picking,
            replenishmentDeltaPerDay: alt.replenishmentDeltaPerDay,
            congestionLevel: alt.congestion,
            status: alt.status,
            blockedReason: alt.blockedReason ?? null,
          })),
        });
      }
    }

    // --- Taşıma görevleri ------------------------------------------------
    for (const task of MOVE_TASKS) {
      await tx.moveTask.create({
        data: {
          tenantId: TENANT_ID,
          planId: plan.id,
          seq: task.seq,
          code: task.id,
          kind: task.kind.toUpperCase() as "VACATE" | "MOVE" | "VERIFY" | "OPEN",
          label: task.label,
          skuId: task.skuId ? skuIdByCode.get(task.skuId) : null,
          sourceLocationCode: task.sourceLocationId,
          targetLocationCode: task.targetLocationId,
          zoneCode: task.zone,
          loadLabel: task.loadLabel,
          loadHours: task.loadHours,
          packageKey: task.packageId,
          packageLabel: PACKAGE_LABELS[task.packageId] ?? task.packageId,
          expectedBenefitPct: task.expectedBenefitPct,
          status: task.dependsOn.length > 0 ? "WAITING" : "READY",
        },
      });
    }

    const taskRows = await tx.moveTask.findMany({
      where: { tenantId: TENANT_ID, planId: plan.id },
      select: { id: true, seq: true },
    });
    const taskIdBySeq = new Map(taskRows.map((t) => [t.seq, t.id]));

    const dependencies = MOVE_TASKS.flatMap((task) =>
      task.dependsOn.map((prerequisiteSeq) => ({
        tenantId: TENANT_ID,
        taskId: taskIdBySeq.get(task.seq)!,
        prerequisiteId: taskIdBySeq.get(prerequisiteSeq)!,
        reason: "Hedef göz bu görevle boşalıyor",
      })),
    );
    if (dependencies.length > 0) {
      await tx.moveDependency.createMany({ data: dependencies });
    }

    // --- Veri kalitesi ---------------------------------------------------
    // Fixture sorunları kopyalanmaz; Faz 2 motoru gerçek kayıtları ölçer ve
    // yayın kapısını aynı transaction içinde üretir.
    await evaluateDataQuality(tx, TENANT_ID, facility.id);
  }, { timeout: 120_000 });

  const counts = await Promise.all([
    prisma.location.count({ where: { tenantId: TENANT_ID } }),
    prisma.sku.count({ where: { tenantId: TENANT_ID } }),
    prisma.slotRecommendation.count({ where: { tenantId: TENANT_ID } }),
    prisma.moveTask.count({ where: { tenantId: TENANT_ID } }),
    prisma.moveDependency.count({ where: { tenantId: TENANT_ID } }),
    prisma.graphNode.count({ where: { tenantId: TENANT_ID } }),
  ]);

  console.log(
    `Tamamlandı · ${counts[0]} lokasyon · ${counts[1]} SKU · ` +
      `${counts[2]} öneri · ${counts[3]} taşıma görevi · ${counts[4]} bağımlılık · ` +
      `${counts[5]} graph node`,
  );
}

main()
  .catch((error) => {
    console.error("Seed başarısız:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
