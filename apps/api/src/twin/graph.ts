import type { GraphNodeKind, Prisma } from "@prisma/client";
import type { FacilityLayout, Location, TwinGraph } from "@gbsoft/domain";
import {
  buildTwinGraph,
  dockDistances,
  graphCoverage,
  type GraphCoverage,
} from "@gbsoft/domain";

type DbClient = Prisma.TransactionClient;

const NODE_KIND: Record<string, GraphNodeKind> = {
  dock: "DOCK",
  junction: "JUNCTION",
  location: "LOCATION",
};

/**
 * Bir layout sürümünün yürüyüş grafını geometriden yeniden üretir.
 * İşlem çağıranın transaction'ında çalışır; yarım graf kalıcı olamaz.
 */
export async function rebuildLayoutGraph(
  db: DbClient,
  tenantId: string,
  layoutVersionId: string,
): Promise<GraphCoverage & { nodeCount: number; edgeCount: number }> {
  const version = await db.layoutVersion.findFirst({
    where: { id: layoutVersionId, tenantId },
    include: {
      aisles: {
        orderBy: { number: "asc" },
        include: { rackFaces: { include: { zone: true } } },
      },
      floorAreas: { orderBy: { code: "asc" } },
      locations: { orderBy: { code: "asc" }, include: { aisle: true, zone: true } },
    },
  });
  if (!version) throw new Error("Graf üretilecek dijital ikiz sürümü bulunamadı.");

  const layout: FacilityLayout = {
    facilityCode: "",
    facilityName: "",
    layoutVersion: version.version,
    viewBox: { width: version.viewBoxWidth, height: version.viewBoxHeight },
    unitsPerMeter: version.unitsPerMeter,
    dockAnchor: { x: version.dockAnchorX, y: version.dockAnchorY },
    zones: [],
    aisles: version.aisles.map((aisle) => ({
      number: aisle.number,
      x: aisle.x,
      walkwayWidth: aisle.walkwayWidth,
      congestionScore: aisle.congestionScore,
      faces: aisle.rackFaces.map((face) => ({
        side: face.side.toLowerCase() as "left" | "right",
        zone: face.zone.code as Location["zone"],
        x: face.x,
        width: face.width,
      })),
    })),
    floorAreas: version.floorAreas.map((area) => ({
      id: area.code,
      label: area.label,
      kind: area.kind as FacilityLayout["floorAreas"][number]["kind"],
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
    })),
  };

  const graph = buildTwinGraph({
    unitsPerMeter: layout.unitsPerMeter,
    dockAnchor: layout.dockAnchor,
    aisles: layout.aisles,
    floorAreas: layout.floorAreas,
    locations: version.locations.map((location) => ({
      id: location.code,
      aisle: location.aisle.number,
      x: location.x,
      y: location.y,
      width: location.width,
      height: location.height,
      blocked: location.blocked,
    })),
  });

  await db.graphEdge.deleteMany({ where: { tenantId, layoutVersionId } });
  await db.graphNode.deleteMany({ where: { tenantId, layoutVersionId } });

  const locationIdByCode = new Map(version.locations.map((row) => [row.code, row.id]));
  await db.graphNode.createMany({
    data: graph.nodes.map((node) => ({
      tenantId,
      layoutVersionId,
      code: node.code,
      kind: NODE_KIND[node.kind],
      x: node.x,
      y: node.y,
      locationId: node.locationCode ? locationIdByCode.get(node.locationCode) : null,
    })),
  });

  const storedNodes = await db.graphNode.findMany({
    where: { tenantId, layoutVersionId },
    select: { id: true, code: true },
  });
  const nodeIdByCode = new Map(storedNodes.map((node) => [node.code, node.id]));
  await db.graphEdge.createMany({
    data: graph.edges.map((edge) => ({
      tenantId,
      layoutVersionId,
      code: edge.code,
      fromNodeId: nodeIdByCode.get(edge.fromCode)!,
      toNodeId: nodeIdByCode.get(edge.toCode)!,
      distanceM: edge.distanceM,
      traversable: edge.traversable,
    })),
  });

  // Layout CSV'sindeki geçici Manhattan tahmini artık grafın gerçek
  // shortest-path mesafesiyle değiştirilir. Bloklu gözün eski değeri korunur;
  // zaten plan kapsamına alınmaz.
  const dockByLocation = dockDistances(graph);
  for (const [locationCode, distanceToDockM] of dockByLocation) {
    const locationId = locationIdByCode.get(locationCode);
    if (locationId) {
      await db.location.update({ where: { id: locationId }, data: { distanceToDockM } });
    }
  }

  return {
    ...graphCoverage(graph),
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  };
}

/** Kalıcı düğüm/kenarları domain graf sözleşmesine döndürür. */
export async function loadStoredGraph(
  db: DbClient,
  tenantId: string,
  layoutVersionId: string,
): Promise<TwinGraph> {
  const [nodes, edges] = await Promise.all([
    db.graphNode.findMany({
      where: { tenantId, layoutVersionId },
      orderBy: { code: "asc" },
      include: { location: { select: { code: true } } },
    }),
    db.graphEdge.findMany({
      where: { tenantId, layoutVersionId },
      orderBy: { code: "asc" },
      include: {
        fromNode: { select: { code: true } },
        toNode: { select: { code: true } },
      },
    }),
  ]);
  const dock = nodes.find((node) => node.kind === "DOCK");
  if (!dock) throw new Error("Dijital ikiz grafında dock düğümü yok.");

  return {
    dockNodeCode: dock.code,
    nodes: nodes.map((node) => ({
      code: node.code,
      kind: node.kind.toLowerCase() as TwinGraph["nodes"][number]["kind"],
      x: node.x,
      y: node.y,
      locationCode: node.location?.code,
    })),
    edges: edges.map((edge) => ({
      code: edge.code,
      fromCode: edge.fromNode.code,
      toCode: edge.toNode.code,
      distanceM: edge.distanceM,
      traversable: edge.traversable,
    })),
  };
}
