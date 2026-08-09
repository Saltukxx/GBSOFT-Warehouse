# GBSoft Slotting & Picking Intelligence

WMS üstü çalışan karar ve kanıt katmanı. Bu depo, sunum demosundan gerçek ürüne
geçişi barındırır.

**Kapsam (v1):** Foundation, dijital ikiz (2B + **3B**), dynamic slotting,
picking analitiği, **yükleme siparişi ve toplama turu optimizasyonu**, yönetişim.
Palletization ve rota-duyarlı araç yükleme Faz 7-8'de; kamera/LiDAR doğrulama,
Yard/Dock ve Freight Audit sonraki sürümlerdedir.

> Veriler kurgusal bir tesise (Marmara Dağıtım Merkezi) aittir. Gerçek müşteri
> verisi bağlanana kadar plan KPI'ları **tahmin**dir; ölçülmüş kazanç değildir.

## Hızlı başlangıç

```bash
npm install && cp .env.example .env && npm run build
```

```bash
npm run db:up && npm run db:migrate && npm run db:seed
```

Önce Python optimizer'ı kurun (veya aşağıdaki Docker seçeneğini kullanın):

```bash
python3 -m venv services/optimizer/.venv
services/optimizer/.venv/bin/pip install -e 'services/optimizer[dev]'
```

Üç terminalde:

```bash
npm run dev:optimizer
```

```bash
npm run dev:api
```

```bash
npm run dev
```

Arayüz `http://localhost:5173`, API `http://127.0.0.1:3001`.
Optimizer `http://127.0.0.1:8001`. PostgreSQL ve optimizer'ı Docker ile
birlikte açmak için yerel Python kurulumu yerine `npm run services:up`
kullanılabilir.

Backend olmadan yalnız satış demosu için `.env` içinde `VITE_DEMO_MODE=1`
yapmanız yeterlidir.

## Yapı

```text
apps/
├── web/          React + TypeScript arayüz (5 ekran, depo haritası, karar rail'i)
└── api/          Fastify + Prisma + PostgreSQL
packages/
├── domain/       @gbsoft/domain — paylaşılan tipler ve referans hesaplamalar
└── seed/         @gbsoft/seed — golden dataset üreticileri
services/
└── optimizer/    FastAPI + OR-Tools CP-SAT slotting servisi
```

`packages/domain` tek doğruluk kaynağıdır: süre modeli (`estimateLocationPickTimeSec`),
slot skoru (`slotScore`), yürüyüş grafı/mesafe matrisi (`buildTwinGraph`,
`distanceMatrix`), pick-time quantile kalibrasyonu (`calibratePickTimeModel`),
içe aktarma şablonları ve CSV doğrulama motoru
(`validateImportCsv`) ve bütün alan tipleri web, API ve solver tarafından
ortak kullanılır. Doğrulama motorunun aynısı tarayıcıda da çalıştığı için
demo modu backend olmadan gerçek doğrulama yapabiliyor.

`packages/seed` üç yeri birden besler: veritabanı seed'i, arayüzün demo modu ve
regresyon testleri. Böylece demo ile ürün asla farklı sayı göstermez.

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | Web geliştirme sunucusu |
| `npm run dev:api` | API geliştirme sunucusu |
| `npm run dev:optimizer` | Yerel Python optimizasyon servisi |
| `npm run build` | Tüm workspace'leri derler (strict TypeScript) |
| `npm test` | Birim ve veri tutarlılık testleri |
| `npm run test:optimizer` | Solver hard constraint ve altın veri testleri |
| `npm run test:e2e` | Playwright ana demo akışı |
| `npm run db:up` / `db:down` | Veritabanı konteyneri |
| `npm run services:up` | Veritabanı + optimizer konteynerleri |
| `npm run db:migrate` | Prisma migration |
| `npm run db:seed` | Golden dataset (idempotent) |
| `npm run db:psql` | Konteyner içinden psql |
| `npm run export:csv --workspace @gbsoft/api` | Golden dataset'i import şablonu biçiminde CSV'ye yazar |

Host'ta `psql` veya PostgreSQL kurulu olması gerekmez. Veritabanı **5434**
portunu kullanır; 5432/5433 başka projeler tarafından kullanıldığı için seçildi.

## Faz durumu

