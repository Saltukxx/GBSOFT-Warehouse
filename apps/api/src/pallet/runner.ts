import type { Prisma } from "@prisma/client";
import type { PackageType, PalletPlacement, PalletViolation } from "@gbsoft/domain";
import { validatePalletPlan } from "@gbsoft/domain";
import { prisma } from "../db.js";
import { solvePallet, type PalletSolveRequest } from "./client.js";

/**
 * Palet planı çalıştırması (Faz 7.2).
 *
 * Akışın omurgası **doğrulama kapısıdır**: çözücü bir plan üretir, ama plan
 * `@gbsoft/domain`'deki bağımsız doğrulayıcıdan geçmeden `VALIDATED` durumuna
 * geçemez ve yayınlanamaz. Doğrulayıcı çözücünün hiçbir iç yapısını bilmez;
 * geometriyi ve fiziği sıfırdan hesaplar.
 *
 * İhlalli plan silinmez — `REJECTED` olarak ihlalleriyle birlikte saklanır.
 * Kullanıcı neyin neden reddedildiğini görmek zorundadır.
 */

const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Palet tabanı olarak kullanılacak paket türü. */
const DEFAULT_BASE_TYPE_CODE = "PALLET-EUR";

export type PalletRunRequest = {
  shipmentId: string;
  baseTypeCode?: string;
  maxHeightM?: number;
  maxWeightKg?: number;
  timeLimitMs?: number;
  /** Mevcut editör kilitlerini fixed obstacle olarak korur. */
  keepLocked?: boolean;
};

export type PreparedPalletRun = {
  runId: string;
  handlingUnitCount: number;
};

type DbPackageType = Awaited<ReturnType<typeof prisma.packageType.findMany>>[number];

/** Veritabanı satırını alan modelinin paket profiline çevirir. */
export function toDomainType(row: DbPackageType): PackageType {
  return {
    code: row.code,
    name: row.name,
    shape: row.shape as PackageType["shape"],
    lengthM: row.lengthM,
    widthM: row.widthM,
    heightM: row.heightM,
    tareKg: row.tareKg,
    rotation: row.rotation as PackageType["rotation"],
    maxTopLoadKg: row.maxTopLoadKg,
    minSupportRatio: row.minSupportRatio,
    stackable: row.stackable,
    fragile: row.fragile,
    compressionTolerancePct: row.compressionTolerancePct,
    temperatureClass: row.temperatureClass as PackageType["temperatureClass"],
    ...(row.segregationGroup ? { segregationGroup: row.segregationGroup } : {}),
  };
}

/**
 * Sevkiyat satırlarından elleçleme birimleri üretir.
 *
 * `quantity` adet birim, satır başına deterministik kodlarla açılır. İşlem
 * idempotenttir: aynı sevkiyat ikinci kez planlanınca yeni birim doğmaz,
 * mevcut kodlar yeniden kullanılır. Aksi hâlde her çalıştırma stok yaratırdı.
 */
export async function ensureHandlingUnits(
  tenantId: string,
  shipmentId: string,
): Promise<number> {
  const shipment = await prisma.shipment.findFirst({
    where: { tenantId, id: shipmentId },
    include: {
      lines: {
        orderBy: { lineNo: "asc" },
        include: { packageType: true, stop: { select: { id: true } } },
      },
    },
  });
  if (!shipment) throw new Error("Sevkiyat bulunamadı.");

  const existing = await prisma.handlingUnit.findMany({
    where: { tenantId, shipmentId },
    select: { code: true },
  });
  const known = new Set(existing.map((unit) => unit.code));

  const toCreate: Prisma.HandlingUnitCreateManyInput[] = [];
  for (const line of shipment.lines) {
    for (let index = 1; index <= line.quantity; index += 1) {
      const code = `${shipment.code}-L${String(line.lineNo).padStart(3, "0")}-${String(index).padStart(3, "0")}`;
      if (known.has(code)) continue;
      toCreate.push({
        tenantId,
        shipmentId,
        code,
        packageTypeId: line.packageTypeId,
        skuId: line.skuId,
        stopId: line.stop.id,
        // Bir birimin içindeki SKU adedi. Koli satırında 1'dir; palet birim
        // yükünde paletin üzerindeki koli sayısıdır ve ağırlık farkını bu
        // yapar — 27 paletlik bir sevkiyat bu alan olmadan 27 × dara ederdi.
        quantity: line.unitsPerHandlingUnit,
        // Brüt ağırlık dara + içerikten oluşur. İçerik ağırlığı SKU ölçüsünden
        // gelir; ölçü yoksa yalnız dara bilinir ve bu açıkça eksik veridir.
        grossWeightKg: line.packageType.tareKg,
      });
    }
  }

  if (toCreate.length > 0) {
    await prisma.handlingUnit.createMany({ data: toCreate });
  }

  return prisma.handlingUnit.count({ where: { tenantId, shipmentId } });
}

