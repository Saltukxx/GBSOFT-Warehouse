import { describe, expect, it } from "vitest";
import { DEFAULT_BLUEPRINT, buildLayoutDraft } from "./layoutBuilder.js";
import {
  buildScene3D,
  defaultLevelGeometry,
  type Scene3DInput,
  type Scene3DLocationInput,
} from "./scene3d.js";

function defaultInput(overrides: Partial<Scene3DInput> = {}): Scene3DInput {
  const draft = buildLayoutDraft(DEFAULT_BLUEPRINT);
  return {
    layout: { ...draft.layout, facilityCode: "MARMARA-DC-01", facilityName: "Marmara DM" },
    locations: draft.locations,
    ...overrides,
  };
}

function defaultScene(overrides: Partial<Scene3DInput> = {}) {
  return buildScene3D(defaultInput(overrides));
}

/** Ölçülmüş kot taşıyan göz — türetme yolundan ayrışsın diye. */
function measured(location: Scene3DLocationInput): Scene3DLocationInput {
  const geometry = defaultLevelGeometry(location.level);
  return {
    ...location,
    levelElevationM: geometry.elevationM,
    levelClearHeightM: geometry.clearHeightM,
  };
}

describe("3B sahne", () => {
  it("96 gözü ve 24 raf modülünü metre biriminde üretir", () => {
    const scene = defaultScene();

    expect(scene.units).toBe("m");
    expect(scene.bays).toHaveLength(96);
    // 12 koridor × 2 yüz.
    expect(scene.racks).toHaveLength(24);
    expect(scene.racks.every((rack) => rack.bayCodes.length === 4)).toBe(true);
  });

  it("ayak izini 2B haritadan birebir taşır", () => {
    const input = defaultInput();
    const scene = buildScene3D(input);
    const source = input.locations.find((loc) => loc.id === "A-03-02")!;
    const bay = scene.bays.find((item) => item.locationCode === "A-03-02")!;
    const toM = (u: number) => u / input.layout.unitsPerMeter;

    // 3B sahne yeni geometri uydurmaz; yalnız düşey ekseni ekler.
    expect(bay.box.center.x).toBeCloseTo(toM(source.x + source.width / 2), 3);
    expect(bay.box.center.z).toBeCloseTo(toM(source.y + source.height / 2), 3);
    expect(bay.box.size.x).toBeCloseTo(toM(source.width), 3);
    expect(bay.box.size.z).toBeCloseTo(toM(source.height), 3);
  });

  it("ölçülmemiş tesiste kotu türetir ve bunu açıkça söyler", () => {
    const scene = defaultScene();

    expect(scene.geometrySource).toBe("derived");
    expect(scene.levelProfile.every((entry) => entry.source === "derived")).toBe(true);

    // Kademe 2 bel hizasıdır; altın bölge tanımı buradan gelir.
    const golden = scene.levelProfile.find((entry) => entry.level === 2)!;
    expect(golden.elevationM).toBe(0.85);
    expect(scene.bays.filter((bay) => bay.goldenZone).every((bay) => bay.level === 2)).toBe(
      true,
    );
  });

  it("bütün kademeler ölçülmüşse sahneyi ölçülmüş sayar", () => {
    const input = defaultInput();
    const scene = buildScene3D({
      ...input,
      locations: input.locations.map(measured),
    });

    expect(scene.geometrySource).toBe("measured");
    expect(scene.levelProfile.every((entry) => entry.source === "measured")).toBe(true);
  });

  it("kısmen ölçülmüş sahneyi ölçülmüş göstermez", () => {
    const input = defaultInput();
    const scene = buildScene3D({
      ...input,
      locations: input.locations.map((loc) => (loc.level === 2 ? measured(loc) : loc)),
    });

    expect(scene.geometrySource).toBe("derived");
    expect(scene.levelProfile.find((entry) => entry.level === 2)!.source).toBe("measured");
    expect(scene.levelProfile.find((entry) => entry.level === 1)!.source).toBe("derived");
  });

  it("gözü doğru raf yüzüne bağlar", () => {
    const scene = defaultScene();
    // Varsayılan zonlamada 3. koridorun solu A, sağı B.
    expect(scene.bays.find((bay) => bay.locationCode === "A-03-02")!.side).toBe("left");
    expect(scene.bays.find((bay) => bay.locationCode === "B-03-02")!.side).toBe("right");
  });

  it("aynı zon iki yüze atandığında da yüzleri ayırır", () => {
    // Zon üzerinden eşleştirme burada çöker; ayak izi aralığı çökmez.
    const draft = buildLayoutDraft({
      ...DEFAULT_BLUEPRINT,
      aisleCount: 1,
      zoning: [{ aisle: 1, left: "A", right: "A" }],
    });
    const scene = buildScene3D({
      layout: { ...draft.layout, facilityCode: "T", facilityName: "T" },
      locations: draft.locations,
    });

    expect(new Set(scene.bays.map((bay) => bay.side))).toEqual(new Set(["left", "right"]));
  });

  it("koridor, cross-aisle ve dock yaklaşımı yollarını üretir", () => {
    const scene = defaultScene();
    const kinds = scene.paths.map((path) => path.kind);

    expect(kinds.filter((kind) => kind === "aisle")).toHaveLength(12);
    expect(kinds.filter((kind) => kind === "cross-aisle")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "dock-approach")).toHaveLength(1);

    // Koridor ekseni iki raf yüzünün tam ortasından geçer.
    const aisle3 = scene.paths.find((path) => path.code === "P:A3")!;
    const left = scene.racks.find((rack) => rack.code === "R:A3:left")!;
    const right = scene.racks.find((rack) => rack.code === "R:A3:right")!;
    const gapCenter =
      (left.box.center.x + left.box.size.x / 2 + (right.box.center.x - right.box.size.x / 2)) / 2;
    // Yol ekseni milimetreye yuvarlanır; karşılaştırma o hassasiyettedir.
    expect(aisle3.from.x).toBeCloseTo(gapCenter, 2);
  });

  it("bina net yüksekliğini raf tepesinden türetir, ölçülmüşse ona uyar", () => {
    const derived = defaultScene();
    const rackTop = Math.max(...derived.racks.map((rack) => rack.box.size.y));
    expect(derived.bounds.clearHeightM).toBeCloseTo(rackTop + 2.5, 3);

    const measuredScene = defaultScene({ clearHeightM: 9.4 });
    expect(measuredScene.bounds.clearHeightM).toBe(9.4);
  });

  it("bloklu gözün nedenini sahneye taşır", () => {
    const draft = buildLayoutDraft({
      ...DEFAULT_BLUEPRINT,
      blocked: { "A-01-01": "Bakım" },
    });
    const scene = buildScene3D({
      layout: { ...draft.layout, facilityCode: "T", facilityName: "T" },
      locations: draft.locations,
    });

    const blocked = scene.bays.find((bay) => bay.locationCode === "A-01-01")!;
    expect(blocked.blocked).toBe(true);
    expect(blocked.blockedReason).toBe("Bakım");
  });

  it("ölçülmüş derinliği ayak izi genişliğinin yerine kullanır", () => {
    const input = defaultInput();
    const scene = buildScene3D({
      ...input,
      locations: input.locations.map((loc) => ({ ...loc, depthM: 1.2 })),
    });

    expect(scene.bays.every((bay) => bay.box.size.x === 1.2)).toBe(true);
  });

  it("cross-aisle'ı geçilebilir, paketleme alanını değil sayar", () => {
    const input = defaultInput();
    const scene = buildScene3D({
      ...input,
      floorAreas: [
        ...input.layout.floorAreas,
        { id: "PACK-1", label: "Paketleme", kind: "packing", x: 40, y: 40, width: 40, height: 40 },
      ],
    });

    expect(scene.floors.find((floor) => floor.kind === "cross-aisle")!.traversable).toBe(true);
    expect(scene.floors.find((floor) => floor.code === "PACK-1")!.traversable).toBe(false);
  });

  it("rafı kademe 1'den tepeye kadar eksiksiz kurar", () => {
    const scene = defaultScene();

    // 24 raf yüzü × 4 göz × 3 kademe = 288 hücre; 96'sı pick, 192'si reserve.
    expect(scene.storage).toHaveLength(288);
    expect(scene.storage.filter((cell) => cell.kind === "pick")).toHaveLength(96);
    expect(scene.storage.filter((cell) => cell.kind === "reserve")).toHaveLength(192);

    // Pick hücre mevcut gözle eşleşir, reserve hücrenin göz kodu yoktur.
    const pick = scene.storage.find((cell) => cell.code === "A-03-02-L2")!;
    expect(pick.kind).toBe("pick");
    expect(pick.locationCode).toBe("A-03-02");
    expect(scene.storage.find((cell) => cell.code === "A-03-02-L3")!.locationCode).toBeNull();
  });

  it("pick hücresi ilgili gözle aynı hacmi kaplar", () => {
    const scene = defaultScene();
    const bay = scene.bays.find((item) => item.locationCode === "A-03-02")!;
    const cell = scene.storage.find((item) => item.code === "A-03-02-L2")!;

    // İkisi aynı fiziksel yeri anlatır; ayrışırlarsa sahne kendi kendisiyle
    // çelişir.
    expect(cell.box).toEqual(bay.box);
  });

  it("dikmeleri göz kenarlarına koyar, bitişik olanları tekler", () => {
    const scene = defaultScene();
    const structure = scene.structures.find((item) => item.rackCode === "R:A1:left")!;

    // Varsayılan geometride gözler arasında boşluk var (bayGap + cross-aisle),
    // bu yüzden dikmeler paylaşılmaz: 4 göz × 2 kenar.
    expect(structure.uprights).toHaveLength(8);
    expect(structure.levelCount).toBe(3);
    expect(structure.topM).toBeCloseTo(2.75, 3);

    // Dikmeler rafın tepesine kadar çıkar.
    expect(structure.uprights.every((upright) => upright.box.size.y === 2.75)).toBe(true);
  });

  it("her kademede ön ve arka olmak üzere iki traverse koyar", () => {
    const scene = defaultScene();
    const structure = scene.structures.find((item) => item.rackCode === "R:A1:left")!;

    // Kademe 1 zemindedir, traversi yoktur: göz başına kademe 2, kademe 3 ve
    // tepe bağlantısı = 3 kot × 2 ray.
    expect(structure.beams).toHaveLength(4 * 3 * 2);
    const elevations = [...new Set(structure.beams.map((beam) => beam.box.center.y))].sort(
      (a, b) => a - b,
    );
    expect(elevations).toEqual([0.85, 1.7, 2.75]);

    // Traverse bir ray'dır, kapak değil: gözün ayak izini kaplamaz.
    const bay = scene.bays.find((item) => item.locationCode === "A-01-01")!;
    expect(structure.beams.every((beam) => beam.box.size.x < bay.box.size.x / 4)).toBe(true);
    expect(structure.beams.every((beam) => beam.box.size.z === bay.box.size.z)).toBe(true);
  });

  it("raf zarfı reserve kademeleri de kapsar", () => {
    const scene = defaultScene();
    // Pick yüzleri en fazla 2.75'e çıkıyor; zarf da oraya kadar.
    expect(scene.racks.every((rack) => rack.box.size.y === 2.75)).toBe(true);
    expect(scene.racks.every((rack) => rack.levels.length === 3)).toBe(true);
  });

  it("taşıyıcı elemanlar koridor eksenine taşmaz", () => {
    const scene = defaultScene();
    const structure = scene.structures.find((item) => item.rackCode === "R:A1:left")!;
    const rack = scene.racks.find((item) => item.code === "R:A1:left")!;
    const minX = rack.box.center.x - rack.box.size.x / 2;
    const maxX = rack.box.center.x + rack.box.size.x / 2;

    for (const element of [...structure.uprights, ...structure.beams]) {
      expect(element.box.center.x - element.box.size.x / 2).toBeGreaterThanOrEqual(minX - 1e-6);
      expect(element.box.center.x + element.box.size.x / 2).toBeLessThanOrEqual(maxX + 1e-6);
    }
  });

  it("aynı girdi için deterministiktir", () => {
    expect(JSON.stringify(defaultScene())).toBe(JSON.stringify(defaultScene()));
  });

  it("unitsPerMeter sıfırsa sessizce bozuk sahne üretmez", () => {
    const input = defaultInput();
    expect(() =>
      buildScene3D({ ...input, layout: { ...input.layout, unitsPerMeter: 0 } }),
    ).toThrow(/unitsPerMeter/);
  });
});