| Faz | Kapsam | Durum |
|---|---|---|
| 0 | Monorepo, veritabanı, API iskeleti, layout ucu | **Tamam** |
| 1 | Import şablonları, veri giriş ekranı, kimlik eşlemesi | **Tamam** |
| 1b | 2B layout editörü | **Tamam** |
| 2 | Twin graph, mesafe matrisi, veri kalitesi motoru | **Tamam** |
| 3 | Pick-time modeli, event ingest, kalibrasyon | **Tamam** |
| 4 | CP-SAT slotting solver (Python + OR-Tools) | **Tamam** |
| 5 | Move plan, kısmi yayın, ölçüm, rollback | **Tamam** |
| 6 | 3B dijital ikiz, raf sistemi, rota replay | **Tamam** |
| 6.5 | Yükleme siparişi, toplama turu optimizasyonu (CVRP) | **Tamam** |
| 7 | Outbound modeli ve palletization | Bekliyor |
| 8 | Rota-duyarlı truck loading ve execution | Bekliyor |
| 9 | IAM/RBAC, RLS, audit, gözlemlenebilirlik | Bekliyor |

### Hangi uç canlı?

`apps/web/src/data/api.ts` içindeki `LIVE_ENDPOINTS` ve `FIXTURE_ENDPOINTS`
listeleri, ürünün gerçekte ne kadarının canlı olduğunu tek bakışta gösterir.
Şu an **layout**, **3B sahne**, **rota**, **yükleme siparişleri**, **toplama
turları**, **veri aktarımı**, **veri kalitesi**, **pick-time/model**, **asenkron
yeniden optimizasyon**, **slot planları**, **move-task yayını** ve **rollback**
uçları veritabanıyla konuşur; yalnız operasyon özeti golden dataset'ten gelir.
Aktif ikizin kalıcı grafı ve 96×96 mesafe matrisi de API'den okunabilir:

```bash
curl -s localhost:3001/api/facilities/MARMARA-DC-01/graph
curl -s localhost:3001/api/facilities/MARMARA-DC-01/distance-matrix
curl -s localhost:3001/api/facilities/MARMARA-DC-01/pick-time-model
curl -s localhost:3001/api/facilities/MARMARA-DC-01/picking-time
curl -s localhost:3001/api/facilities/MARMARA-DC-01/scene-3d
curl -s "localhost:3001/api/facilities/MARMARA-DC-01/routes?stops=DOCK,A-01-01,B-03-02,DOCK"
```

### 3B dijital ikiz

`/twin/3d` aktif ikizin üç boyutlu görünümüdür. Geometri `scene-3d` ucundan
gelir ve **kanonik birim metredir**; ayak izi 2B haritayla birebir aynıdır.
Raf sistemi dikme, traverse ve kademe hücreleriyle çizilir: golden dataset'te
24 raf yüzü, 288 hücre (96 pick yüzü + 192 reserve).

Ölçülmüş raf kotu olmayan tesiste düşey eksen varsayılan profilden **türetilir**
ve yanıt `geometrySource: "derived"` der; arayüz bunu üstte açıkça yazar.
Ölçülmüş kot için layout şablonundaki `levelElevationM`, `levelClearHeightM` ve
`depthM` kolonları doldurulur.

WebGL yoksa ekran boş kalmaz; aynı katmanlarla mevcut 2B harita çizilir.

### Yükleme siparişi ve toplama turu

`/operations/pick-orders` bir yükleme siparişini en hızlı toplayacak tur
sırasını üretir. Solver OR-Tools Routing ile kapasiteli araç rotalama çözer;
hedef **makespan**tir — toplayıcılar paralel çalıştığı için sipariş en geç biten
tur bitince hazırdır.

```bash
curl -s -X POST localhost:3001/api/pick-orders -H 'content-type: application/json' \
  -d '{"facility":"MARMARA-DC-01","code":"PO-001","dockCode":"DOCK-1","lines":[{"skuCode":"SKU-001","quantity":2}]}'
```

```bash
curl -s -X POST localhost:3001/api/pick-orders/PO-001/optimize -H 'content-type: application/json' \
  -d '{"equipment":"cart","vehicleCount":3,"objective":"makespan"}'
```

Süre modeli ikinci bir model değildir: satır başına sabit bileşenler kalibre
`PickTimeModel`'den aynen alınır, duraklar arası travel Faz 2'nin graf
mesafesinden gelir. Routing kanıtlanmış optimum vermez — yanıt hiçbir koşulda
`optimal` demez, `feasible` ve bir **alt sınır** raporlar.

Slotting Studio'daki yeniden optimizasyon canlıdır: `POST /api/optimization-runs`
202 + `runId` döner; arayüz `GET /api/optimization-runs/:id` ile sonucu izler.
Her koşu giriş/sonuç snapshot'ı, seed, solver/model sürümü, gap ve çözüm
kalitesiyle PostgreSQL'de saklanır.

