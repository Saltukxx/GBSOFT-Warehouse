import type {
  TractorSpec,
  VehicleAxleGroup,
  VehicleRegulation,
  VehicleTemplate,
  WeightDistributionReport,
} from "@gbsoft/domain";
import { z } from "zod";
import { prisma } from "../db.js";

const axleGroupsSchema = z.array(
  z.object({
    code: z.string(),
    label: z.string(),
    positionX: z.number(),
    emptyLoadKg: z.number(),
    maxLoadKg: z.number(),
    coupling: z.boolean().optional(),
  }),
);

const tractorSchema = z.object({
  code: z.string(),
  label: z.string(),
  tareKg: z.number(),
  axles: z
    .array(
      z.object({
        code: z.string(),
        label: z.string(),
        positionX: z.number(),
        tareLoadKg: z.number(),
        maxLoadKg: z.number(),
        driven: z.boolean(),
        steering: z.boolean(),
      }),
    )
    .min(2),
});

const regulationSchema = z.object({
  maxCombinationWeightKg: z.number(),
  minDriveAxleShare: z.number().optional(),
  minSteerAxleShare: z.number().optional(),
});

const obstaclesSchema = z.array(
  z.object({
    code: z.string(),
    label: z.string(),
    x: z.number(),
    y: z.number(),
    z: z.number(),
    lengthM: z.number(),
    widthM: z.number(),
    heightM: z.number(),
  }),
);

const weightDistributionSchema = z.object({
  payloadKg: z.number(),
  trailerTareKg: z.number(),
  tractorTareKg: z.number(),
  combinationKg: z.number(),
  maxCombinationKg: z.number().nullable(),
  couplingLoadKg: z.number().nullable(),
  couplingCapacityKg: z.number().nullable(),
  tractorLadenKg: z.number().nullable(),
  driveAxleSharePct: z.number().nullable(),
  minDriveAxleSharePct: z.number().nullable(),
  steerAxleSharePct: z.number().nullable(),
  minSteerAxleSharePct: z.number().nullable(),
});

type VehicleRow = NonNullable<Awaited<ReturnType<typeof prisma.vehicleTemplate.findFirst>>>;

/** Eski kayıtlarda boş `{}` olabilir; o durumda null döner. */
export function parseWeightDistribution(
  value: unknown,
): WeightDistributionReport | null {
  const parsed = weightDistributionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Kalıcı satırı sürümlü alan sözleşmesine çevirir. */
export function toVehicleTemplate(row: VehicleRow): VehicleTemplate {
  const axleGroups = axleGroupsSchema.parse(row.axleGroups) as VehicleAxleGroup[];
  const tractor =
    row.tractor === null || row.tractor === undefined
      ? undefined
      : (tractorSchema.parse(row.tractor) as TractorSpec);
  const regulation =
    row.regulation === null || row.regulation === undefined
      ? undefined
      : (regulationSchema.parse(row.regulation) as VehicleRegulation);

  return {
    code: row.code,
    name: row.name,
    kind: z.enum(["rigid-truck", "semi-trailer", "iso-container"]).parse(row.kind),
    internalLengthM: row.internalLengthM,
    internalWidthM: row.internalWidthM,
    internalHeightM: row.internalHeightM,
    rearDoor: {
      widthM: row.rearDoorWidthM,
      heightM: row.rearDoorHeightM,
      sillHeightM: row.rearDoorSillM,
    },
    maxPayloadKg: row.maxPayloadKg,
    axleGroups,
    ...(tractor ? { tractor } : {}),
    ...(regulation ? { regulation } : {}),
    obstacles: obstaclesSchema.parse(row.obstacles),
    cogEnvelope: {
      minX: row.cogMinX,
      maxX: row.cogMaxX,
      minY: row.cogMinY,
      maxY: row.cogMaxY,
      maxZ: row.cogMaxZ,
    },
    rulesVersion: row.rulesVersion,
    geometrySource: z
      .enum(["measured", "manufacturer", "golden-assumption"])
      .parse(row.geometrySource),
  };
}
