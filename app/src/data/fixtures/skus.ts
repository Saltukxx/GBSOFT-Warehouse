import type { SKU, VelocityClass } from "../../domain/warehouse";
import { LOCATIONS } from "./layout";
import { makeRng, seededRange, seededShuffle } from "../rng";

/**
 * 184 SKU. 96'sı aktif pick lokasyonuna yerleşiktir; kalanı rezerv/bulk
 * alanda tutulur ve pick face'i yoktur.
 */

export const RESERVE_LOCATION = "REZERV";

/** Demo senaryosunun adı geçen SKU'ları — §13.2. Değerleri sabittir. */
const NAMED: Array<{
  id: string;
  name: string;
  category: string;
  velocityClass: VelocityClass;
  picksPerDay: number;
  locationId: string;
  handling: SKU["handling"];
  affinity: string[];
}> = [
  {
    id: "SKU-184",
    name: "Organik Yulaf 500 g",
    category: "Kahvaltılık",
    velocityClass: "A",
    picksPerDay: 146,
    locationId: "B-11-04",
    handling: "standard",
    affinity: ["SKU-019", "SKU-221"],
  },
  {
    id: "SKU-074",
    name: "Badem Sütü 1 L",
    category: "İçecek",
    velocityClass: "B",
    picksPerDay: 61,
    locationId: "A-03-02",
    handling: "fragile",
    affinity: ["SKU-165"],
  },
  {
    id: "SKU-221",
    name: "Protein Bar Kakao",
    category: "Atıştırmalık",
    velocityClass: "A",
    picksPerDay: 132,
    locationId: "C-08-03",
    handling: "standard",
    affinity: ["SKU-184", "SKU-019"],
  },
  {
    id: "SKU-019",
    name: "Filtre Kahve 250 g",
    category: "Kahvaltılık",
    velocityClass: "A",
    picksPerDay: 118,
    locationId: "B-09-01",
    handling: "standard",
    affinity: ["SKU-184", "SKU-221"],
  },
  {
    id: "SKU-307",
    name: "Çamaşır Tableti 40'lı",
    category: "Temizlik",
    velocityClass: "B",
    picksPerDay: 54,
    locationId: "A-04-02",
    handling: "heavy",
    affinity: ["SKU-142"],
  },
  {
    id: "SKU-142",
    name: "Kağıt Havlu 12'li",
    category: "Kağıt ürünleri",
    velocityClass: "A",
    picksPerDay: 103,
    locationId: "D-12-01",
    handling: "standard",
    affinity: ["SKU-307"],
  },
  {
    id: "SKU-058",
    name: "Zeytinyağı 1 L",
    category: "Temel gıda",
    velocityClass: "B",
    picksPerDay: 58,
    locationId: "A-05-01",
    handling: "fragile",
    affinity: ["SKU-233"],
  },
  {
    id: "SKU-233",
    name: "Burgu Makarna 500 g",
    category: "Temel gıda",
    velocityClass: "A",
    picksPerDay: 111,
    locationId: "B-06-02",
    handling: "standard",
    affinity: ["SKU-058", "SKU-165"],
  },
  {
    id: "SKU-165",
    name: "Siyah Çay 1 kg",
    category: "İçecek",
    velocityClass: "A",
    picksPerDay: 127,
    locationId: "C-06-01",
    handling: "standard",
    affinity: ["SKU-074", "SKU-233"],
  },
];