/** İçerik ağırlığını SKU ölçüsünden tamamlar. */
export async function fillGrossWeights(tenantId: string, shipmentId: string) {
  const units = await prisma.handlingUnit.findMany({
    where: { tenantId, shipmentId },
    include: {
      packageType: { select: { tareKg: true } },
      sku: { select: { dimension: { select: { weightKg: true } } } },
    },
  });

  for (const unit of units) {
    const contentKg = unit.sku?.dimension?.weightKg ?? 0;
    const gross = unit.packageType.tareKg + contentKg * unit.quantity;
    if (Math.abs(gross - unit.grossWeightKg) > 1e-6) {
      await prisma.handlingUnit.update({
        where: { id: unit.id },
        data: { grossWeightKg: gross },
      });
    }
  }
}

export async function preparePalletRun(
  tenantId: string,
  request: PalletRunRequest,
): Promise<PreparedPalletRun> {
  const shipment = await prisma.shipment.findFirst({
    where: {
      tenantId,
      OR: [{ id: request.shipmentId }, { code: request.shipmentId }],
    },
    include: { lines: { select: { id: true } } },
  });
  if (!shipment) throw new Error(`Sevkiyat bulunamadı: ${request.shipmentId}`);
  if (shipment.lines.length === 0) {
    throw new Error("Sevkiyatta satır yok; palet planı üretilemez.");
  }

  const handlingUnitCount = await ensureHandlingUnits(tenantId, shipment.id);
  await fillGrossWeights(tenantId, shipment.id);

  const [packageTypes, units] = await Promise.all([
    prisma.packageType.findMany({ where: { tenantId }, orderBy: { code: "asc" } }),
    prisma.handlingUnit.findMany({
      where: { tenantId, shipmentId: shipment.id },
      orderBy: { code: "asc" },
      include: {
        packageType: { select: { code: true } },
        stop: { select: { code: true } },
      },
    }),
  ]);

  const currentPlacements = request.keepLocked
    ? await prisma.palletPlacement.findMany({
        where: {
          tenantId,
          plan: { shipmentId: shipment.id },
        },
        orderBy: [{ plan: { seq: "asc" } }, { seq: "asc" }],
        include: {
          plan: { select: { seq: true } },
          hu: { select: { code: true } },
        },
      })
    : [];
  // Üstteki birim kilitlenirse taşıyıcı zinciri de sabit kalmalıdır;
  // aksi hâlde fixed obstacle havada başlar. Bu kapanış kullanıcı kilidinin
  // fiziksel anlamıdır, gizli bir solver varsayımı değildir.
  const fixedIds = new Set(
    currentPlacements.filter((placement) => placement.locked).map((placement) => placement.id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const placement of currentPlacements) {
      if (!fixedIds.has(placement.id) || placement.y <= 1e-4) continue;
      for (const supporter of currentPlacements) {
        if (supporter.planId !== placement.planId || supporter.id === placement.id) continue;
        const touching = Math.abs(supporter.y + supporter.heightM - placement.y) <= 1e-4;
        const overlapX =
          Math.min(supporter.x + supporter.lengthM, placement.x + placement.lengthM) -
          Math.max(supporter.x, placement.x);
        const overlapZ =
          Math.min(supporter.z + supporter.widthM, placement.z + placement.widthM) -
          Math.max(supporter.z, placement.z);
        if (touching && overlapX > 1e-4 && overlapZ > 1e-4 && !fixedIds.has(supporter.id)) {
          fixedIds.add(supporter.id);
          changed = true;
        }
      }
    }
  }
  const lockedPlacements = currentPlacements.filter((placement) => fixedIds.has(placement.id));

  const baseCode = request.baseTypeCode ?? DEFAULT_BASE_TYPE_CODE;
  const baseType = packageTypes.find((type) => type.code === baseCode);
  if (!baseType) {
    throw new Error(
      `Palet tabanı paket türü tanımlı değil: ${baseCode}. Önce package-type verisini yükleyin.`,
    );
  }

  const input: PalletSolveRequest = {
    run_id: "pending",
    seed: 42,
    time_limit_ms: request.timeLimitMs ?? 10_000,
    base: {
      package_type_code: baseType.code,
      length_m: baseType.lengthM,
      width_m: baseType.widthM,
      deck_height_m: baseType.heightM,
      max_height_m: request.maxHeightM ?? 1.8,
      max_weight_kg: request.maxWeightKg ?? baseType.maxTopLoadKg,
    },
    package_types: packageTypes.map((type) => ({
      code: type.code,
      length_m: type.lengthM,
      width_m: type.widthM,
      height_m: type.heightM,
      rotation: type.rotation as "fixed" | "yaw" | "any",
      max_top_load_kg: type.maxTopLoadKg,
      min_support_ratio: type.minSupportRatio,
      stackable: type.stackable,
      fragile: type.fragile,
      temperature_class: type.temperatureClass as "ambient" | "chilled" | "frozen",
      segregation_group: type.segregationGroup,
    })),
    items: units.map((unit) => ({
      hu_code: unit.code,
      package_type_code: unit.packageType.code,
      gross_weight_kg: Math.max(0.001, unit.grossWeightKg),
      stop_code: unit.stop?.code ?? null,
    })),
    fixed_placements: lockedPlacements.map((placement) => ({
      hu_code: placement.hu.code,
      pallet_seq: placement.plan.seq,
      x: placement.x,
      y: placement.y,
      z: placement.z,
      length_m: placement.lengthM,
      width_m: placement.widthM,
      height_m: placement.heightM,
      seq: placement.seq,
    })),
  };

  const run = await prisma.optimizationRun.create({
    data: {
      tenantId,
      facilityId: shipment.facilityId,
      kind: "PALLET",
      status: "QUEUED",
      solverVersion: "pallet-extreme-point-1.1.0",
      modelVersion: "package-profile-v1",
      objectiveProfileKey: "pallet-default",
      parameters: json({
        shipmentId: shipment.id,
        shipmentCode: shipment.code,
        baseTypeCode: baseType.code,
        baseTypeId: baseType.id,
        maxHeightM: input.base.max_height_m,
        maxWeightKg: input.base.max_weight_kg,
      }),
      constraints: json({
        handlingUnitCount,
        fixedPlacementCount: input.fixed_placements.length,
      }),
      inputSnapshot: json(input),
      seed: input.seed,
      timeLimitMs: input.time_limit_ms,
      snapshotAt: new Date(),
    },
  });

  input.run_id = run.id;
  await prisma.optimizationRun.update({
    where: { id: run.id },
    data: { inputSnapshot: json(input) },
  });
  await prisma.shipment.update({
    where: { id: shipment.id },
    data: { snapshotAt: run.snapshotAt },
  });

  return { runId: run.id, handlingUnitCount };
}

