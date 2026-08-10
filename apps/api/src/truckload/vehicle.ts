import type { VehicleTemplate } from "@gbsoft/domain";
import { z } from "zod";
import { prisma } from "../db.js";

const axleGroupsSchema = z.array(
  z.object({
    code: z.string(),
    label: z.string(),
    positionX: z.number(),
    emptyLoadKg: z.number(),
    maxLoadKg: z.number(),
  }),
);

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

type VehicleRow = NonNullable<Awaited<ReturnType<typeof prisma.vehicleTemplate.findFirst>>>;

/** Kalıcı satırı sürümlü alan sözleşmesine çevirir. */
export function toVehicleTemplate(row: VehicleRow): VehicleTemplate {
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
    axleGroups: axleGroupsSchema.parse(row.axleGroups),
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