/** Ürün adı havuzu — 184 kaydı gerçekçi tutmak için. */
const NAME_POOL: Array<[string, string]> = [
  ["Ayçiçek Yağı 5 L", "Temel gıda"],
  ["Pirinç Baldo 1 kg", "Temel gıda"],
  ["Kuru Fasulye 1 kg", "Temel gıda"],
  ["Toz Şeker 2 kg", "Temel gıda"],
  ["Un 2 kg", "Temel gıda"],
  ["Salça 700 g", "Temel gıda"],
  ["Nohut 1 kg", "Temel gıda"],
  ["Mercimek 1 kg", "Temel gıda"],
  ["Bulgur 1 kg", "Temel gıda"],
  ["Sıvı Sabun 1,5 L", "Temizlik"],
  ["Bulaşık Deterjanı 750 ml", "Temizlik"],
  ["Yumuşatıcı 1,4 L", "Temizlik"],
  ["Yüzey Temizleyici 1 L", "Temizlik"],
  ["Çamaşır Suyu 1 L", "Temizlik"],
  ["Tuvalet Kağıdı 16'lı", "Kağıt ürünleri"],
  ["Peçete 100'lü", "Kağıt ürünleri"],
  ["Islak Mendil 3'lü", "Kağıt ürünleri"],
  ["Bebek Bezi 4 No", "Bebek"],
  ["Bebek Şampuanı 500 ml", "Bebek"],
  ["Devam Sütü 800 g", "Bebek"],
  ["Maden Suyu 6'lı", "İçecek"],
  ["Portakal Suyu 1 L", "İçecek"],
  ["Soğuk Çay 1 L", "İçecek"],
  ["Kola 2,5 L", "İçecek"],
  ["Türk Kahvesi 100 g", "İçecek"],
  ["Bitki Çayı 20'li", "İçecek"],
  ["Bisküvi Sade 800 g", "Atıştırmalık"],
  ["Kraker Tuzlu 200 g", "Atıştırmalık"],
  ["Çikolata Gofret 5'li", "Atıştırmalık"],
  ["Cips Klasik 150 g", "Atıştırmalık"],
  ["Kuruyemiş Karışık 300 g", "Atıştırmalık"],
  ["Bal Süzme 850 g", "Kahvaltılık"],
  ["Reçel Vişne 380 g", "Kahvaltılık"],
  ["Kakaolu Krema 400 g", "Kahvaltılık"],
  ["Mısır Gevreği 450 g", "Kahvaltılık"],
  ["Tahin 350 g", "Kahvaltılık"],
  ["Zeytin Siyah 800 g", "Kahvaltılık"],
  ["Diş Macunu 100 ml", "Kişisel bakım"],
  ["Şampuan 600 ml", "Kişisel bakım"],
  ["Duş Jeli 500 ml", "Kişisel bakım"],
  ["Tıraş Köpüğü 200 ml", "Kişisel bakım"],
  ["Deodorant 150 ml", "Kişisel bakım"],
  ["Kedi Maması 1,5 kg", "Evcil hayvan"],
  ["Köpek Maması 3 kg", "Evcil hayvan"],
  ["Kedi Kumu 10 L", "Evcil hayvan"],
  ["Çöp Poşeti 30'lu", "Ev gereçleri"],
  ["Streç Film 30 m", "Ev gereçleri"],
  ["Alüminyum Folyo 10 m", "Ev gereçleri"],
  ["Pil AA 4'lü", "Ev gereçleri"],
  ["Ampul LED 9 W", "Ev gereçleri"],
];

/** SKU kimlikleri — deterministik seçilmiş 184 numara. */
function buildSkuIds(): string[] {
  const pool = Array.from({ length: 400 }, (_, i) => i + 1);
  const shuffled = seededShuffle(pool, "sku-ids");
  const named = NAMED.map((n) => Number(n.id.slice(4)));
  const picked = new Set<number>(named);
  for (const n of shuffled) {
    if (picked.size >= 184) break;
    picked.add(n);
  }
  return Array.from(picked)
    .sort((a, b) => a - b)
    .map((n) => `SKU-${String(n).padStart(3, "0")}`);
}

/**
 * Boş pick gözleri. Slot planı bu gözleri hedef olarak kullanabildiği için
 * her öneri zincirinin bir boşaltma görevi gerektirmesi gerekmez.
 */
export const EMPTY_PICK_LOCATIONS = new Set([
  "A-01-02",
  "A-01-04",
  "A-02-01",
  "A-02-04",
  "B-02-01",
  "B-03-01",
  "B-04-03",
  "B-05-04",
  "C-07-03",
  "C-08-01",
  "C-09-02",
  "C-09-04",
  "C-12-02",
  "D-10-01",
  "D-10-03",
  "D-11-03",
]);

/** Fiziksel ölçüsü eksik olan 6 SKU — write-back'i bloklar (§10.3). */
export const MISSING_DIMENSION_SKUS = [
  "SKU-031",
  "SKU-096",
  "SKU-158",
  "SKU-263",
  "SKU-288",
  "SKU-341",
];