export async function executePalletRun(runId: string): Promise<void> {
  try {
    const run = await prisma.optimizationRun.update({
      where: { id: runId },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    const input = run.inputSnapshot as unknown as PalletSolveRequest;
    const parameters = run.parameters as {
      shipmentId: string;
      shipmentCode: string;
      baseTypeId: string;
      baseTypeCode: string;
      maxHeightM: number;
      maxWeightKg: number;
    };

    const result = await solvePallet(input);
    const lockedCodes = new Set(
      input.fixed_placements.map((placement) => placement.hu_code),
    );

    if (result.status !== "feasible") {
      await prisma.optimizationRun.update({
        where: { id: runId },
        data: {
          status: "INFEASIBLE",
          solverVersion: result.solver_version,
          solutionQuality: result.solution_quality,
          finishedAt: new Date(),
          solveDurationMs: result.solve_duration_ms,
          infeasibilityReasons: json(result.infeasibility_reasons),
          relaxationOptions: json(result.relaxation_options),
          resultSnapshot: json(result),
        },
      });
      return;
    }

    // --- Bağımsız doğrulama --------------------------------------------
    // Çözücü kendi kısıtlarını uyguladı; şimdi hiçbir iç yapısını bilmeyen
    // doğrulayıcı aynı planı sıfırdan kontrol eder.
    const packageTypeRows = await prisma.packageType.findMany({
      where: { tenantId: run.tenantId },
    });
    const domainTypes = packageTypeRows.map(toDomainType);
    const baseType = packageTypeRows.find(
      (type) => type.id === parameters.baseTypeId,
    );
    if (!baseType) throw new Error("Palet tabanı paket türü kayboldu.");

    const unitsByCode = new Map(
      (
        await prisma.handlingUnit.findMany({
          where: { tenantId: run.tenantId, shipmentId: parameters.shipmentId },
          select: { id: true, code: true },
        })
      ).map((unit) => [unit.code, unit.id]),
    );

    const validated = result.pallets.map((pallet) => {
      const placements: PalletPlacement[] = pallet.placements.map((placement) => ({
        huCode: placement.hu_code,
        packageTypeCode: placement.package_type_code,
        x: placement.x,
        y: placement.y,
        z: placement.z,
        lengthM: placement.length_m,
        widthM: placement.width_m,
        heightM: placement.height_m,
        grossWeightKg: placement.gross_weight_kg,
        layer: placement.layer,
        seq: placement.seq,
      }));

      const validation = validatePalletPlan(
        {
          base: {
            code: `${parameters.shipmentCode}-P${pallet.seq}`,
            packageTypeCode: baseType.code,
            lengthM: baseType.lengthM,
            widthM: baseType.widthM,
            deckHeightM: baseType.heightM,
            maxHeightM: parameters.maxHeightM,
            maxWeightKg: parameters.maxWeightKg,
          },
          placements,
        },
        domainTypes,
      );

      return { pallet, placements, validation };
    });

    await prisma.$transaction(async (tx) => {
      // Her çalıştırma kendi planını üretir; eski planlar temizlenir ve
      // hangi koşudan geldikleri `runId` ile bellidir.
      await tx.palletPlan.deleteMany({
        where: { tenantId: run.tenantId, shipmentId: parameters.shipmentId },
      });

      for (const { pallet, placements, validation } of validated) {
        await tx.palletPlan.create({
          data: {
            tenantId: run.tenantId,
            shipmentId: parameters.shipmentId,
            runId,
            seq: pallet.seq,
            code: `${parameters.shipmentCode}-P${String(pallet.seq).padStart(2, "0")}`,
            baseTypeId: parameters.baseTypeId,
            baseLengthM: baseType.lengthM,
            baseWidthM: baseType.widthM,
            deckHeightM: baseType.heightM,
            maxHeightM: parameters.maxHeightM,
            maxWeightKg: parameters.maxWeightKg,
            usedHeightM: validation.usedHeightM,
            usedWeightKg: validation.usedWeightKg,
            volumeUtilizationPct: validation.volumeUtilizationPct,
            footprintUtilizationPct: validation.footprintUtilizationPct,
            cogX: validation.centerOfGravity.x,
            cogY: validation.centerOfGravity.y,
            cogZ: validation.centerOfGravity.z,
            // Kapı burada: doğrulayıcı geçmeyen plan VALIDATED olamaz.
            state: validation.valid ? "VALIDATED" : "REJECTED",
            validatedAt: new Date(),
            violations: json(validation.violations),
            placements: {
              create: placements
                .filter((placement) => unitsByCode.has(placement.huCode))
                .map((placement) => ({
                  tenantId: run.tenantId,
                  huId: unitsByCode.get(placement.huCode)!,
                  x: placement.x,
                  y: placement.y,
                  z: placement.z,
                  lengthM: placement.lengthM,
                  widthM: placement.widthM,
                  heightM: placement.heightM,
                  grossWeightKg: placement.grossWeightKg,
                  layer: placement.layer,
                  seq: placement.seq,
                  locked: lockedCodes.has(placement.huCode),
                })),
            },
          },
        });
      }

      const allValid = validated.every(({ validation }) => validation.valid);
      await tx.shipment.update({
        where: { id: parameters.shipmentId },
        data: { status: allValid ? "PLANNED" : "READY" },
      });

      const violationCount = validated.reduce(
        (sum, { validation }) => sum + validation.violations.length,
        0,
      );

      await tx.optimizationRun.update({
        where: { id: runId },
        data: {
          status: "FEASIBLE",
          solverVersion: result.solver_version,
          solutionQuality: result.solution_quality,
          finishedAt: new Date(),
          solveDurationMs: result.solve_duration_ms,
          objectiveValue: result.pallets.length,
          // Doğrulayıcının bulduğu ihlaller solver'ın "hard violation"
          // sayacına yazılır: plan kendini onaylayamaz.
          hardViolations: violationCount,
          resultSnapshot: json(result),
        },
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.optimizationRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        solutionQuality: "none",
        finishedAt: new Date(),
        errorMessage: message.slice(0, 2_000),
      },
    });
  }
}

export type { PalletViolation };
