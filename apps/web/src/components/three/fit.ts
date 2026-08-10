import * as THREE from "three";

/**
 * Kadraj matematiği.
 *
 * Üç sahnenin (depo, palet, araç) üçü de aynı soruyu soruyor: "şu kutunun
 * tamamı ekrana sığsın diye kamera ne kadar uzakta durmalı?" Sabit çarpanlar
 * yazmak işe yaramıyor — depo 143 m, palet 1.2 m, yarı römork 13.6 m. Uzaklık
 * içeriğin kendi sınırlarından hesaplanmalı.
 */

export type BoundsM = {
  /** Dünya x ekseni boyunca ölçü. */
  lengthM: number;
  /** Dünya y ekseni boyunca ölçü (yükseklik). */
  heightM: number;
  /** Dünya z ekseni boyunca ölçü. */
  widthM: number;
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Kutunun sekiz köşesini kamera düzlemine yansıtıp gereken en büyük uzaklığı
 * döner.
 *
 * Sınırlayıcı küre kullanmıyoruz: hem depo hem araç yassı ve uzun hacimler,
 * küre bu kutuları fena hâlde şişirir ve sahne ekranın ortasında minicik kalır.
 * Köşe izdüşümü hem yatay hem düşey görüş açısını ayrı ayrı hesaba katar, bu
 * yüzden dar ve geniş pencerelerde aynı biçimde doğru çalışır.
 */
export function fitDistance(
  bounds: BoundsM,
  fovDeg: number,
  aspect: number,
  direction: THREE.Vector3,
  padding = 1.12,
): number {
  const vertical = (fovDeg * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * Math.max(aspect, 0.2));
  const tanV = Math.tan(vertical / 2);
  const tanH = Math.tan(horizontal / 2);

  const forward = direction.clone().normalize();
  // Bakış yönü tam dikeye yaklaşırsa `up` ile paralelleşir ve sağ vektör
  // tanımsız kalır; tepeden görünüşte kadraj bu yüzden bozulurdu.
  const reference =
    Math.abs(forward.dot(WORLD_UP)) > 0.999 ? new THREE.Vector3(0, 0, 1) : WORLD_UP;
  const right = new THREE.Vector3().crossVectors(reference, forward).normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();

  const half = new THREE.Vector3(
    bounds.lengthM / 2,
    bounds.heightM / 2,
    bounds.widthM / 2,
  );

  let distance = 0;
  for (let index = 0; index < 8; index += 1) {
    const corner = new THREE.Vector3(
      index & 1 ? half.x : -half.x,
      index & 2 ? half.y : -half.y,
      index & 4 ? half.z : -half.z,
    );
    // Köşenin kameraya doğru olan bileşeni uzaklığa eklenir: öne düşen köşe
    // arkadakinden daha erken kadraj dışına taşar.
    const depth = corner.dot(forward);
    const needed =
      Math.max(Math.abs(corner.dot(right)) / tanH, Math.abs(corner.dot(up)) / tanV) +
      depth;
    distance = Math.max(distance, needed);
  }

  return Math.max(distance * padding, 0.5);
}

/** Kare hızından bağımsız üstel yumuşatma. */
export function damp(current: number, goal: number, lambda: number, dt: number): number {
  return THREE.MathUtils.damp(current, goal, lambda, dt);
}
