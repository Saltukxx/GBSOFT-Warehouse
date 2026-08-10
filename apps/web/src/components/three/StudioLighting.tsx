import { useEffect, useMemo, useRef } from "react";
import { invalidate, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { BoundsM } from "./fit";

/**
 * Palet ve araç sahnelerinin ortak ışık düzeni.
 *
 * Önceki düzen tek yönlü ışık + yüksek ortam ışığıydı: her yüzey aynı parlaklığa
 * yakın çıkıyor, kutuların kenarları birbirine yapışıyordu. Hacim okunurluğu
 * ışığın yönünden gelir — burada bir anahtar, bir dolgu ve bir kontur ışığı var,
 * üstüne kutu kenarlarını ayıran zayıf bir ortam yansıması.
 *
 * Ortam haritası `RoomEnvironment` ile yerelde üretilir. drei'nin hazır
 * `Environment preset`'leri dosyayı CDN'den çeker; bu proje sıkı CSP altında
 * çalışıyor ve sahne hiçbir dış istek yapmamalı.
 */

export type StudioLightingProps = {
  /** Aydınlatılacak hacim (m) — gölge kamerası buradan ölçeklenir. */
  bounds: BoundsM;
  /** Hacmin merkezi; ışıklar ve gölge kamerası buna göre konumlanır. */
  center: [number, number, number];
  /** Ortam yansımasının şiddeti. Veri renklerini yıkamaması için düşük. */
  environmentIntensity?: number;
};

export function StudioLighting({
  bounds,
  center,
  environmentIntensity = 0.34,
}: StudioLightingProps) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const environment = generator.fromScene(room, 0.04).texture;

    scene.environment = environment;
    scene.environmentIntensity = environmentIntensity;

    room.dispose();
    generator.dispose();
    invalidate();

    return () => {
      scene.environment = null;
      environment.dispose();
    };
  }, [gl, scene, environmentIntensity]);

  const radius = useMemo(
    () =>
      Math.max(
        0.6,
        Math.hypot(bounds.lengthM, bounds.widthM, bounds.heightM) / 2,
      ),
    [bounds.lengthM, bounds.widthM, bounds.heightM],
  );

  const [cx, cy, cz] = center;

  /**
   * Anahtar ışığın hedefi.
   *
   * Yönlü ışığın gölge kamerası hedefin etrafında kurulur ve hedef varsayılan
   * olarak dünya merkezidir. Sahne merkezi orijinde olmadığında (araç 0-13.6 m
   * arasında duruyor) gölge haritası sahneyi ıskalıyor, çerçevenin dışında
   * kalan zemin kenar teksele takılıp tek parça gri bir levhaya dönüyordu.
   */
  const lightTarget = useMemo(() => new THREE.Object3D(), []);
  const keyLight = useRef<THREE.DirectionalLight>(null);

  useEffect(() => {
    lightTarget.position.set(cx, cy, cz);
    lightTarget.updateMatrixWorld();
    invalidate();
  }, [lightTarget, cx, cy, cz]);

  /**
   * Gölge kamerasının çerçevesi.
   *
   * `shadow-camera-left` gibi JSX propları değeri yazar ama projeksiyon
   * matrisini yeniden hesaplamaz; kamera varsayılan ±5 birimlik çerçevesinde
   * kalıyor ve 13.6 m'lik aracın gölgesi hiç düşmüyordu. Sınırları burada
   * elle kurup matrisi bir kez güncelliyoruz.
   */
  useEffect(() => {
    const light = keyLight.current;
    if (!light) return;
    const camera = light.shadow.camera;
    const half = radius * 1.6;
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.near = Math.max(radius * 0.2, 0.1);
    camera.far = radius * 6;
    camera.updateProjectionMatrix();
    light.shadow.needsUpdate = true;
    invalidate();
  }, [radius]);

  return (
    <group>
      {/*
        Toplam aydınlatma bilerek "tam beyazın" biraz altında tutuluyor.
        Şiddetler yükseltildiğinde zemin doyuma gidip düz beyaza kilitleniyor ve
        gölgeli bölge de aynı beyaza çıktığı için gölge tamamen kayboluyor —
        sahne aydınlık ama okunmaz hâle geliyor.
      */}
      {/* Gökyüzü/zemin ayrımı: üst yüzeyler yan yüzeylerden hep bir tık açık
          kalır, kutu köşeleri bu farkla okunur. */}
      <hemisphereLight args={["#ffffff", "#c3ccd2", 1]} />

      <primitive object={lightTarget} />

      {/*
        Anahtar ışık, kameranın ekseninden yaklaşık 90° yana kaydırılmış ve
        45° civarında yükseltilmiştir. Kameranın arkasından aydınlatıldığında
        her gölge cismin kendi arkasına düşüyor, ekranda hiçbiri görünmüyordu —
        sahne kâğıttan kesilmiş gibi duruyordu.
      */}
      <directionalLight
        ref={keyLight}
        target={lightTarget}
        position={[cx + radius * 0.9, cy + radius * 1.5, cz - radius * 1.05]}
        intensity={1.9}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-normalBias={radius * 0.01}
      />

      {/* Dolgu: anahtar ışığın gölgede bıraktığı yüzler tamamen kararmasın. */}
      <directionalLight
        target={lightTarget}
        position={[cx - radius * 1.3, cy + radius * 0.7, cz + radius * 1.1]}
        intensity={0.55}
      />

      {/* Kontur: arka üstten gelir, kutu siluetini arka plandan ayırır. */}
      <directionalLight
        target={lightTarget}
        position={[cx - radius * 1.5, cy + radius * 1.2, cz - radius * 0.5]}
        intensity={0.4}
      />
    </group>
  );
}