Move Plan sunucudaki gerçek solver görevlerini gösterir. Yayın çağrısı
`idempotency-key` ister, bağımlılık paketini sunucuda da böldürmez ve audit
kaydı üretir. `GET /api/slot-plans/:id/measurement`, yayın öncesi/sonrası en
az 50'şer gerçek görev olmadan ölçülmüş kazanç döndürmez.

Kalibrasyon açık bir komuttur. En az 200 uygun `TASK_STARTED` /
`TASK_COMPLETED` çifti yoksa yeni model sürümü üretmez:

```bash
curl -s -X POST localhost:3001/api/facilities/MARMARA-DC-01/pick-time-model/calibrate
```

## Veri girişi

Müşteri konektörü yerine kendi giriş yüzeyimiz var: arayüzde
**Sistem → Veri aktarımı** (dosya yükleme) ve **Sistem → Layout editörü**
(geometriyi parametrik tanımlama), ya da doğrudan API.

Layout editörü ayrı bir yazma yolu açmaz: ürettiği geometri, elle
doldurulmuş bir dosyayla birebir aynı CSV satırlarına çevrilip aynı
doğrulamadan geçer. Böylece iki giriş yolu arasında davranış farkı olamaz.

Altı şablon: `layout` (geometri + göz kapasitesi), `floor-area`, `sku`
(master + ölçü/ağırlık), `velocity`, `wave`, `pick-task`. Şablon tanımı
`packages/domain/src/imports.ts` içinde tek yerdedir; API doğrulamayı,
arayüz hem kolon dokümanını hem indirilebilir dosyayı aynı tanımdan üretir.

```bash
curl -sO localhost:3001/api/imports/templates/sku.csv
```

Dosyayı doldurduktan sonra önce **doğrulayın** — yükleme varsayılan olarak
kuru koşudur ve hiçbir şey yazmaz:

```bash
curl -s -X POST "localhost:3001/api/imports/sku?facility=MARMARA-DC-01" -H 'content-type: text/csv' --data-binary @sku.csv
```

Yazmak ayrı ve açık bir komuttur: aynı isteğe `&dryRun=0` ekleyin.

Kurallar:

- **Hatalı kayıt sessizce atılmaz.** Reddedilen her satır numarası, kolonu ve
  nedeniyle raporlanır; rapor `ImportBatch` içinde saklanır ve sonradan okunur.
- **Kısmi ret başarıdır** (HTTP 200): geçerli satırlar yazılır. Geometri
  istisnadır — tek hata dosyanın tamamını reddeder (HTTP 422), çünkü yarım
  yazılmış bir dijital ikiz hiç yazılmamışından kötüdür.
- **Türkçe Excel** olduğu gibi kabul edilir: noktalı virgül ayraç, ondalık
  virgül, `GG.AA.YYYY` tarih ve BOM.
- Golden dataset'i dolu örnek dosya olarak almak için:
  `npm run export:csv --workspace @gbsoft/api -- ./seed-csv`

## Kararlar

- **Kiracı:** kurulum tek kiracıdır, ancak her tablo `tenantId` taşır. Çok
  kiracılıya geçiş migration gerektirmez; Faz 9'da RLS eklenir.
- **Kimlik:** kaynak sistem kimliği (`sourceSystem` + `sourceId`) asla üzerine
  yazılmaz; kanonik kod ayrı alandır.
- **Zaman:** `eventTime` ile `ingestTime` ayrıdır. Geç gelen olay doğru
  operasyon zamanına yazılır, tahmin anındaki snapshot korunur.
- **Solver dürüstlüğü:** zaman sınırına takılan çözüm için OPTIMAL iddia
  edilmez; `FEASIBLE` + gap raporlanır.
- **PostGIS:** raf ayak izleri dikdörtgen olduğu için bugün gerekmiyor. Rota ve
  mesafe hesabı mekânsal değil graf problemidir; düzensiz geometri veya
  çakışma doğrulaması gerektiğinde ayrı migration ile eklenir.

## Belgeler

- [docs/PLAN.md](docs/PLAN.md) — **ürünleştirme planı** (yaşayan belge: faz
  durumu, mimari, veri modeli, sapmalar, açık kararlar)
- `GBSoft_Warehouse_to_Truck_Optimization_Engine_Proje_Tasarimi.pdf` — ürün ve
  mimari tasarımı
- `GBSoft_Picking_Time_Slot_Optimization_Demo_Spec.md` — demo şartnamesi
- [apps/web/README.md](apps/web/README.md) — arayüz ayrıntıları ve sunum akışı
