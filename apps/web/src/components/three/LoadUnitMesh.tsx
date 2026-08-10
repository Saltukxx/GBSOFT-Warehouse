import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invalidate, useFrame } from "@react-three/fiber";
import { Edges, RoundedBox } from "@react-three/drei";
import * as THREE from "three";

/**
 * Palet ve araç sahnelerinde tek bir yük birimi.
 *
 * Üç şey ortak olduğu için tek bileşende toplandı: yükleme sırası replay'inde
 * belirme/kaybolma animasyonu, seçim konturu ve fare geri bildirimi.
 *
 * Replay eskiden sert kesmeydi — kutu bir karede yoktu, sonraki karede vardı.
 * Sıra bilgisini gözle takip etmek imkânsızdı. Şimdi birim yukarıdan inip
 * yerine oturuyor: hareketin yönü "bu birim şimdi yüklendi" diyor.
 */

export type LoadUnitMeshProps = {
  /** Kutunun merkezi — dünya koordinatı (m). */
  position: [number, number, number];
  /** Kutunun gerçek ölçüsü [uzunluk, yükseklik, genişlik] (m). */
  size: [number, number, number];
  color: string;
  /** Replay'de bu birim yerine kondu mu? */
  shown: boolean;
  selected: boolean;
  locked?: boolean;
  onSelect: () => void;
  onHoverChange?: (hovered: boolean) => void;
};

/** Belirme/kaybolma hızı. */
const LAMBDA = 7.5;
const SETTLE = 0.002;

/** Kenar boşluğu: komşu kutular birbirine yapışık görünmesin. */
const GAP = 0.985;

/** Seçim konturunun kalınlığı (oran). */
const OUTLINE = 1.035;

export function LoadUnitMesh({
  position,
  size,
  color,
  shown,
  selected,
  locked = false,
  onSelect,
  onHoverChange,
}: LoadUnitMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const progress = useRef(shown ? 1 : 0);
  const [hovered, setHovered] = useState(false);

  const [length, height, width] = size;
  // Yarıçap en kısa kenara bağlı: ince bir kutuda sabit yarıçap köşeyi yutar.
  const radius = Math.min(0.016, Math.min(length, height, width) * 0.1);
  // Birim ne kadar yüksekten iner — büyük kutu daha uzun yol alsın istemiyoruz,
  // hareket her ölçekte aynı sürede bitmeli.
  const drop = Math.min(0.45, height * 0.9 + 0.1);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const goal = shown ? 1 : 0;
    if (Math.abs(progress.current - goal) < SETTLE) {
      if (progress.current !== goal) {
        progress.current = goal;
        apply(group, goal, position, drop);
        invalidate();
      }
      return;
    }

    const dt = Math.min(delta, 1 / 30);
    progress.current = THREE.MathUtils.damp(progress.current, goal, LAMBDA, dt);
    apply(group, progress.current, position, drop);
    invalidate();
  });

  // Konum değişince (taşıma/döndürme sonrası) grubu hemen yerine koy. Boyama
  // öncesi çalışmalı: `useEffect` ile ilk karede kutu bir an başlangıç
  // noktasında görünüyordu.
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (group) apply(group, progress.current, position, drop);
  }, [position, drop]);

  useEffect(() => {
    if (!hovered) return;
    document.body.style.cursor = "pointer";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  const setHover = (value: boolean) => {
    setHovered(value);
    onHoverChange?.(value);
  };

  return (
    <group ref={groupRef}>
      {selected ? (
        // Kontur, kutunun arka yüzlerini biraz büyütülmüş çizerek elde edilir.
        // Eski tel kafes seçili kutunun içini de çiziyordu ve rengi okunmaz
        // hâle getiriyordu.
        <mesh
          scale={[length * OUTLINE, height * OUTLINE, width * OUTLINE]}
          raycast={() => null}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#0b1f33" side={THREE.BackSide} />
        </mesh>
      ) : null}

      <RoundedBox
        args={[length * GAP, height * GAP, width * GAP]}
        radius={radius}
        smoothness={2}
        castShadow
        receiveShadow
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
      >
        <meshStandardMaterial
          color={color}
          roughness={hovered ? 0.42 : 0.55}
          metalness={0.04}
          envMapIntensity={0.5}
          // Kilitli birim mor bir iç ışıkla ayrılır; renk kodu durak rengidir,
          // kilidi renkle anlatmak durak okumasını bozardı.
          emissive={locked ? "#6a52b8" : hovered ? "#ffffff" : "#000000"}
          emissiveIntensity={locked ? 0.28 : hovered ? 0.09 : 0}
        />
        <Edges
          threshold={15}
          color={selected ? "#0b1f33" : locked ? "#e8e2ff" : "#ffffff"}
        />
      </RoundedBox>
    </group>
  );
}

/** Animasyon ilerlemesini gruba uygular. */
function apply(
  group: THREE.Group,
  progress: number,
  position: [number, number, number],
  drop: number,
) {
  const eased = easeOutCubic(progress);
  group.visible = progress > 0.001;
  group.scale.setScalar(0.82 + eased * 0.18);
  group.position.set(
    position[0],
    position[1] + (1 - eased) * drop,
    position[2],
  );
}

function easeOutCubic(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return 1 - (1 - clamped) ** 3;
}
