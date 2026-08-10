import { useMemo } from "react";
import { Canvas, invalidate } from "@react-three/fiber";
import { Edges, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { TruckLoadPlanView, VehicleTemplate } from "@gbsoft/domain";
import { StudioCameraRig } from "../three/StudioCameraRig";
import { StudioLighting } from "../three/StudioLighting";
import { LoadUnitMesh } from "../three/LoadUnitMesh";
import { colorForStop } from "../../features/load-studio/loadColors";

/**
 * Araç yerleşiminin 3B görünümü.
 *
 * Koordinat araç yerelidir: `x` ön duvardan arka kapıya, `y` sol-sağ, `z`
 * tabandan tavana. three.js'te düşey eksen `y` olduğu için `y` ve `z` yer
 * değiştirir — dönüşüm yalnız burada yapılır, veri hiçbir yerde çevrilmez.
 */

/** Teker yarıçapı (m). Ölçü değil, aks konumunu gösteren temsilî bir gövde. */
const WHEEL_RADIUS = 0.34;
/** Aks ekseninin taban kotuna göre yüksekliği (m). */
const AXLE_Y = -0.42;
/** Tekerin değdiği zemin. */
const GROUND_Y = AXLE_Y - WHEEL_RADIUS;

const PANEL = "#93a6b1";
/**
 * Gövde kenar rengi.
 *
 * Duvarlar aydınlıkta neredeyse beyaza çıkıyor ve araç arka planla aynı tona
 * düşüyordu; ince kontur kutunun sınırlarını ışıktan bağımsız tutuyor.
 */
const OUTLINE = "#6c808d";

/**
 * Araç gövdesi: taban, duvarlar, kapı çerçevesi, şasi ve tekerler.
 *
 * Kesit görünümünde yakın duvar ve tavan çizilmez — yükün içine bakmanın tek
 * yolu budur. Uzak duvar her zaman durur, aksi hâlde yerleşimin hangi tarafa
 * dayandığı kaybolur.
 */
function VehicleShell({
  vehicle,
  sectionView,
}: {
  vehicle: VehicleTemplate;
  sectionView: boolean;
}) {
  const { internalLengthM: length, internalWidthM: width, internalHeightM: height } =
    vehicle;
  const door = vehicle.rearDoor;
  const doorMinY = (width - door.widthM) / 2;

  return (
    <group>
      {/* Yük tabanı */}
      <mesh position={[length / 2, -0.04, width / 2]} castShadow receiveShadow>
        <boxGeometry args={[length, 0.08, width]} />
        <meshStandardMaterial color="#5d6f79" roughness={0.88} envMapIntensity={0.25} />
        <Edges color={OUTLINE} threshold={15} />
      </mesh>

      {/* Ön duvar — kabin tarafı, her zaman kapalı */}
      <mesh position={[-0.03, height / 2, width / 2]} castShadow receiveShadow>
        <boxGeometry args={[0.06, height, width]} />
        <meshStandardMaterial color="#9fb0ba" roughness={0.7} envMapIntensity={0.3} />
        <Edges color={OUTLINE} threshold={15} />
      </mesh>

      {/* Uzak duvar — yükün hangi tarafa dayandığı buradan okunur, bu yüzden
          kesit görünümünde bile durur ve neredeyse mat kalır. */}
      <mesh position={[length / 2, height / 2, -0.02]} receiveShadow>
        <boxGeometry args={[length, height, 0.04]} />
        <meshStandardMaterial
          color={PANEL}
          roughness={0.68}
          transparent
          opacity={0.82}
          envMapIntensity={0.3}
        />
        <Edges color={OUTLINE} threshold={15} />
      </mesh>

      {!sectionView ? (
        <>
          {/* Yakın duvar ve tavan: kesit kapalıyken hacmi kapatır, ama içerideki
              yükü tamamen gizlememesi için çok saydamdır. `depthWrite` kapalı,
              yoksa arkasındaki kutular sıralama hatasıyla kaybolur. */}
          <mesh position={[length / 2, height / 2, width + 0.02]}>
            <boxGeometry args={[length, height, 0.04]} />
            <meshStandardMaterial
              color={PANEL}
              roughness={0.7}
              transparent
              opacity={0.16}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[length / 2, height + 0.02, width / 2]}>
            <boxGeometry args={[length, 0.04, width]} />
            <meshStandardMaterial
              color={PANEL}
              roughness={0.7}
              transparent
              opacity={0.14}
              depthWrite={false}
            />
          </mesh>
        </>
      ) : null}

      {/* Arka kapı açıklığı. Bir birimin araca girip giremeyeceği bu dikdörtgene
          bakılarak anlaşılır; doğrulayıcının `door-clearance` ihlali tam olarak
          bu çerçeveyi ölçer. */}
      <group position={[length + 0.01, 0, 0]}>
        {[
          { p: [0, door.sillHeightM + door.heightM, width / 2], s: [0.03, 0.05, width] },
          { p: [0, door.sillHeightM, width / 2], s: [0.03, 0.05, width] },
          { p: [0, height / 2, doorMinY], s: [0.03, height, 0.05] },
          { p: [0, height / 2, doorMinY + door.widthM], s: [0.03, height, 0.05] },
        ].map((bar, index) => (
          <mesh key={index} position={bar.p as [number, number, number]}>
            <boxGeometry args={bar.s as [number, number, number]} />
            <meshStandardMaterial
              color="#2f4250"
              roughness={0.55}
              metalness={0.35}
              envMapIntensity={0.6}
            />
          </mesh>
        ))}
      </group>

      {/* Köşe dikmeleri */}
      {[0.03, width - 0.03].map((z) => (
        <mesh key={`post-${z}`} position={[length, height / 2, z]}>
          <boxGeometry args={[0.06, height, 0.06]} />
          <meshStandardMaterial color="#33454f" roughness={0.5} metalness={0.4} />
        </mesh>
      ))}

      {/* Şasi kirişleri */}
      {[width * 0.22, width * 0.78].map((z) => (
        <mesh key={`rail-${z}`} position={[length / 2, AXLE_Y + 0.14, z]} castShadow>
          <boxGeometry args={[length * 0.96, 0.16, 0.1]} />
          <meshStandardMaterial color="#3a4a54" roughness={0.72} metalness={0.2} />
        </mesh>
      ))}

      {/* Tekerler — her aks grubunda iki tekerlek. Tek bir mil yerine gerçek
          teker çizmek aks konumunu sahnede kendiliğinden okunur kılıyor. */}
      {vehicle.axleGroups.map((axle) =>
        [-0.09, width + 0.09].map((z) => (
          <group
            key={`${axle.code}-${z}`}
            position={[axle.positionX, AXLE_Y, z]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <mesh castShadow>
              <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, 0.2, 26]} />
              <meshStandardMaterial color="#20272c" roughness={0.92} />
            </mesh>
            <mesh position={[0, 0.005, 0]}>
              <cylinderGeometry
                args={[WHEEL_RADIUS * 0.45, WHEEL_RADIUS * 0.45, 0.21, 20]}
              />
              <meshStandardMaterial color="#8a959c" roughness={0.4} metalness={0.55} />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

/**
 * Güvenli ağırlık merkezi zarfı.
 *
 * Kırmızı işaretin "iyi" mi "kötü" mü olduğu tek başına anlaşılmaz; zarf
 * referansı olmadan CoG bir sayıdan ibaret kalır. Yalnız kenarları çizilir,
 * dolu bir kutu yükü örterdi.
 */
function CogEnvelope({ vehicle }: { vehicle: VehicleTemplate }) {
  const envelope = vehicle.cogEnvelope;
  const geometry = useMemo(() => {
    const box = new THREE.BoxGeometry(
      Math.max(envelope.maxX - envelope.minX, 0.01),
      Math.max(envelope.maxZ, 0.01),
      Math.max(envelope.maxY - envelope.minY, 0.01),
    );
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [envelope.minX, envelope.maxX, envelope.minY, envelope.maxY, envelope.maxZ]);

  return (
    <lineSegments
      geometry={geometry}
      position={[
        (envelope.minX + envelope.maxX) / 2,
        envelope.maxZ / 2,
        (envelope.minY + envelope.maxY) / 2,
      ]}
      raycast={() => null}
    >
      <lineBasicMaterial color="#2f8f63" transparent opacity={0.5} />
    </lineSegments>
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
  const vehicle = plan.vehicle;

  const bounds = useMemo(
    () => ({
      lengthM: vehicle.internalLengthM,
      widthM: vehicle.internalWidthM,
      heightM: vehicle.internalHeightM,
    }),
    [vehicle.internalLengthM, vehicle.internalWidthM, vehicle.internalHeightM],
  );

  const center: [number, number, number] = useMemo(
    () => [
      vehicle.internalLengthM / 2,
      vehicle.internalHeightM * 0.4,
      vehicle.internalWidthM / 2,
    ],
    [vehicle.internalLengthM, vehicle.internalHeightM, vehicle.internalWidthM],
  );

  const cog = plan.centerOfGravity;
  const cogInside =
    cog.x >= vehicle.cogEnvelope.minX &&
    cog.x <= vehicle.cogEnvelope.maxX &&
    cog.y >= vehicle.cogEnvelope.minY &&
    cog.y <= vehicle.cogEnvelope.maxY &&
    cog.z <= vehicle.cogEnvelope.maxZ;

  return (
    <Canvas
      frameloop="demand"
      shadows
      dpr={[1, 2]}
      camera={{ fov: 32, near: 0.05, far: 160 }}
      onPointerMissed={() => onSelect(null)}
      gl={{
        antialias: true,
        alpha: false,
        // ACES sinematik bir eğridir: açık gri zemini orta griye indiriyor,
        // arka plan rengi ise tone mapping'e girmediği için açık kalıyordu —
        // araç kendi zemininden ayırt edilemez hâle geliyordu. Nötr eğri
        // beyazı beyaz, durak renklerini de paneldeki hex'iyle aynı bırakıyor.
        toneMapping: THREE.NeutralToneMapping,
        toneMappingExposure: 1,
      }}
    >
      <color attach="background" args={["#f2f5f7"]} />
      {/* Zemin düzlemi araçtan çok daha geniş; sisle arka plana karışmazsa
          kadrajın alt yarısı düz gri bir levha olarak kalıyor. */}
      <fog
        attach="fog"
        args={[
          "#f2f5f7",
          vehicle.internalLengthM * 0.9,
          vehicle.internalLengthM * 2.6,
        ]}
      />

      <StudioLighting bounds={bounds} center={center} />
      <StudioCameraRig
        bounds={bounds}
        target={center}
        // Arka kapı tarafından, hafif yandan bakış: yükleme sırası kapıdan
        // içeriye doğru okunuyor.
        direction={[0.66, 0.4, 0.62]}
        padding={1.04}
        resetKey={plan.id}
      />

      {/*
        Zemin. Gölgeyi yönlü ışığın gölge haritası üretiyor; drei'nin
        `ContactShadows`'u burada kullanılamıyor: canvas `alpha: false` ile
        açılıyor, gölge dokusunun boş alanı temizleme alfası 1 olduğu için opak
        siyah kalıyor ve zemine araçtan çok daha geniş, tek parça gri bir levha
        olarak düşüyordu.
      */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[vehicle.internalLengthM / 2, GROUND_Y, vehicle.internalWidthM / 2]}
        receiveShadow
      >
        <planeGeometry args={[vehicle.internalLengthM * 3, vehicle.internalLengthM * 3]} />
        <meshStandardMaterial color="#edf1f3" roughness={0.96} envMapIntensity={0.2} />
      </mesh>

      <gridHelper
        args={[
          Math.max(vehicle.internalLengthM * 1.6, 6),
          Math.round(Math.max(vehicle.internalLengthM * 1.6, 6)),
          "#c2ced6",
          "#dde4e9",
        ]}
        position={[
          vehicle.internalLengthM / 2,
          GROUND_Y + 0.003,
          vehicle.internalWidthM / 2,
        ]}
      />

      <VehicleShell vehicle={vehicle} sectionView={sectionView} />

      {vehicle.obstacles.map((obstacle) => (
        <mesh
          key={obstacle.code}
          position={[
            obstacle.x + obstacle.lengthM / 2,
            obstacle.z + obstacle.heightM / 2,
            obstacle.y + obstacle.widthM / 2,
          ]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[obstacle.lengthM, obstacle.heightM, obstacle.widthM]} />
          <meshStandardMaterial color="#8e4b44" roughness={0.7} envMapIntensity={0.3} />
          <Edges color="#5f2b26" threshold={15} />
        </mesh>
      ))}

      {/* Bütün birimler çizilir; replay yalnız `shown` bayrağını çevirir, böylece
          hem yerine oturma hem geri sarma animasyonu çalışır. */}
      {plan.placements.map((placement) => (
        <LoadUnitMesh
          key={placement.unitCode}
          position={[
            placement.x + placement.lengthM / 2,
            placement.z + placement.heightM / 2,
            placement.y + placement.widthM / 2,
          ]}
          size={[placement.lengthM, placement.heightM, placement.widthM]}
          color={colorForStop(placement.stopSeq)}
          shown={placement.seq <= visibleThroughSeq}
          selected={placement.unitCode === selectedHuCode}
          locked={placement.locked ?? false}
          onSelect={() => onSelect(placement.unitCode)}
        />
      ))}

      <CogEnvelope vehicle={vehicle} />

      {/* Ağırlık merkezi. Zarfın dışına çıkınca renk değişir — ihlali panelde
          aramadan önce sahnede görmek gerekir. */}
      <group position={[cog.x, cog.z, cog.y]}>
        <mesh raycast={() => null}>
          <sphereGeometry args={[0.1, 22, 14]} />
          <meshStandardMaterial
            color={cogInside ? "#e08a2f" : "#e03d30"}
            emissive={cogInside ? "#8a5312" : "#8f1e17"}
            emissiveIntensity={0.35}
            roughness={0.3}
          />
        </mesh>
        <mesh position={[0, -cog.z / 2, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.012, 0.012, Math.max(cog.z, 0.01), 8]} />
          <meshBasicMaterial
            color={cogInside ? "#e08a2f" : "#e03d30"}
            transparent
            opacity={0.5}
          />
        </mesh>
      </group>


      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.085}
        onChange={() => invalidate()}
        maxPolarAngle={Math.PI / 2 - 0.02}
        target={center}
        minDistance={1.5}
        maxDistance={vehicle.internalLengthM * 2.4}
        zoomSpeed={0.8}
        rotateSpeed={0.75}
      />
    </Canvas>
  );
}
