import { useEffect, useMemo } from "react";
import { Canvas, invalidate, useThree } from "@react-three/fiber";
import { ContactShadows, Edges, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { TruckLoadPlanView } from "@gbsoft/domain";
import { colorForStop } from "../../features/load-studio/loadColors";

function CameraFrame({ plan }: { plan: TruckLoadPlanView }) {
  const { camera } = useThree();
  useEffect(() => {
    const vehicle = plan.vehicle;
    camera.position.set(
      vehicle.internalLengthM * 0.56,
      vehicle.internalHeightM * 1.8,
      vehicle.internalWidthM + vehicle.internalLengthM * 1.12,
    );
    camera.lookAt(
      vehicle.internalLengthM / 2,
      vehicle.internalHeightM * 0.28,
      vehicle.internalWidthM / 2,
    );
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, plan]);
  return null;
}

function Shell({ plan, sectionView }: { plan: TruckLoadPlanView; sectionView: boolean }) {
  const { internalLengthM: length, internalWidthM: width, internalHeightM: height } =
    plan.vehicle;
  const panel = "#b8c7cf";
  return (
    <group>
      <mesh position={[length / 2, -0.035, width / 2]} receiveShadow>
        <boxGeometry args={[length, 0.07, width]} />
        <meshStandardMaterial color="#647782" roughness={0.82} />
      </mesh>
      <mesh position={[0, height / 2, width / 2]}>
        <boxGeometry args={[0.045, height, width]} />
        <meshStandardMaterial color={panel} roughness={0.72} />
      </mesh>
      <mesh position={[length / 2, height / 2, 0]}>
        <boxGeometry args={[length, height, 0.035]} />
        <meshStandardMaterial color={panel} roughness={0.72} transparent opacity={0.58} />
      </mesh>
      {!sectionView ? (
        <>
          <mesh position={[length / 2, height / 2, width]}>
            <boxGeometry args={[length, height, 0.035]} />
            <meshStandardMaterial color={panel} roughness={0.72} transparent opacity={0.35} />
          </mesh>
          <mesh position={[length / 2, height, width / 2]}>
            <boxGeometry args={[length, 0.035, width]} />
            <meshStandardMaterial color={panel} roughness={0.72} transparent opacity={0.28} />
          </mesh>
        </>
      ) : null}
      <mesh position={[length, height / 2, 0.025]}>
        <boxGeometry args={[0.05, height, 0.05]} />
        <meshStandardMaterial color="#344955" />
      </mesh>
      <mesh position={[length, height / 2, width - 0.025]}>
        <boxGeometry args={[0.05, height, 0.05]} />
        <meshStandardMaterial color="#344955" />
      </mesh>
      <mesh position={[length, height, width / 2]}>
        <boxGeometry args={[0.05, 0.05, width]} />
        <meshStandardMaterial color="#344955" />
      </mesh>
      {plan.vehicle.axleGroups.map((axle) => (
        <mesh
          key={axle.code}
          position={[axle.positionX, -0.14, width / 2]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.14, 0.14, width + 0.28, 20]} />
          <meshStandardMaterial color="#24333b" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

export function TruckLoadScene3D({
  plan,
  selectedHuCode,
  visibleThroughSeq,
  sectionView,
  onSelect,
}: {
  plan: TruckLoadPlanView;
  selectedHuCode: string | null;
  visibleThroughSeq: number;
  sectionView: boolean;
  onSelect: (huCode: string | null) => void;
}) {
  const visible = useMemo(
    () => plan.placements.filter((placement) => placement.seq <= visibleThroughSeq),
    [plan.placements, visibleThroughSeq],
  );
  const vehicle = plan.vehicle;

  return (
    <Canvas
      frameloop="demand"
      shadows
      dpr={[1, 1.5]}
      camera={{ fov: 32, near: 0.01, far: 120 }}
      onPointerMissed={() => onSelect(null)}
      gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping }}
    >
      <color attach="background" args={["#f4f7f8"]} />
      <ambientLight intensity={1.45} />
      <directionalLight position={[5, 9, 7]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
      <CameraFrame plan={plan} />
      <Shell plan={plan} sectionView={sectionView} />

      {vehicle.obstacles.map((obstacle) => (
        <mesh
          key={obstacle.code}
          position={[
            obstacle.x + obstacle.lengthM / 2,
            obstacle.z + obstacle.heightM / 2,
            obstacle.y + obstacle.widthM / 2,
          ]}
        >
          <boxGeometry args={[obstacle.lengthM, obstacle.heightM, obstacle.widthM]} />
          <meshStandardMaterial color="#9a4f47" roughness={0.76} />
          <Edges color="#71342f" />
        </mesh>
      ))}

      {visible.map((placement) => {
        const selected = placement.unitCode === selectedHuCode;
        const position: [number, number, number] = [
          placement.x + placement.lengthM / 2,
          placement.z + placement.heightM / 2,
          placement.y + placement.widthM / 2,
        ];
        return (
          <group key={placement.unitCode}>
            <mesh
              position={position}
              scale={[
                placement.lengthM * 0.985,
                placement.heightM * 0.985,
                placement.widthM * 0.985,
              ]}
              castShadow
              receiveShadow
              onClick={(event) => {
                event.stopPropagation();
                onSelect(placement.unitCode);
              }}
            >
              <boxGeometry args={[1, 1, 1]} />
              <meshStandardMaterial
                color={colorForStop(placement.stopSeq)}
                roughness={0.68}
                emissive={placement.locked ? "#66549c" : "#000000"}
                emissiveIntensity={placement.locked ? 0.24 : 0}
              />
              <Edges color={selected ? "#091b2a" : "#ffffff"} threshold={15} />
            </mesh>
            {selected ? (
              <mesh
                position={position}
                scale={[
                  placement.lengthM * 1.035,
                  placement.heightM * 1.035,
                  placement.widthM * 1.035,
                ]}
              >
                <boxGeometry args={[1, 1, 1]} />
                <meshBasicMaterial color="#0b1f33" wireframe />
              </mesh>
            ) : null}
          </group>
        );
      })}

      <mesh
        position={[
          plan.centerOfGravity.x,
          plan.centerOfGravity.z,
          plan.centerOfGravity.y,
        ]}
      >
        <sphereGeometry args={[0.095, 20, 12]} />
        <meshStandardMaterial color="#e03d30" emissive="#8f1e17" emissiveIntensity={0.28} />
      </mesh>

      <gridHelper
        args={[Math.max(vehicle.internalLengthM, 4), 28, "#aebec8", "#d5dfe5"]}
        position={[vehicle.internalLengthM / 2, 0.005, vehicle.internalWidthM / 2]}
      />
      <ContactShadows
        position={[vehicle.internalLengthM / 2, -0.002, vehicle.internalWidthM / 2]}
        opacity={0.25}
        scale={vehicle.internalLengthM + 2}
        blur={2.4}
        frames={1}
      />
      <OrbitControls
        makeDefault
        enableDamping={false}
        target={[
          vehicle.internalLengthM / 2,
          vehicle.internalHeightM * 0.28,
          vehicle.internalWidthM / 2,
        ]}
        minDistance={2}
        maxDistance={vehicle.internalLengthM * 2}
      />
    </Canvas>
  );
}
