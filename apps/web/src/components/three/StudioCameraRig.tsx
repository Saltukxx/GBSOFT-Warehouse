import { useEffect, useMemo, useRef } from "react";
import { invalidate, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { fitDistance, type BoundsM } from "./fit";

/**
 * Kamerayı içeriğe göre kadrajlayan ve hedefe yumuşak geçen rig.
 *
 * Eski davranış `camera.position.set(...)` idi: plan değişince kamera bir kare
 * içinde ışınlanıyordu ve kullanıcı nereye baktığını kaybediyordu. Burada geçiş
 * üstel yumuşatma ile yapılıyor — göz hareketi takip edebiliyor.
 *
 * `frameloop="demand"` altında kare ancak istendiğinde çizilir; bu yüzden geçiş
 * sürerken her karede `invalidate()` çağrılır ve hedefe varınca bırakılır.
 * Kullanıcı fareye dokunduğu anda geçiş iptal edilir: kamerayı kullanıcıyla
 * çekiştirmek en sinir bozucu 3B hatasıdır.
 */

export type StudioCameraRigProps = {
  /** Kadrajlanacak hacim (m). */
  bounds: BoundsM;
  /** Yörünge hedefi — dünya koordinatı. */
  target: [number, number, number];
  /** Hedeften kameraya doğru birim yön. */
  direction?: [number, number, number];
  padding?: number;
  /**
   * Değiştiğinde kamera yeniden kadrajlanır.
   *
   * Kadrajı sürekli veriye bağlamıyoruz: her yerleştirme düzenlemesinde kamera
   * oynasa çalışma alanı kullanılamaz hâle gelirdi.
   */
  resetKey: string | number;
};

const DEFAULT_DIRECTION: [number, number, number] = [0.62, 0.5, 0.6];

/** Geçiş hızı; büyük değer daha çabuk oturur. */
const LAMBDA = 4.6;

/** Bu eşiğin altında geçiş bitmiş sayılır (m). */
const SETTLE_M = 0.004;

type OrbitLike = {
  target: THREE.Vector3;
  update: () => void;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export function StudioCameraRig({
  bounds,
  target,
  direction = DEFAULT_DIRECTION,
  padding = 1.12,
  resetKey,
}: StudioCameraRigProps) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const controls = useThree((state) => state.controls) as OrbitLike | null;

  const [targetX, targetY, targetZ] = target;
  const [dirX, dirY, dirZ] = direction;
  const { lengthM, widthM, heightM } = bounds;

  const goal = useMemo(() => {
    const aspect = size.height > 0 ? size.width / size.height : 1.6;
    const forward = new THREE.Vector3(dirX, dirY, dirZ).normalize();
    const distance = fitDistance(
      { lengthM, widthM, heightM },
      (camera as THREE.PerspectiveCamera).fov ?? 35,
      aspect,
      forward,
      padding,
    );
    const focus = new THREE.Vector3(targetX, targetY, targetZ);
    return {
      position: focus.clone().add(forward.multiplyScalar(distance)),
      focus,
      distance,
    };
  }, [
    camera,
    lengthM,
    widthM,
    heightM,
    targetX,
    targetY,
    targetZ,
    dirX,
    dirY,
    dirZ,
    padding,
    size.width,
    size.height,
  ]);

  const goalRef = useRef(goal);
  goalRef.current = goal;

  const animating = useRef(false);
  const settled = useRef(false);

  // Kullanıcı sürüklemeye başladığı anda kamera kontrolü ona geçer.
  useEffect(() => {
    if (!controls) return;
    const stop = () => {
      animating.current = false;
    };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  useEffect(() => {
    // İlk kadraj anlık olmalı: açılışta kameranın süzülerek gelmesi yükleme
    // gecikmesi gibi okunuyor.
    if (!settled.current) {
      camera.position.copy(goal.position);
      camera.lookAt(goal.focus);
      if (controls) {
        controls.target.copy(goal.focus);
        controls.update();
      }
      const perspective = camera as THREE.PerspectiveCamera;
      perspective.far = Math.max(goal.distance * 4, 40);
      perspective.near = Math.max(goal.distance / 900, 0.01);
      perspective.updateProjectionMatrix();
      settled.current = true;
      invalidate();
      return;
    }
    // `resetKey` kadrajın kendisini değiştirmez; kullanıcı kamerayı çevirdikten
    // sonra "hazır açıya dön" demenin yolu budur. Hedef aynı kalsa bile geçiş
    // yeniden başlar.
    animating.current = true;
    invalidate();
  }, [camera, controls, goal, resetKey]);

  useFrame((_, delta) => {
    if (!animating.current) return;
    // Sekme arka plandayken delta saniyelerce büyür; sıçramayı kırpıyoruz.
    const dt = Math.min(delta, 1 / 30);
    const next = goalRef.current;

    camera.position.x = THREE.MathUtils.damp(camera.position.x, next.position.x, LAMBDA, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, next.position.y, LAMBDA, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, next.position.z, LAMBDA, dt);

    if (controls) {
      controls.target.x = THREE.MathUtils.damp(controls.target.x, next.focus.x, LAMBDA, dt);
      controls.target.y = THREE.MathUtils.damp(controls.target.y, next.focus.y, LAMBDA, dt);
      controls.target.z = THREE.MathUtils.damp(controls.target.z, next.focus.z, LAMBDA, dt);
      controls.update();
    } else {
      camera.lookAt(next.focus);
    }

    if (
      camera.position.distanceTo(next.position) < SETTLE_M &&
      (!controls || controls.target.distanceTo(next.focus) < SETTLE_M)
    ) {
      camera.position.copy(next.position);
      controls?.target.copy(next.focus);
      controls?.update();
      animating.current = false;
    }
    invalidate();
  });

  return null;
}
