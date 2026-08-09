import type { Prisma } from "@prisma/client";
import type { RouteLeg, RoutePlan, TwinGraph, Vec3 } from "@gbsoft/domain";
import { shortestPathNodes } from "@gbsoft/domain";
import { loadStoredGraph } from "./graph.js";

/**
 * 3B rota üretimi (Faz 6.3).
 *
 * Rota kalıcı yürüyüş grafından gelir; sahne için ayrı bir yol ağı kurulmaz.
 * Böylece replay'de gördüğünüz güzergâh ile mesafe matrisindeki sayı aynı
 * kaynaktan çıkar ve zamanla ayrışamaz.
 */

type DbClient = Prisma.TransactionClient;

/** Dock'u gösteren özel durak kodu. */
export const DOCK_STOP = "DOCK";

function nodeCodeFor(graph: TwinGraph, stop: string): string | null {
  if (stop === DOCK_STOP) return graph.dockNodeCode;
  const node = graph.nodes.find((item) => item.locationCode === stop);
  return node?.code ?? null;
}

export type BuildRouteInput = {
  graph: TwinGraph;
  unitsPerMeter: number;
  facilityCode: string;
  layoutVersion: number;
  /** Sırayla gezilecek duraklar; `DOCK` veya göz kodu. */
  stops: string[];
};

/**
 * Durak dizisini bacaklara ayırıp her bacağın grafta en kısa yolunu çizer.
 *
 * Ulaşılamayan bacak sessizce atlanmaz: `unreachable` listesine gerekçesiyle
 * yazılır. Bloklu bir göze giden bacak burada görünür — grafta erişim kenarı
 * vardır ama yürünebilir değildir.
 */
export function buildRoutePlan(input: BuildRouteInput): RoutePlan {
  const { graph, unitsPerMeter } = input;
  const toM = (units: number) => Math.round((units / unitsPerMeter) * 1_000) / 1_000;

  const legs: RouteLeg[] = [];
  const unreachable: RoutePlan["unreachable"] = [];

  for (let index = 1; index < input.stops.length; index += 1) {
    const fromCode = input.stops[index - 1];
    const toCode = input.stops[index];
    if (fromCode === toCode) continue;

    const fromNode = nodeCodeFor(graph, fromCode);
    const toNode = nodeCodeFor(graph, toCode);
    if (!fromNode || !toNode) {
      unreachable.push({
        fromCode,
        toCode,
        reason: !fromNode
          ? `${fromCode} grafta yok.`
          : `${toCode} grafta yok.`,
      });
      continue;
    }

    const path = shortestPathNodes(graph, fromNode, toNode);
    if (!path) {
      unreachable.push({
        fromCode,
        toCode,
        reason:
          "Grafta yürünebilir yol yok. Göz bloklu olabilir veya ikiz bağlantısız.",
      });
      continue;
    }

    const points: Vec3[] = path.map((node) => ({
      x: toM(node.x),
      y: 0,
      z: toM(node.y),
    }));

    let distanceM = 0;
    for (let step = 1; step < points.length; step += 1) {
      distanceM += Math.hypot(
        points[step].x - points[step - 1].x,
        points[step].z - points[step - 1].z,
      );
    }

    legs.push({
      fromCode,
      toCode,
      distanceM: Math.round(distanceM * 1_000) / 1_000,
      points,
    });
  }

  return {
    facilityCode: input.facilityCode,
    layoutVersion: input.layoutVersion,
    units: "m",
    unreachable,
    legs,
    totalDistanceM:
      Math.round(legs.reduce((sum, leg) => sum + leg.distanceM, 0) * 1_000) / 1_000,
  };
}

/** Kalıcı grafı yükleyip rota üretir. */
export async function routePlanForLayout(
  db: DbClient,
  tenantId: string,
  layout: { id: string; version: number; unitsPerMeter: number; facilityCode: string },
  stops: string[],
): Promise<RoutePlan> {
  const graph = await loadStoredGraph(db, tenantId, layout.id);
  return buildRoutePlan({
    graph,
    unitsPerMeter: layout.unitsPerMeter,
    facilityCode: layout.facilityCode,
    layoutVersion: layout.version,
    stops,
  });
}