function buildSkus(): SKU[] {
  const ids = buildSkuIds();
  const namedById = new Map(NAMED.map((n) => [n.id, n]));
  const missing = new Set(MISSING_DIMENSION_SKUS);

  // Adı geçmeyen SKU'lar için hız sınıfı ve pick hacmi deterministik türetilir.
  const drafts = ids.map((id) => {
    const named = namedById.get(id);
    if (named) {
      return {
        id,
        name: named.name,
        category: named.category,
        velocityClass: named.velocityClass,
        picksPerDay: named.picksPerDay,
        fixedLocation: named.locationId,
        handling: named.handling,
        affinity: named.affinity,
      };
    }
    const rng = makeRng(`sku:${id}`);
    const r = rng();
    const velocityClass: VelocityClass = r > 0.82 ? "A" : r > 0.45 ? "B" : "C";
    const picksPerDay =
      velocityClass === "A"
        ? seededRange(`picks:${id}`, 74, 138, 0)
        : velocityClass === "B"
          ? seededRange(`picks:${id}`, 26, 72, 0)
          : seededRange(`picks:${id}`, 2, 25, 0);
    const poolIndex = Number(id.slice(4)) % NAME_POOL.length;
    const [name, category] = NAME_POOL[poolIndex];
    return {
      id,
      name,
      category,
      velocityClass,
      picksPerDay,
      fixedLocation: null as string | null,
      handling: "standard" as SKU["handling"],
      affinity: [] as string[],
    };
  });

  // Yerleşim: adı geçen SKU'lar sabit lokasyonda; kalan lokasyonlar hız
  // sırasına göre en yüksek pick hacimli SKU'lara verilir.
  const takenLocations = new Set(
    drafts.map((d) => d.fixedLocation).filter((v): v is string => Boolean(v)),
  );
  const freeLocations = LOCATIONS.filter(
    (l) =>
      !takenLocations.has(l.id) &&
      !l.blocked &&
      !EMPTY_PICK_LOCATIONS.has(l.id),
  )
    .slice()
    .sort((a, b) => a.distanceToDockM - b.distanceToDockM);

  const unplaced = drafts
    .filter((d) => !d.fixedLocation)
    .sort((a, b) => b.picksPerDay - a.picksPerDay);

  const assignment = new Map<string, string>();
  unplaced.forEach((draft, index) => {
    const location = freeLocations[index];
    assignment.set(draft.id, location ? location.id : RESERVE_LOCATION);
  });

  return drafts.map((draft) => {
    const hasDims = !missing.has(draft.id);
    return {
      id: draft.id,
      name: draft.name,
      category: draft.category,
      widthCm: hasDims ? seededRange(`w:${draft.id}`, 8, 42, 1) : null,
      depthCm: hasDims ? seededRange(`d:${draft.id}`, 8, 38, 1) : null,
      heightCm: hasDims ? seededRange(`h:${draft.id}`, 6, 34, 1) : null,
      weightKg: hasDims ? seededRange(`kg:${draft.id}`, 0.2, 12, 2) : null,
      velocityClass: draft.velocityClass,
      picksPerDay: draft.picksPerDay,
      unitsPerPick: seededRange(`u:${draft.id}`, 1, 6, 0),
      replenishmentsPerDay:
        Math.round(seededRange(`r:${draft.id}`, 0.3, 3.4, 1) * 10) / 10,
      currentLocationId:
        draft.fixedLocation ?? assignment.get(draft.id) ?? RESERVE_LOCATION,
      affinitySkuIds: draft.affinity,
      handling: draft.handling,
    } satisfies SKU;
  });
}

export const SKUS: SKU[] = buildSkus();

export const SKU_BY_ID = new Map(SKUS.map((s) => [s.id, s]));

export function getSku(id: string): SKU | undefined {
  return SKU_BY_ID.get(id);
}

/** Lokasyonda hâlihazırda duran SKU. */
export const SKU_BY_LOCATION = new Map(
  SKUS.filter((s) => s.currentLocationId !== RESERVE_LOCATION).map((s) => [
    s.currentLocationId,
    s,
  ]),
);
