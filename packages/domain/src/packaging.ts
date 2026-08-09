/**
 * Paket profilleri ve elleçleme birimleri (Faz 7).
 *
 * Bir sevkiyatta taşınan şey SKU değil, **elleçleme birimidir**: koli, palet,
 * varil, düzensiz rijit yük ya da çuval/balya gibi esnek bir zarf. Yükleme
 * kararları bu birimlerin fiziksel profilinden çıkar.
 *
 * Ölçüler kanonik olarak metre, ağırlıklar kilogramdır (`geometry3d.ts` ile
 * aynı sözleşme).
 *
 * **Esnek yükler için soft-body fizik kullanılmaz.** Çuval ve balya, ölçülmüş
 * hacme deformasyon payı eklenmiş muhafazakâr bir zarfla modellenir; üst yük
 * ve komşuluk kuralları bu zarf üzerinden işler. Sıkışmayı simüle etmek,
 * ölçmediğimiz bir davranışı ölçmüş gibi göstermek olurdu.
 */

/* ------------------------------------------------------------------ */
/* Paket türü                                                          */
/* ------------------------------------------------------------------ */

export type PackageShape =
  | "case"
  | "pallet"
  | "drum"
  | "irregular"
  | "flexible";

/**
 * İzin verilen yönelimler.
 *
 * `yaw` gerçek depo davranışıdır: koli düşey ekseni etrafında çevrilir ama
 * yan yatırılmaz. `any` yalnız yönelimi gerçekten serbest yükler içindir.
 */
export type RotationMode = "fixed" | "yaw" | "any";

export type TemperatureClass = "ambient" | "chilled" | "frozen";

export type PackageType = {
  code: string;
  name: string;
  shape: PackageShape;
  /** Dış taşıma zarfı (m). Silindirik yükler kendi kapsayan kutusuyla temsil edilir. */
  lengthM: number;
  widthM: number;
  heightM: number;
  /** Boş ağırlık (kg). */
  tareKg: number;
  rotation: RotationMode;
  /**
   * Üstüne binebilecek toplam yük (kg). `0` ise üstüne hiçbir şey konamaz.
   * Kırılgan yüklerde bu değer stackability'den daha bağlayıcıdır.
   */
  maxTopLoadKg: number;
  /** Altındaki yüzeyin en az bu oranı destek olmalı (0-1). */
  minSupportRatio: number;
  stackable: boolean;
  fragile: boolean;
  /**
   * Esnek yükler için hacim toleransı (oran). Zarf bu kadar sıkışabilir
   * sayılır ama plan **sıkışmamış** ölçüyle doğrulanır — muhafazakâr taraf.
   */
  compressionTolerancePct: number;
  temperatureClass: TemperatureClass;
  /**
   * Ayrım grubu. Farklı gruplar aynı elleçleme birimine konamaz (gıda/kimyasal
   * gibi). Boşsa ayrım kuralı yoktur.
   */
  segregationGroup?: string;
};

/**
 * Şablonlarda ve golden dataset'te kullanılan başlangıç profilleri.
 *
 * Değerler **ölçülmemiştir**; makul saha varsayılanlarıdır. Gerçek tesiste
 * `package-type` şablonuyla içe aktarılır ve bu tablonun yerini alır.
 */
