import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, invalidate, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Box3D, BayVolume, Scene3D, Vec3 } from "@gbsoft/domain";
import type { LayerDef } from "../warehouse-map/layers";
import { StudioCameraRig } from "../three/StudioCameraRig";
import {
  FLOOR_COLORS,
  SCENE_PALETTE,
  bayColor,
  type ColorMode,
  type PlanRole,
} from "./sceneColors";

/**
 * 3B dijital ikiz sahnesi.
 *
 * Sahne verinin görüntüsüdür, kendisi veri üretmez: bütün geometri
 * `GET /facilities/:code/scene-3d` yanıtından gelir ve metre birimindedir.
 * Kamera hedefi sahnenin ortasıdır; bu yüzden içerik grubu zemin merkezine
 * kaydırılır — dünya koordinatı ile sahne koordinatı arasındaki tek fark budur.
 *
 * 96 gözü tek tek mesh olarak çizmek her karede 96 draw call demektir. Gözler
 * ve raf iskeleti instanced çizilir; sahne büyüdükçe (Faz 7-8'de palet ve HU
 * hacimleri eklenince) bu fark belirleyici olur.
 */

export type SectionCut = {
  axis: "x" | "z" | null;
  /** Sahne koordinatında kesit konumu (m). */
  positionM: number;
};

export type ScenePolyline = {
  code: string;
  points: Vec3[];
};

/** Hazır kamera açıları. */
export type CameraPreset = "iso" | "top" | "aisle";

/**
 * Hazır açıların bakış yönleri.
 *
 * `top` tam tepeden değil, birkaç derece eğiktir: tam dik bakışta düşey eksen
 * kaybolur ve sahne 2B haritadan farksız hale gelir.
 */
const PRESET_DIRECTIONS: Record<CameraPreset, [number, number, number]> = {
  iso: [0.34, 0.62, 0.71],
  top: [0.02, 0.99, 0.14],
  aisle: [0.1, 0.2, 0.97],
};

export type Scene3DViewProps = {
  scene: Scene3D;
  bays: BayVolume[];
  layer: LayerDef;
  colorMode: ColorMode;
  /** `plan` modunda gözün aktif plandaki rolü. */
  planRoles?: Map<string, PlanRole>;
  selectedCode: string | null;
  /** Sahne içi ipucu için; `onHover` ile senkron tutulur. */
  hoveredCode?: string | null;
  onSelect: (code: string | null) => void;
  onHover: (code: string | null) => void;
  sectionCut: SectionCut;
  showPaths: boolean;
  /** Reserve hücreler çizilsin mi? */
  showReserve?: boolean;
  /** Rota replay'i — boşsa çizilmez. */
  route?: ScenePolyline | null;
  /** 0-1 arası ilerleme; rota üzerindeki taşıyıcı bu oranda konumlanır. */
  routeProgress?: number;
  /** Hazır kamera açısı. Değiştikçe kamera yeniden konumlanır. */
  cameraPreset?: CameraPreset;
};

const UP_TILT = Math.PI / 2 - 0.05;

/** Rota zeminin biraz üstünde durur; z-fighting olmasın. */
const ROUTE_Y = 0.2;
/**
 * Rota kalınlığı (m).
 *
 * Fiziksel bir yürüyüş izi ~0.5 m'dir, ama 143 metrelik sahnede bu iki piksele
 * düşer ve rota kaybolur. Okunurluk için biraz kalın tutuluyor: rota bir ölçü
 * değil, bir göstergedir — mesafeyi panel söyler.
 */
const ROUTE_RADIUS_M = 0.6;

/* ------------------------------------------------------------------ */
/* Gözler                                                              */
/* ------------------------------------------------------------------ */

