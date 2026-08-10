import { useEffect, useMemo } from "react";
import { Canvas, invalidate, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { PalletPlanView, PalletPlacementView } from "@gbsoft/domain";

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

function CameraFrame({ plan }: { plan: PalletPlanView }) {
  const { camera } = useThree();
  useEffect(() => {
    const span = Math.max(plan.base.lengthM, plan.base.widthM, plan.base.maxHeightM);
    camera.position.set(span * 1.35, span * 1.05, span * 1.45);
    camera.lookAt(plan.base.lengthM / 2, plan.base.maxHeightM * 0.32, plan.base.widthM / 2);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, plan]);
  return null;
}

function PlacementMesh({
  placement,
  deckHeightM,
  selected,
  onSelect,
}: {
  placement: PalletPlacementView;
  deckHeightM: number;
  selected: boolean;
  onSelect: (huCode: string) => void;
}) {
  const position: [number, number, number] = [
    placement.x + placement.lengthM / 2,
    deckHeightM + placement.y + placement.heightM / 2,
    placement.z + placement.widthM / 2,
  ];
  const scale: [number, number, number] = [
    placement.lengthM * 0.985,
    placement.heightM * 0.985,
    placement.widthM * 0.985,
  ];

  return (
    <group>
      <mesh
        position={position}
        scale={scale}
        castShadow
        receiveShadow
        onClick={(event) => {
          event.stopPropagation();
          onSelect(placement.huCode);
        }}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={colorForStop(placement.stopCode)}
          roughness={0.72}
          metalness={0.02}
          emissive={placement.locked ? "#66549c" : "#000000"}
          emissiveIntensity={placement.locked ? 0.18 : 0}
        />
      </mesh>
      {selected ? (
        <mesh position={position} scale={scale.map((value) => value * 1.035) as [number, number, number]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#0b1f33" wireframe />
        </mesh>
      ) : null}
    </group>
  );
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
  const visible = useMemo(
    () => plan.placements.filter((placement) => placement.seq <= visibleThroughSeq),
    [plan.placements, visibleThroughSeq],
  );

  return (
    <Canvas
      frameloop="demand"
      shadows
      dpr={[1, 1.5]}
      camera={{ fov: 34, near: 0.01, far: 100 }}
      onPointerMissed={() => onSelect(null)}
      gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping }}
    >
      <color attach="background" args={["#f6f8fa"]} />
      <ambientLight intensity={1.35} />
      <directionalLight
        position={[4, 6, 5]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <CameraFrame plan={plan} />

      <mesh
        position={[
          plan.base.lengthM / 2,
          plan.base.deckHeightM / 2,
          plan.base.widthM / 2,
        ]}
        receiveShadow
      >
        <boxGeometry
          args={[plan.base.lengthM, plan.base.deckHeightM, plan.base.widthM]}
        />
        <meshStandardMaterial color="#a97845" roughness={0.9} />
      </mesh>

      {visible.map((placement) => (
        <PlacementMesh
          key={placement.huCode}
          placement={placement}
          deckHeightM={plan.base.deckHeightM}
          selected={placement.huCode === selectedHuCode}
          onSelect={onSelect}
        />
      ))}

      <gridHelper
        args={[4, 20, "#aebec8", "#d5dfe5"]}
        position={[plan.base.lengthM / 2, 0, plan.base.widthM / 2]}
      />
      <ContactShadows
        position={[plan.base.lengthM / 2, 0.002, plan.base.widthM / 2]}
        opacity={0.28}
        scale={4}
        blur={2.2}
        frames={1}
      />
      <OrbitControls
        makeDefault
        enableDamping={false}
        target={[
          plan.base.lengthM / 2,
          plan.base.maxHeightM * 0.32,
          plan.base.widthM / 2,
        ]}
        minDistance={1.2}
        maxDistance={8}
      />
    </Canvas>
  );
}