export const DEFAULT_PACKAGE_TYPES: readonly PackageType[] = [
  {
    code: "CASE-STD",
    name: "Standart koli",
    shape: "case",
    lengthM: 0.6,
    widthM: 0.4,
    heightM: 0.3,
    tareKg: 0.8,
    rotation: "yaw",
    maxTopLoadKg: 120,
    minSupportRatio: 0.75,
    stackable: true,
    fragile: false,
    compressionTolerancePct: 0,
    temperatureClass: "ambient",
  },
  {
    code: "CASE-FRAGILE",
    name: "Kırılgan koli",
    shape: "case",
    lengthM: 0.6,
    widthM: 0.4,
    heightM: 0.3,
    tareKg: 0.9,
    rotation: "fixed",
    // Kırılgan yük üstüne yük almaz; stackable=false ile birlikte iki ayrı
    // kural aynı sonucu verir ve doğrulayıcı ikisini de kontrol eder.
    maxTopLoadKg: 0,
    minSupportRatio: 0.9,
    stackable: false,
    fragile: true,
    compressionTolerancePct: 0,
    temperatureClass: "ambient",
  },
  {
    code: "PALLET-EUR",
    name: "Euro palet",
    shape: "pallet",
    lengthM: 1.2,
    widthM: 0.8,
    heightM: 0.144,
    tareKg: 25,
    rotation: "yaw",
    maxTopLoadKg: 1_000,
    minSupportRatio: 0.9,
    stackable: true,
    fragile: false,
    compressionTolerancePct: 0,
    temperatureClass: "ambient",
  },
  {
    code: "DRUM-200L",
    name: "200 L varil",
    shape: "drum",
    // Silindir kapsayan kutusuyla temsil edilir: çap × çap × yükseklik.
    lengthM: 0.585,
    widthM: 0.585,
    heightM: 0.88,
    tareKg: 18,
    // Varil yatırılamaz ve döndürmenin bir anlamı yoktur (dairesel kesit).
    rotation: "fixed",
    maxTopLoadKg: 250,
    minSupportRatio: 0.95,
    stackable: true,
    fragile: false,
    compressionTolerancePct: 0,
    temperatureClass: "ambient",
    segregationGroup: "chemical",
  },
  {
    code: "IRREGULAR",
    name: "Düzensiz rijit yük",
    shape: "irregular",
    lengthM: 1.0,
    widthM: 0.7,
    heightM: 0.65,
    tareKg: 12,
    rotation: "fixed",
    // Düzensiz yükün üst yüzeyi düz değildir; üstüne yük konmaz.
    maxTopLoadKg: 0,
    minSupportRatio: 0.85,
    stackable: false,
    fragile: false,
    compressionTolerancePct: 0,
    temperatureClass: "ambient",
  },
  {
    code: "SACK",
    name: "Çuval / balya",
    shape: "flexible",
    lengthM: 0.8,
    widthM: 0.5,
    heightM: 0.28,
    tareKg: 0.3,
    rotation: "yaw",
    maxTopLoadKg: 300,
    // Esnek zarf altındaki yüzeye oturur; destek oranı daha toleranslıdır.
    minSupportRatio: 0.6,
    stackable: true,
    fragile: false,
    // Zarf %8 sıkışabilir sayılır ama doğrulama sıkışmamış ölçüyle yapılır.
    compressionTolerancePct: 0.08,
    temperatureClass: "ambient",
  },
];

export function packageTypeByCode(
  types: readonly PackageType[] = DEFAULT_PACKAGE_TYPES,
): Map<string, PackageType> {
  return new Map(types.map((type) => [type.code, type]));
}

/* ------------------------------------------------------------------ */
/* Elleçleme birimi                                                    */
/* ------------------------------------------------------------------ */

/**
 * Taşınan tek bir fiziksel birim.
 *
 * Hiyerarşiktir: bir palet (SSCC) içinde koliler (SSCC) taşır. `parentCode`
 * bu ilişkiyi kurar; kök birimler araca yüklenendir.
 */
export type HandlingUnit = {
  code: string;
  /** GS1 SSCC — varsa. Kaynak sistem kimliği gibi asla üzerine yazılmaz. */
  sscc?: string;
  packageTypeCode: string;
  /** Üst elleçleme birimi (palet); kök birimlerde boş. */
  parentCode?: string;
  /** İçindeki ürün — karma birimlerde boş. */
  skuCode?: string;
  quantity: number;
  /** Brüt ağırlık (kg): dara + içerik. */
  grossWeightKg: number;
  /** Bu birimin hangi sevkiyat durağına gittiği. */
  stopCode?: string;
};

/** Yönelimden sonraki dış ölçü. */
export type Footprint = { lengthM: number; widthM: number; heightM: number };

/**
 * Paket türünün izin verdiği yönelimler.
 *
 * `yaw` iki yönelim verir (0° ve 90°); `any` altı eksen hizalı yönelimi.
 * Yönelim listesi deterministik sırayla döner — solver'ın aday üretimi
 * tekrar üretilebilir olmalı.
 */
export function allowedFootprints(type: PackageType): Footprint[] {
  const { lengthM: l, widthM: w, heightM: h } = type;

  if (type.rotation === "fixed") {
    return [{ lengthM: l, widthM: w, heightM: h }];
  }
  if (type.rotation === "yaw") {
    // Kare tabanlı yükte iki yönelim aynıdır; tekrar aday üretmenin anlamı yok.
    return l === w
      ? [{ lengthM: l, widthM: w, heightM: h }]
      : [
          { lengthM: l, widthM: w, heightM: h },
          { lengthM: w, widthM: l, heightM: h },
        ];
  }

  const all: Footprint[] = [
    { lengthM: l, widthM: w, heightM: h },
    { lengthM: w, widthM: l, heightM: h },
    { lengthM: l, widthM: h, heightM: w },
    { lengthM: h, widthM: l, heightM: w },
    { lengthM: w, widthM: h, heightM: l },
    { lengthM: h, widthM: w, heightM: l },
  ];

  // Aynı ölçüye çıkan yönelimler teklenir.
  const seen = new Set<string>();
  return all.filter((footprint) => {
    const key = `${footprint.lengthM}|${footprint.widthM}|${footprint.heightM}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
