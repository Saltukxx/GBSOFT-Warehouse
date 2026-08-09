import { describe, expect, it } from "vitest";
import { DEFAULT_BLUEPRINT, buildLayoutDraft } from "./layoutBuilder.js";
import {
  buildTwinGraph,
  distanceMatrix,
  dockDistances,
  graphCoverage,
  shortestPathDistances,
  shortestPathNodes,
} from "./twinGraph.js";

function defaultGraph() {
  const draft = buildLayoutDraft(DEFAULT_BLUEPRINT);
  return buildTwinGraph({
    unitsPerMeter: draft.layout.unitsPerMeter,
    dockAnchor: draft.layout.dockAnchor,
    aisles: draft.layout.aisles,
    floorAreas: draft.layout.floorAreas,
    locations: draft.locations,
  });
}

describe("dijital ikiz grafı", () => {
  it("96 lokasyonun tamamını dock'a bağlar", () => {
    const graph = defaultGraph();
    const coverage = graphCoverage(graph);

    expect(graph.nodes.filter((node) => node.kind === "location")).toHaveLength(96);
    expect(coverage).toMatchObject({
      locationCount: 96,
      mappedLocationCount: 96,
      reachableLocationCount: 96,
      coveragePct: 100,
    });
  });

  it("bloklu gözü kaydeder ama yürünebilir saymaz", () => {
    const draft = buildLayoutDraft({
      ...DEFAULT_BLUEPRINT,
      blocked: { "A-01-01": "Bakım" },
    });
    const graph = buildTwinGraph({
      unitsPerMeter: draft.layout.unitsPerMeter,
      dockAnchor: draft.layout.dockAnchor,
      aisles: draft.layout.aisles,
      floorAreas: draft.layout.floorAreas,
      locations: draft.locations,
    });

    const coverage = graphCoverage(graph);
    expect(coverage.intentionallyBlockedCount).toBe(1);
    expect(coverage.reachableLocationCount).toBe(95);
    expect(coverage.coveragePct).toBe(100);
    expect(dockDistances(graph).has("A-01-01")).toBe(false);
  });

  it("mesafe matrisi simetrik ve 96x96'dır", () => {
    const matrix = distanceMatrix(defaultGraph());
    expect(matrix.locationCodes).toHaveLength(96);
    expect(matrix.distancesM).toHaveLength(96);
    expect(matrix.distancesM.every((row) => row.length === 96)).toBe(true);
    expect(matrix.distancesM[0][0]).toBe(0);
    expect(matrix.distancesM[0][25]).toBe(matrix.distancesM[25][0]);
  });

  it("rota düğüm dizisi mesafe hesabıyla aynı sayıyı verir", () => {
    const graph = defaultGraph();
    const path = shortestPathNodes(graph, graph.dockNodeCode, "L:A-03-02");

    expect(path).not.toBeNull();
    expect(path![0].code).toBe(graph.dockNodeCode);
    expect(path![path!.length - 1].code).toBe("L:A-03-02");

    // Rota ile mesafe iki ayrı hesap olsaydı zamanla ayrışırlardı: çizilen
    // yolun uzunluğu mesafe matrisindeki sayıyı vermek zorunda.
    const edgeByPair = new Map(
      graph.edges.map((edge) => [[edge.fromCode, edge.toCode].sort().join("|"), edge]),
    );
    let walked = 0;
    for (let index = 1; index < path!.length; index += 1) {
      const key = [path![index - 1].code, path![index].code].sort().join("|");
      walked += edgeByPair.get(key)!.distanceM;
    }
    const expected = shortestPathDistances(graph, graph.dockNodeCode).get("L:A-03-02")!;
    expect(walked).toBeCloseTo(expected, 6);
  });

  it("bloklu göze yürünebilir rota bulmaz", () => {
    const draft = buildLayoutDraft({
      ...DEFAULT_BLUEPRINT,
      blocked: { "A-01-01": "Bakım" },
    });
    const graph = buildTwinGraph({
      unitsPerMeter: draft.layout.unitsPerMeter,
      dockAnchor: draft.layout.dockAnchor,
      aisles: draft.layout.aisles,
      floorAreas: draft.layout.floorAreas,
      locations: draft.locations,
    });

    // Erişim kenarı grafta durur ama yürünebilir değildir; uydurma bir
    // doğru parçası çizmek yerine null dönmeli.
    expect(shortestPathNodes(graph, graph.dockNodeCode, "L:A-01-01")).toBeNull();
    expect(shortestPathNodes(graph, graph.dockNodeCode, "L:A-01-02")).not.toBeNull();
  });

  it("bilinmeyen düğüm ve aynı düğüm isteğini sessizce geçmez", () => {
    const graph = defaultGraph();
    expect(shortestPathNodes(graph, graph.dockNodeCode, "L:YOK")).toBeNull();
    expect(shortestPathNodes(graph, "L:YOK", graph.dockNodeCode)).toBeNull();
    expect(shortestPathNodes(graph, "L:A-03-02", "L:A-03-02")).toHaveLength(1);
  });

  it("96 lokasyonlu matrisi 200 ms altında hesaplar", () => {
    const graph = defaultGraph();
    const started = performance.now();
    distanceMatrix(graph);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