function Bays({
  bays,
  layer,
  colorMode,
  planRoles,
  selectedCode,
  onSelect,
  onHover,
  clippingPlanes,
}: {
  bays: BayVolume[];
  layer: LayerDef;
  colorMode: ColorMode;
  planRoles?: Map<string, PlanRole>;
  selectedCode: string | null;
  onSelect: (code: string | null) => void;
  onHover: (code: string | null) => void;
  clippingPlanes: THREE.Plane[];
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    bays.forEach((bay, index) => {
      // `center.y` taban kotudur; mesh merkezi yarım yükseklik yukarıdadır.
      dummy.position.set(
        bay.box.center.x,
        bay.box.center.y + bay.box.size.y / 2,
        bay.box.center.z,
      );
      dummy.scale.set(bay.box.size.x, bay.box.size.y, bay.box.size.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      color.set(bayColor(bay, colorMode, layer, planRoles?.get(bay.locationCode)));
      mesh.setColorAt(index, color);
    });

    mesh.count = bays.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [bays, layer, colorMode, planRoles]);

  const selected = useMemo(
    () => bays.find((bay) => bay.locationCode === selectedCode) ?? null,
    [bays, selectedCode],
  );

  // Sahne kapanırken imleç işaretçide kalmasın.
  useEffect(() => () => {
    document.body.style.cursor = "";
  }, []);

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        // Sayı sabittir; `count` ile görünen kısım kısılır. Filtre her
        // değiştiğinde tampon yeniden ayrılmaz.
        args={[undefined, undefined, Math.max(1, bays.length)]}
        castShadow={false}
        onPointerMove={(event) => {
          event.stopPropagation();
          const index = event.instanceId;
          // Gözün tıklanabilir olduğunu söyleyen tek işaret imleç: instanced
          // mesh'te hover için ayrı bir vurgu çizmek 96 gözü tek tek çizmek
          // demek olurdu.
          document.body.style.cursor = "pointer";
          onHover(index === undefined ? null : (bays[index]?.locationCode ?? null));
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
          onHover(null);
        }}
        onClick={(event) => {
          event.stopPropagation();
          const index = event.instanceId;
          if (index === undefined) return;
          const code = bays[index]?.locationCode ?? null;
          onSelect(code === selectedCode ? null : code);
        }}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial clippingPlanes={clippingPlanes} />
      </instancedMesh>

      {selected ? (
        <mesh
          position={[
            selected.box.center.x,
            selected.box.center.y + selected.box.size.y / 2,
            selected.box.center.z,
          ]}
          scale={[
            selected.box.size.x * 1.06,
            selected.box.size.y * 1.06,
            selected.box.size.z * 1.06,
          ]}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color={SCENE_PALETTE.selected}
            wireframe
            transparent
            opacity={0.9}
          />
        </mesh>
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Instanced kutu yardımcısı                                           */
/* ------------------------------------------------------------------ */

/**
 * Aynı malzemeyi paylaşan kutuları tek çizim çağrısında çizer.
 *
 * Raf taşıyıcıları kalabalıktır: 24 raf yüzü 192 dikme ve 288 traverse eder.
 * Tek tek mesh olarak çizmek her karede 480 draw call demektir; instancing
 * bunu ikiye indirir.
 */
function InstancedBoxes({
  boxes,
  color,
  opacity = 1,
  clippingPlanes,
}: {
  boxes: Box3D[];
  color: string;
  opacity?: number;
  clippingPlanes: THREE.Plane[];
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();

    boxes.forEach((box, index) => {
      // `center.y` taban kotudur; mesh merkezi yarım yükseklik yukarıdadır.
      dummy.position.set(box.center.x, box.center.y + box.size.y / 2, box.center.z);
      dummy.scale.set(
        Math.max(box.size.x, 1e-3),
        Math.max(box.size.y, 1e-3),
        Math.max(box.size.z, 1e-3),
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });

    mesh.count = boxes.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [boxes]);

  if (boxes.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, boxes.length]}
      // Taşıyıcı elemanlar tıklanabilir değil: kullanıcı rafa değil göze tıklar.
      raycast={() => null}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial
        color={color}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity > 0.9}
        clippingPlanes={clippingPlanes}
      />
    </instancedMesh>
  );
}

/* ------------------------------------------------------------------ */
/* Raf taşıyıcıları ve reserve gözler                                  */
/* ------------------------------------------------------------------ */

/**
 * Rafın kendisi: dikmeler, traversler ve reserve hücreler.
 *
 * Pick yüzleri `Bays` tarafından çizilir; burası rafın geri kalanıdır. İkisi
 * birlikte deponun gerçek düşey kapasitesini gösterir — pick yüzü tek başına
 * rafın yalnız bir kademesidir.
 */
function RackSystem({
  scene,
  visibleRacks,
  showReserve,
  clippingPlanes,
}: {
  scene: Scene3D;
  visibleRacks: Set<string>;
  showReserve: boolean;
  clippingPlanes: THREE.Plane[];
}) {
  const uprights = useMemo(
    () =>
      scene.structures
        .filter((structure) => visibleRacks.has(structure.rackCode))
        .flatMap((structure) => structure.uprights.map((element) => element.box)),
    [scene.structures, visibleRacks],
  );

  const beams = useMemo(
    () =>
      scene.structures
        .filter((structure) => visibleRacks.has(structure.rackCode))
        .flatMap((structure) => structure.beams.map((element) => element.box)),
    [scene.structures, visibleRacks],
  );

  const reserve = useMemo(
    () =>
      showReserve
        ? scene.storage
            .filter(
              (cell) => cell.kind === "reserve" && visibleRacks.has(cell.rackCode),
            )
            .map((cell) => cell.box)
        : [],
    [scene.storage, visibleRacks, showReserve],
  );

  return (
    <group>
      <InstancedBoxes
        boxes={uprights}
        color={SCENE_PALETTE.rackSteel}
        clippingPlanes={clippingPlanes}
      />
      <InstancedBoxes
        boxes={beams}
        color={SCENE_PALETTE.rackBeam}
        clippingPlanes={clippingPlanes}
      />
      {/* Reserve hücreler çok saydamdır: doluluk verisi yok, yalnız hacmi
          var. Pick yüzünün ısı rengini bastırmamalı. */}
      <InstancedBoxes
        boxes={reserve}
        color={SCENE_PALETTE.reserve}
        opacity={0.1}
        clippingPlanes={clippingPlanes}
      />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Zemin alanları ve yollar                                            */
/* ------------------------------------------------------------------ */

function FloorAreas({
  scene,
  clippingPlanes,
}: {
  scene: Scene3D;
  clippingPlanes: THREE.Plane[];
}) {
  return (
    <group>
      {scene.floors.map((floor) => {
        // Yüksekliği sıfır olan alan (cross-aisle) zemine yapışık ince bir
        // şerittir; sıfır kalınlıklı kutu z-fighting üretir.
        const height = Math.max(floor.box.size.y, 0.02);
        return (
          <mesh
            key={floor.code}
            position={[floor.box.center.x, height / 2, floor.box.center.z]}
          >
            <boxGeometry args={[floor.box.size.x, height, floor.box.size.z]} />
            <meshLambertMaterial
              color={FLOOR_COLORS[floor.kind]}
              transparent
              opacity={floor.box.size.y > 0.05 ? 0.85 : 0.35}
              clippingPlanes={clippingPlanes}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function Paths({ scene }: { scene: Scene3D }) {
  const geometries = useMemo(
    () =>
      scene.paths.map((path) => ({
        code: path.code,
        geometry: new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(path.from.x, 0.04, path.from.z),
          new THREE.Vector3(path.to.x, 0.04, path.to.z),
        ]),
      })),
    [scene.paths],
  );

  useEffect(
    () => () => geometries.forEach((item) => item.geometry.dispose()),
    [geometries],
  );

  return (
    <group>
      {geometries.map((item) => (
        <line key={item.code}>
          <primitive object={item.geometry} attach="geometry" />
          <lineBasicMaterial
            color={SCENE_PALETTE.path}
            transparent
            opacity={0.5}
          />
        </line>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Ölçek, etiket ve ipucu                                              */
/* ------------------------------------------------------------------ */

/** Izgara aralığı (m). Depo ölçeğinde 10 m okunur bir referans birimi. */
const GRID_STEP_M = 10;

/**
 * Zemin ızgarası.
 *
 * 3B'de mesafe sezgisi kaybolur: iki raf arasının 3 m mi 8 m mi olduğu
 * perspektifte anlaşılmaz. Izgara sahneye ölçek verir.
 */
function MetreGrid({ scene }: { scene: Scene3D }) {
  const grid = useMemo(() => {
    const span = Math.ceil(
      Math.max(scene.bounds.widthM, scene.bounds.depthM) / GRID_STEP_M,
    ) * GRID_STEP_M;
    const helper = new THREE.GridHelper(
      span,
      span / GRID_STEP_M,
      SCENE_PALETTE.gridLine,
      SCENE_PALETTE.gridLine,
    );
    const material = helper.material as THREE.Material;
    material.transparent = true;
    material.opacity = 0.5;
    return helper;
  }, [scene.bounds.widthM, scene.bounds.depthM]);

  useEffect(() => () => grid.dispose(), [grid]);

  return (
    <primitive
      object={grid}
      position={[scene.bounds.widthM / 2, 0.012, scene.bounds.depthM / 2]}
    />
  );
}

/** Metin etiketini sprite dokusuna çizer. */
function labelTexture(text: string): THREE.CanvasTexture {
  const scale = 64;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = scale;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "rgba(255,255,255,0.88)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = SCENE_PALETTE.rackSteel;
  context.lineWidth = 3;
  context.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);
  context.fillStyle = SCENE_PALETTE.selected;
  context.font = "600 34px 'IBM Plex Sans', Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Koridor başlığı etiketleri.
 *
 * drei'nin `Text` bileşeni troika üzerinden font çeker; sıkı CSP altında bu
 * bir dış istek demektir. Canvas dokusu hiçbir şey indirmez ve tasarım
 * sisteminin fontunu kullanır.
 */
function AisleLabels({ scene }: { scene: Scene3D }) {
  const labels = useMemo(() => {
    return scene.paths
      .filter((path) => path.kind === "aisle")
      .map((path) => {
        const number = path.code.replace("P:A", "");
        // Etiket koridorun dock'a yakın ağzında durur.
        const head = path.from.z <= path.to.z ? path.from : path.to;
        return {
          code: path.code,
          texture: labelTexture(`K${number}`),
          position: [head.x, 3.4, head.z - 2] as [number, number, number],
        };
      });
  }, [scene.paths]);

  useEffect(
    () => () => labels.forEach((label) => label.texture.dispose()),
    [labels],
  );

  return (
    <group>
      {labels.map((label) => (
        <sprite key={label.code} position={label.position} scale={[5, 2.5, 1]}>
          <spriteMaterial map={label.texture} depthTest={false} transparent />
        </sprite>
      ))}
    </group>
  );
}

/** Fare altındaki gözün kodunu sahnenin içinde gösterir. */
function HoverTag({ bay }: { bay: BayVolume }) {
  const texture = useMemo(() => labelTexture(bay.locationCode), [bay.locationCode]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite
      position={[
        bay.box.center.x,
        bay.box.center.y + bay.box.size.y + 2.2,
        bay.box.center.z,
      ]}
      scale={[7, 3.5, 1]}
    >
      <spriteMaterial map={texture} depthTest={false} transparent />
    </sprite>
  );
}

/* ------------------------------------------------------------------ */
/* Rota replay                                                         */
/* ------------------------------------------------------------------ */

function RouteReplay({
  route,
  progress,
}: {
  route: ScenePolyline;
  progress: number;
}) {
  const points = useMemo(
    () => route.points.map((point) => new THREE.Vector3(point.x, ROUTE_Y, point.z)),
    [route],
  );

  /**
   * Rota tüp olarak çizilir, çizgi olarak değil.
   *
   * WebGL'de `lineWidth` çoğu sürücüde yok sayılır: rota her zaman 1 piksel
   * kalır ve 143 metrelik bir sahnede görünmez olur. Tüp gerçek kalınlık taşır.
   * Eğri yumuşatma kullanılmıyor — `LineCurve3` parçaları grafın kendi
   * kırıklarını korur, aksi hâlde rota rafın içinden geçiyormuş gibi görünür.
   */
  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let index = 1; index < points.length; index += 1) {
      path.add(new THREE.LineCurve3(points[index - 1], points[index]));
    }
    return new THREE.TubeGeometry(path, points.length * 4, ROUTE_RADIUS_M, 8, false);
  }, [points]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  // Taşıyıcı çizilen çoklu çizginin **üstünde** ilerler. Eğri yumuşatma
  // kullanılsaydı işaretçi rafın içinden geçerdi; rota grafın kendisidir.
  const head = useMemo(() => {
    if (points.length < 2) return null;
    const spans = points.slice(1).map((point, index) => point.distanceTo(points[index]));
    const total = spans.reduce((sum, value) => sum + value, 0);
    if (total === 0) return points[0];

    let remaining = Math.min(1, Math.max(0, progress)) * total;
    for (let index = 0; index < spans.length; index += 1) {
      if (remaining <= spans[index] || index === spans.length - 1) {
        const ratio = spans[index] === 0 ? 0 : remaining / spans[index];
        return points[index].clone().lerp(points[index + 1], Math.min(1, ratio));
      }
      remaining -= spans[index];
    }
    return points[points.length - 1];
  }, [points, progress]);

  return (
    <group>
      {geometry ? (
        <mesh>
          <primitive object={geometry} attach="geometry" />
          <meshLambertMaterial color={SCENE_PALETTE.route} />
        </mesh>
      ) : null}
      {/* Bacağın uçları: nereden çıkıp nereye gidildiği duraksız görünsün. */}
      {points.length >= 2 ? (
        <>
          <mesh position={points[0]}>
            <sphereGeometry args={[ROUTE_RADIUS_M * 1.8, 16, 12]} />
            <meshLambertMaterial color={SCENE_PALETTE.route} />
          </mesh>
          <mesh position={points[points.length - 1]}>
            <sphereGeometry args={[ROUTE_RADIUS_M * 1.8, 16, 12]} />
            <meshLambertMaterial color={SCENE_PALETTE.route} />
          </mesh>
        </>
      ) : null}
      {head ? (
        <mesh position={[head.x, ROUTE_Y + 0.5, head.z]}>
          <sphereGeometry args={[0.85, 20, 14]} />
          <meshLambertMaterial color={SCENE_PALETTE.routeHead} />
        </mesh>
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Sahne                                                               */
/* ------------------------------------------------------------------ */

/** Yerel kırpma bir renderer ayarıdır; sahne kurulunca bir kez açılır. */
function EnableClipping() {
  const { gl } = useThree();
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);
  return null;
}

function SceneContents(props: Scene3DViewProps) {
  const { scene, bays, sectionCut, showPaths, route, routeProgress = 0 } = props;

  const offsetX = scene.bounds.widthM / 2;
  const offsetZ = scene.bounds.depthM / 2;

  // Kırpma düzlemi dünya koordinatındadır; içerik grubu kaydırıldığı için
  // kesit konumu da aynı kadar kaydırılır.
  const clippingPlanes = useMemo(() => {
    if (!sectionCut.axis) return [];
    const normal =
      sectionCut.axis === "x"
        ? new THREE.Vector3(-1, 0, 0)
        : new THREE.Vector3(0, 0, -1);
    const offset = sectionCut.axis === "x" ? offsetX : offsetZ;
    return [new THREE.Plane(normal, sectionCut.positionM - offset)];
  }, [sectionCut.axis, sectionCut.positionM, offsetX, offsetZ]);

  const visibleAisles = useMemo(
    () => new Set(bays.map((bay) => `R:A${bay.aisle}:${bay.side}`)),
    [bays],
  );

  // Filtre dışında kalan gözler — hayalet olarak çizilir.
  const ghostBoxes = useMemo(() => {
    if (bays.length === scene.bays.length) return [];
    const visible = new Set(bays.map((bay) => bay.locationCode));
    return scene.bays
      .filter((bay) => !visible.has(bay.locationCode))
      .map((bay) => bay.box);
  }, [bays, scene.bays]);

  const hoveredBay = useMemo(
    () =>
      props.hoveredCode
        ? (bays.find((bay) => bay.locationCode === props.hoveredCode) ?? null)
        : null,
    [bays, props.hoveredCode],
  );

  return (
    <>
      <EnableClipping />
      {/*
        Kadraj sahnenin kendi sınırlarından hesaplanır: tesis 96 gözlük de
        olabilir, on katı da. Hazır açı değişince kamera ışınlanmıyor, hedefe
        süzülüyor — hangi açıdan hangi açıya geçildiği gözle takip edilebilsin.
      */}
      <StudioCameraRig
        bounds={{
          lengthM: scene.bounds.widthM,
          heightM: scene.bounds.clearHeightM,
          widthM: scene.bounds.depthM,
        }}
        target={[0, 0, 0]}
        direction={PRESET_DIRECTIONS[props.cameraPreset ?? "iso"]}
        resetKey={props.cameraPreset ?? "iso"}
      />
      <ambientLight intensity={1.15} />
      <directionalLight position={[40, 90, 60]} intensity={1.5} />
      <directionalLight position={[-60, 50, -40]} intensity={0.5} />

      {/* Temas gölgesi kutuları zemine oturtur. `frames={1}` ile bir kez
          pişirilir; sahne statik olduğu için her karede yeniden çizmek gereksiz. */}
      <ContactShadows
        position={[0, 0.015, 0]}
        scale={Math.max(scene.bounds.widthM, scene.bounds.depthM) * 1.2}
        resolution={1024}
        far={scene.bounds.clearHeightM}
        blur={2.4}
        opacity={0.32}
        color={SCENE_PALETTE.selected}
        frames={1}
      />

      <group position={[-offsetX, 0, -offsetZ]}>
        {/* Zemin */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[offsetX, 0, offsetZ]}>
          <planeGeometry args={[scene.bounds.widthM, scene.bounds.depthM]} />
          <meshLambertMaterial color={SCENE_PALETTE.ground} />
        </mesh>

        <MetreGrid scene={scene} />
        <FloorAreas scene={scene} clippingPlanes={clippingPlanes} />
        {showPaths ? <Paths scene={scene} /> : null}
        <RackSystem
          scene={scene}
          visibleRacks={visibleAisles}
          showReserve={props.showReserve ?? false}
          clippingPlanes={clippingPlanes}
        />

        {/* Filtrelenmiş gözler silinmez, soluklaşır: kademe süzerken deponun
            geri kalanı bağlam olarak durmalı. */}
        <InstancedBoxes
          boxes={ghostBoxes}
          color={SCENE_PALETTE.reserve}
          opacity={0.12}
          clippingPlanes={clippingPlanes}
        />

        <Bays
          bays={bays}
          layer={props.layer}
          colorMode={props.colorMode}
          planRoles={props.planRoles}
          selectedCode={props.selectedCode}
          onSelect={props.onSelect}
          onHover={props.onHover}
          clippingPlanes={clippingPlanes}
        />

        <AisleLabels scene={scene} />

        {/* Dock referansı */}
        <mesh position={[scene.dockAnchor.x, 0.6, scene.dockAnchor.z]}>
          <cylinderGeometry args={[0.7, 0.7, 1.2, 20]} />
          <meshLambertMaterial color={SCENE_PALETTE.dock} />
        </mesh>

        {hoveredBay ? <HoverTag bay={hoveredBay} /> : null}

        {route && route.points.length >= 2 ? (
          <RouteReplay route={route} progress={routeProgress} />
        ) : null}
      </group>

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        // `frameloop="demand"` ile kare ancak istendiğinde çizilir; sönümlemenin
        // sürmesi için her değişimde yeni kare istenmeli.
        onChange={() => invalidate()}
        // Zeminin altına geçmek dijital ikizde anlamsızdır.
        maxPolarAngle={UP_TILT}
        minDistance={4}
        maxDistance={Math.hypot(scene.bounds.widthM, scene.bounds.depthM) * 2.5}
        target={[0, 0, 0]}
      />
    </>
  );
}

export function Scene3DView(props: Scene3DViewProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      // Sahne statiktir: kullanıcı bir şey değiştirmedikçe kare çizmek
      // düşük donanımda pili ve kare hızını boşa harcar. React her commit'te
      // zaten `invalidate` çağırır, kontroller de kendi değişiminde çağırır.
      frameloop="demand"
      // Gölge yok: veri görselleştirmesinde okunurluğu düşürüyor ve
      // düşük donanımda kare hızını yiyor.
      shadows={false}
      camera={{ fov: 42, near: 0.5, far: 2_000 }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <color attach="background" args={["#f6f8fa"]} />
      <SceneContents {...props} />
    </Canvas>
  );
}
