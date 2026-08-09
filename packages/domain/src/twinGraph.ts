/**
 * Dijital ikiz yürüyüş grafı ve mesafe matrisi.
 *
 * Saf fonksiyonlardır: API kalıcı GraphNode/GraphEdge kayıtlarını bu çıktıdan
 * üretir; testler ve ilerideki solver aynı mesafe anlamını paylaşır.
 */

import type { AisleGeometry, FloorArea, Location } from "./warehouse.js";

export type GraphNodeKind = "dock" | "junction" | "location";

export type TwinGraphNode = {
  code: string;
  kind: GraphNodeKind;
  x: number;
  y: number;
  locationCode?: string;
};

export type TwinGraphEdge = {
  code: string;
  fromCode: string;
  toCode: string;
  distanceM: number;
  traversable: boolean;
};

export type TwinGraph = {
  nodes: TwinGraphNode[];
  edges: TwinGraphEdge[];
  dockNodeCode: string;
};

export type TwinGraphInput = {
  unitsPerMeter: number;
  dockAnchor: { x: number; y: number };
  aisles: AisleGeometry[];
  floorAreas?: FloorArea[];
  locations: Array<
    Pick<
      Location,
      "id" | "aisle" | "x" | "y" | "width" | "height" | "blocked"
    >
  >;
};

export type GraphCoverage = {
  locationCount: number;
  mappedLocationCount: number;
  reachableLocationCount: number;
  intentionallyBlockedCount: number;
  coveragePct: number;
};

export type DistanceMatrix = {
  locationCodes: string[];
  distancesM: Array<Array<number | null>>;
};

const DOCK_CODE = "DOCK";
const ROUNDING = 1_000;

function rounded(value: number): number {
  return Math.round(value * ROUNDING) / ROUNDING;
}

function coordinateCode(value: number): string {
  return String(Math.round(value * 10)).replace("-", "m");
}

function edgeCode(a: string, b: string): string {
  return `E:${[a, b].sort().join("|")}`;
}

function distanceM(
  a: Pick<TwinGraphNode, "x" | "y">,
  b: Pick<TwinGraphNode, "x" | "y">,
  unitsPerMeter: number,
): number {
  return rounded(Math.hypot(a.x - b.x, a.y - b.y) / unitsPerMeter);
}

/** Raf yüzleri arasındaki yürüyüş koridorunun orta ekseni. */
function aisleWalkX(aisle: AisleGeometry): number {
  const faces = [...aisle.faces].sort((a, b) => a.x - b.x);
  if (faces.length >= 2) {
    const leftEnd = faces[0].x + faces[0].width;
    return (leftEnd + faces[1].x) / 2;
  }
  const faceWidth = faces[0]?.width ?? 0;
  return aisle.x + faceWidth + aisle.walkwayWidth / 2;
}

/**
 * Layout geometrisinden bağlantılı bir yürüyüş grafı üretir.
 *
 * Her göz bir erişim düğümüne, her koridor servis ve cross-aisle
 * seviyelerinde junction düğümlerine dönüşür. Üst/alt omurga tüm koridorları
 * bağlar; tanımlı cross-aisle şeritleri ek yatay omurga açar. Bloklu gözün
 * erişim kenarı kayıtlıdır ama traversable değildir.
 */
