import { useEffect, useMemo } from "react";
import { Canvas, invalidate } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { PalletPlanView, PalletPlacementView } from "@gbsoft/domain";
import { StudioCameraRig } from "../three/StudioCameraRig";
import { StudioLighting } from "../three/StudioLighting";
import { LoadUnitMesh } from "../three/LoadUnitMesh";

const STOP_COLORS = [
  "#1684ad",
  "#159993",
  "#a76500",
  "#66549c",
  "#287b56",
  "#aa3f3a",
];

function colorForStop(stopCode: string | null): string {
  if (!stopCode) return "#708391";
  let hash = 0;
  for (const char of stopCode) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return STOP_COLORS[hash % STOP_COLORS.length];
}

/**
 * EUR palet iskeleti.
 *
 * Tek bir kutu olarak çizmek paleti kalın bir tabla gibi gösteriyordu; yükün
 * nereye oturduğu, tabanın ne kadar yüksek olduğu okunmuyordu. Tahtalar ve
 * takozlar gerçek paletin oranlarını taşıyor, böylece deck yüksekliği gözle
 * ölçülebiliyor.
 */
function PalletBase({
  lengthM,
  widthM,
  deckHeightM,
}: {
  lengthM: number;
  widthM: number;
  deckHeightM: number;
}) {
  const blockHeight = deckHeightM * 0.62;
  const boardHeight = deckHeightM - blockHeight;
  const boardCount = 5;
  const boardWidth = (widthM / boardCount) * 0.74;

  const boards = useMemo(
    () =>
      Array.from({ length: boardCount }, (_, index) => {
        const step = widthM / boardCount;
        return step * (index + 0.5);
      }),
    [widthM],
  );

  const blocks = useMemo(
    () => [lengthM * 0.09, lengthM * 0.5, lengthM * 0.91],
    [lengthM],
  );

  return (
    <group>
      {blocks.map((x) => (
        <mesh
          key={`block-${x}`}
          position={[x, blockHeight / 2, widthM / 2]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[lengthM * 0.13, blockHeight, widthM]} />
          <meshStandardMaterial color="#96693a" roughness={0.86} envMapIntensity={0.3} />
        </mesh>
      ))}
      {boards.map((z) => (
        <mesh
          key={`board-${z}`}
          position={[lengthM / 2, blockHeight + boardHeight / 2, z]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[lengthM, boardHeight, boardWidth]} />
          <meshStandardMaterial color="#b98c52" roughness={0.82} envMapIntensity={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Yük yüksekliği sınırı.
 *
 * Paletin kaç santim boşluğu kaldığı sayıdan çok geometriden okunur; bu düzlem
 * `maxHeightM` sınırını sahnenin içine taşır.
 */
function HeightLimit({
  lengthM,
  widthM,
  heightM,
  exceeded,
}: {
  lengthM: number;
  widthM: number;
  heightM: number;
  exceeded: boolean;
}) {
  // Dolu bir düzlem paletin üstünde duran bir kapak gibi okunuyordu. Sınır bir
  // yüzey değil bir çizgi: yalnız çerçevesi çizilir, içi neredeyse görünmez.
  const outline = useMemo(() => {
    const half = new THREE.Vector2((lengthM * 1.12) / 2, (widthM * 1.12) / 2);
    const corners = [
      new THREE.Vector3(-half.x, 0, -half.y),
      new THREE.Vector3(half.x, 0, -half.y),
      new THREE.Vector3(half.x, 0, half.y),
      new THREE.Vector3(-half.x, 0, half.y),
    ];
    const points: THREE.Vector3[] = [];
    for (let index = 0; index < 4; index += 1) {
      points.push(corners[index], corners[(index + 1) % 4]);
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [lengthM, widthM]);

  useEffect(() => () => outline.dispose(), [outline]);

  const color = exceeded ? "#c8402f" : "#5d7688";

  return (
    <group position={[lengthM / 2, heightM, widthM / 2]}>
      <lineSegments geometry={outline} raycast={() => null}>
        <lineBasicMaterial color={color} transparent opacity={exceeded ? 0.9 : 0.45} />
      </lineSegments>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[lengthM * 1.12, widthM * 1.12]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={exceeded ? 0.12 : 0.04}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function placementPosition(
  placement: PalletPlacementView,
  deckHeightM: number,
): [number, number, number] {
  return [
    placement.x + placement.lengthM / 2,
    deckHeightM + placement.y + placement.heightM / 2,
    placement.z + placement.widthM / 2,
  ];
}

export function PalletScene3D({
  plan,
  selectedHuCode,
  visibleThroughSeq,
  onSelect,
}: {
  plan: PalletPlanView;
  selectedHuCode: string | null;
  visibleThroughSeq: number;
  onSelect: (huCode: string | null) => void;
}) {
  const base = plan.base;

  // Kadraj yüke göre değil palete göre kurulur: her yerleştirme düzenlemesinde
  // kamera yeniden çerçevelese çalışma alanı yerinde durmaz.
  const bounds = useMemo(
    () => ({
      lengthM: base.lengthM,
      widthM: base.widthM,
      heightM: Math.max(base.maxHeightM, plan.usedHeightM + base.deckHeightM),
    }),
    [base.lengthM, base.widthM, base.maxHeightM, base.deckHeightM, plan.usedHeightM],
  );

  const center: [number, number, number] = useMemo(
    () => [base.lengthM / 2, bounds.heightM * 0.42, base.widthM / 2],
    [base.lengthM, base.widthM, bounds.heightM],
  );

  const cog = plan.centerOfGravity;

  return (
    <Canvas
      // Sahne statiktir: kullanıcı bir şey değiştirmedikçe kare çizmek düşük
      // donanımda pili ve kare hızını boşa harcar. Animasyonlar ve sönümlemeli
      // yörünge süresince `invalidate()` ile kare istenir.
      frameloop="demand"
      shadows
      dpr={[1, 2]}
      camera={{ fov: 34, near: 0.01, far: 100 }}
      onPointerMissed={() => onSelect(null)}
      gl={{
        antialias: true,
        alpha: false,
        // Nötr eğri açık zemini beyaz bırakıyor ve durak renklerini panelin
        // hex'inden kaydırmıyor; ACES ikisini de griye çekiyordu.
        toneMapping: THREE.NeutralToneMapping,
        toneMappingExposure: 1,
      }}
    >
      <color attach="background" args={["#f2f5f7"]} />
      <fog attach="fog" args={["#f2f5f7", 6, 18]} />

      <StudioLighting bounds={bounds} center={center} />
      <StudioCameraRig
        bounds={bounds}
        target={center}
        direction={[0.78, 0.52, 0.82]}
        padding={1.2}
        resetKey={plan.id}
      />

      {/*
        Zemin. Gölgeyi yönlü ışığın gölge haritası üretiyor; drei'nin
        `ContactShadows`'u burada kullanılamıyor çünkü canvas `alpha: false` ile
        açılıyor ve gölge dokusunun boş alanı temizleme alfası 1 olduğu için
        opak siyah kalıyor — zemine araçtan çok daha geniş, tek parça gri bir
        levha olarak düşüyordu.
      */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[base.lengthM / 2, 0, base.widthM / 2]}
        receiveShadow
      >
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial color="#e7ecef" roughness={0.95} envMapIntensity={0.2} />
      </mesh>

      <gridHelper
        args={[6, 30, "#c2ced6", "#dde4e9"]}
        position={[base.lengthM / 2, 0.002, base.widthM / 2]}
      />

      <PalletBase
        lengthM={base.lengthM}
        widthM={base.widthM}
        deckHeightM={base.deckHeightM}
      />

      {/*
        Bütün yerleştirmeler çizilir; replay yalnız `shown` bayrağını değiştirir.
        Filtrelenip DOM'dan düşürülselerdi kaybolma animasyonu hiç çalışmazdı —
        birim silinmiş olurdu.
      */}
      {plan.placements.map((placement) => (
        <LoadUnitMesh
          key={placement.huCode}
          position={placementPosition(placement, base.deckHeightM)}
          size={[placement.lengthM, placement.heightM, placement.widthM]}
          color={colorForStop(placement.stopCode)}
          shown={placement.seq <= visibleThroughSeq}
          selected={placement.huCode === selectedHuCode}
          locked={placement.locked}
          onSelect={() => onSelect(placement.huCode)}
        />
      ))}

      <HeightLimit
        lengthM={base.lengthM}
        widthM={base.widthM}
        heightM={base.deckHeightM + base.maxHeightM}
        exceeded={plan.usedHeightM > base.maxHeightM}
      />

      {/* Ağırlık merkezi: paletin ortasından ne kadar kaydığı yalnız sayıyla
          anlaşılmıyor. Küre ile tabana inen çizgi kaymayı doğrudan gösterir. */}
      <group position={[cog.x, base.deckHeightM + cog.y, cog.z]}>
        <mesh raycast={() => null}>
          <sphereGeometry args={[0.035, 20, 14]} />
          <meshStandardMaterial
            color="#e03d30"
            emissive="#8f1e17"
            emissiveIntensity={0.35}
            roughness={0.35}
          />
        </mesh>
        <mesh
          position={[0, -(base.deckHeightM + cog.y) / 2, 0]}
          raycast={() => null}
        >
          <cylinderGeometry args={[0.005, 0.005, base.deckHeightM + cog.y, 8]} />
          <meshBasicMaterial color="#e03d30" transparent opacity={0.45} />
        </mesh>
      </group>

      <OrbitControls
        makeDefault
        // Sönümleme olmadan yörünge fare bırakıldığı anda duruyordu; hareketin
        // sönerek bitmesi kamerayı takip edilebilir kılıyor.
        enableDamping
        dampingFactor={0.085}
        // `frameloop="demand"` altında sönümlemenin sürmesi için her değişimde
        // yeni kare istenmeli.
        onChange={() => invalidate()}
        // Paletin altına geçmek anlamsız; zemin altı boş.
        maxPolarAngle={Math.PI / 2 - 0.03}
        target={center}
        minDistance={0.8}
        maxDistance={9}
        zoomSpeed={0.8}
        rotateSpeed={0.75}
      />
    </Canvas>
  );
}
