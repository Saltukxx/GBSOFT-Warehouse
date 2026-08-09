import { describe, expect, it } from "vitest";
import { DEFAULT_BLUEPRINT, buildLayoutDraft } from "./layoutBuilder.js";
import {
  buildTwinGraph,
  distanceMatrix,
  dockDistances,
  graphCoverage,
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

  it("96 lokasyonlu matrisi 200 ms altında hesaplar", () => {
    const graph = defaultGraph();
    const started = performance.now();
    distanceMatrix(graph);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