export function buildTwinGraph(input: TwinGraphInput): TwinGraph {
  if (!(input.unitsPerMeter > 0)) {
    throw new Error("unitsPerMeter sıfırdan büyük olmalı.");
  }

  const nodes: TwinGraphNode[] = [
    {
      code: DOCK_CODE,
      kind: "dock",
      x: input.dockAnchor.x,
      y: input.dockAnchor.y,
    },
  ];
  const edges: TwinGraphEdge[] = [];
  const nodeByCode = new Map(nodes.map((node) => [node.code, node]));
  const edgeCodes = new Set<string>();

  const addNode = (node: TwinGraphNode) => {
    if (!nodeByCode.has(node.code)) {
      nodes.push(node);
      nodeByCode.set(node.code, node);
    }
  };
  const addEdge = (fromCode: string, toCode: string, traversable = true) => {
    if (fromCode === toCode) return;
    const code = edgeCode(fromCode, toCode);
    if (edgeCodes.has(code)) return;
    const from = nodeByCode.get(fromCode);
    const to = nodeByCode.get(toCode);
    if (!from || !to) throw new Error(`Graf düğümü bulunamadı: ${fromCode}/${toCode}`);
    edgeCodes.add(code);
    edges.push({
      code,
      fromCode,
      toCode,
      // Sıfır uzunluklu erişim kenarı algoritmaları bozmasın.
      distanceM: Math.max(0.001, distanceM(from, to, input.unitsPerMeter)),
      traversable,
    });
  };

  const aisles = [...input.aisles].sort((a, b) => a.number - b.number);
  const locationsByAisle = new Map<number, TwinGraphInput["locations"]>();
  for (const location of input.locations) {
    const list = locationsByAisle.get(location.aisle) ?? [];
    list.push(location);
    locationsByAisle.set(location.aisle, list);
  }

  const allLocations = input.locations;
  const minRackY = Math.min(...allLocations.map((l) => l.y));
  const maxRackY = Math.max(...allLocations.map((l) => l.y + l.height));
  const averageWalkway =
    aisles.reduce((sum, aisle) => sum + aisle.walkwayWidth, 0) /
    Math.max(1, aisles.length);
  const connectorYs = new Set<number>([
    rounded(minRackY - averageWalkway / 2),
    rounded(maxRackY + averageWalkway / 2),
  ]);
  for (const area of input.floorAreas ?? []) {
    if (area.kind === "cross-aisle") connectorYs.add(rounded(area.y + area.height / 2));
  }

  const junctionByAisleAndY = new Map<string, string>();
  const junctionKey = (aisle: number, y: number) => `${aisle}:${rounded(y)}`;

  for (const aisle of aisles) {
    const walkX = aisleWalkX(aisle);
    const aisleLocations = locationsByAisle.get(aisle.number) ?? [];
    const serviceYs = new Set<number>(connectorYs);
    for (const location of aisleLocations) {
      serviceYs.add(rounded(location.y + location.height / 2));
    }
    const sortedYs = [...serviceYs].sort((a, b) => a - b);

    for (const y of sortedYs) {
      const code = `J:A${aisle.number}:Y${coordinateCode(y)}`;
      addNode({ code, kind: "junction", x: walkX, y });
      junctionByAisleAndY.set(junctionKey(aisle.number, y), code);
    }
    for (let index = 1; index < sortedYs.length; index += 1) {
      addEdge(
        junctionByAisleAndY.get(junctionKey(aisle.number, sortedYs[index - 1]))!,
        junctionByAisleAndY.get(junctionKey(aisle.number, sortedYs[index]))!,
      );
    }

    for (const location of aisleLocations) {
      const y = rounded(location.y + location.height / 2);
      const locationCode = `L:${location.id}`;
      addNode({
        code: locationCode,
        kind: "location",
        x: location.x + location.width / 2,
        y,
        locationCode: location.id,
      });
      addEdge(
        locationCode,
        junctionByAisleAndY.get(junctionKey(aisle.number, y))!,
        !location.blocked,
      );
    }
  }

  // Yatay omurgalar: üst, alt ve tanımlı cross-aisle şeritleri.
  for (const y of connectorYs) {
    for (let index = 1; index < aisles.length; index += 1) {
      const previous = junctionByAisleAndY.get(junctionKey(aisles[index - 1].number, y));
      const current = junctionByAisleAndY.get(junctionKey(aisles[index].number, y));
      if (previous && current) addEdge(previous, current);
    }
  }

  // Dock en yakın omurga düğümüne bağlanır; keyfi biçimde raf içinden
  // birden çok kısayol açılmaz.
  const connectorNodes = [...connectorYs].flatMap((y) =>
    aisles
      .map((aisle) => junctionByAisleAndY.get(junctionKey(aisle.number, y)))
      .filter((code): code is string => Boolean(code)),
  );
  const dock = nodeByCode.get(DOCK_CODE)!;
  const nearest = connectorNodes
    .map((code) => ({ code, distance: distanceM(dock, nodeByCode.get(code)!, input.unitsPerMeter) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearest) addEdge(DOCK_CODE, nearest.code);

  return { nodes, edges, dockNodeCode: DOCK_CODE };
}

type Adjacency = Map<string, Array<{ code: string; distanceM: number }>>;

function adjacency(graph: TwinGraph): Adjacency {
  const result: Adjacency = new Map(graph.nodes.map((node) => [node.code, []]));
  for (const edge of graph.edges) {
    if (!edge.traversable) continue;
    result.get(edge.fromCode)?.push({ code: edge.toCode, distanceM: edge.distanceM });
    result.get(edge.toCode)?.push({ code: edge.fromCode, distanceM: edge.distanceM });
  }
  return result;
}

/** Küçük depo grafları için deterministik Dijkstra. */
export function shortestPathDistances(
  graph: TwinGraph,
  sourceCode: string,
): Map<string, number> {
  const links = adjacency(graph);
  if (!links.has(sourceCode)) throw new Error(`Başlangıç düğümü yok: ${sourceCode}`);

  const distances = new Map<string, number>([[sourceCode, 0]]);
  const visited = new Set<string>();

  while (visited.size < graph.nodes.length) {
    let current: string | undefined;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const [code, value] of distances) {
      if (!visited.has(code) && value < currentDistance) {
        current = code;
        currentDistance = value;
      }
    }
    if (!current) break;
    visited.add(current);

    for (const link of links.get(current) ?? []) {
      const candidate = currentDistance + link.distanceM;
      if (candidate < (distances.get(link.code) ?? Number.POSITIVE_INFINITY)) {
        distances.set(link.code, candidate);
      }
    }
  }

  return distances;
}

export function graphCoverage(graph: TwinGraph): GraphCoverage {
  const locationNodes = graph.nodes.filter((node) => node.kind === "location");
  const reachable = shortestPathDistances(graph, graph.dockNodeCode);
  const blockedLocationCodes = new Set(
    graph.edges
      .filter((edge) => !edge.traversable)
      .flatMap((edge) => [edge.fromCode, edge.toCode])
      .filter((code) => code.startsWith("L:")),
  );
  const reachableLocations = locationNodes.filter((node) => reachable.has(node.code));
  const expectedReachable = locationNodes.length - blockedLocationCodes.size;
  const mappedPct = locationNodes.length === 0 ? 0 : 100;
  const reachablePct = expectedReachable === 0
    ? 100
    : (reachableLocations.length / expectedReachable) * 100;

  return {
    locationCount: locationNodes.length,
    mappedLocationCount: locationNodes.length,
    reachableLocationCount: reachableLocations.length,
    intentionallyBlockedCount: blockedLocationCodes.size,
    coveragePct: rounded(Math.min(mappedPct, reachablePct)),
  };
}

export function distanceMatrix(graph: TwinGraph): DistanceMatrix {
  const locationNodes = graph.nodes
    .filter((node) => node.kind === "location" && node.locationCode)
    .sort((a, b) => a.locationCode!.localeCompare(b.locationCode!, "tr"));

  return {
    locationCodes: locationNodes.map((node) => node.locationCode!),
    distancesM: locationNodes.map((source) => {
      const distances = shortestPathDistances(graph, source.code);
      return locationNodes.map((target) => {
        const value = distances.get(target.code);
        return value === undefined ? null : rounded(value);
      });
    }),
  };
}

export function dockDistances(graph: TwinGraph): Map<string, number> {
  const distances = shortestPathDistances(graph, graph.dockNodeCode);
  return new Map(
    graph.nodes
      .filter((node) => node.kind === "location" && node.locationCode)
      .flatMap((node) => {
        const value = distances.get(node.code);
        return value === undefined ? [] : [[node.locationCode!, rounded(value)] as const];
      }),
  );
}
