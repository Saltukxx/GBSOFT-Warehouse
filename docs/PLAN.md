# Demodan ürüne: GBSoft Slotting & Picking Intelligence v1

> **Yaşayan belge.** Her faz bittiğinde durum tablosu ve sapmalar bölümü
> güncellenir. Son güncelleme: Faz 0 tamamlandı (08.08.2026).

## Neden

Elimizde çalışan bir sunum demosu vardı (~10.100 satır): 5 ekran, tasarım
sistemi, 2B depo haritası, karar rail'i, deterministik fixture verisi. Demo
şartnamesini karşılıyordu ama **veri üretimi arayüzün içindeydi**: 16 UI modülü
fixture dosyalarını doğrudan import ediyor, `planStore` iki plan sürümünü sabit
tutuyor, `WarehouseMap` geometriyi 12×2×4 sabit ızgaradan türetiyordu. Backend,
kimlik doğrulama, kalıcılık ve gerçek solver yoktu.

Amaç: demonun görsel ve ürün yatırımını koruyarak altına gerçek bir sistem
koymak.

## Kapsam kararları

| Karar | Seçim |
|---|---|
| Kapsam | PDF §23 paket **1-4 + 10**: Foundation, Twin, Dynamic Slotting, Picking, Governance |
| Backend | TypeScript API + **ayrı Python solver** (OR-Tools CP-SAT) |
| Veri | Henüz müşteri yok → kendi veri giriş ekranları + import şablonları + golden dataset |
| Dağıtım | Tek kiracı kurulum, ama şema/IAM baştan **tenant-scoped** |

**Kapsam dışı (v1):** palletization, 3B araç yükleme, kamera/LiDAR doğrulama,
Yard/Dock, Freight Audit, WMS konektörleri, çok kiracılı onboarding/faturalama.

**Müşteri olmamasının sonucu — kalıcı kısıt:** tasarruf yüzdesi doğrulanamaz.
Ürün hiçbir yerde ölçülmemiş kazanç iddia etmez; her sayı "tahmin", model sürümü
ve kalibrasyon durumuyla birlikte gösterilir. Kalibrasyon altyapısı v1'de
kurulur, kalibrasyonun kendisi ilk müşteriyle yapılır.

---

## Durum

| # | Paket | Çıkış koşulu | Durum |
|---|---|---|---|
| 0 | Monorepo, veritabanı, API iskeleti, `packages/domain`, layout ucu | `GET /facilities/:code/layout` gerçek DB'den 96 lokasyon döner, web onu çizer | **Tamam** |
| 1 | Import şablonları, layout editörü, veri giriş ekranları | Golden dataset import edilir, satır bazlı doğrulama raporu üretir | Sırada |
| 2 | Twin graph + mesafe matrisi + veri kalitesi motoru | Graph coverage %100; 96 lokasyonda mesafe matrisi <200 ms; kritik eksik yayını bloklar | Bekliyor |
| 3 | Pick-time modeli + event ingest | Model sürümü/parametreleri API'den okunur; kalibre değilse UI açıkça söyler | Bekliyor |
| 4 | CP-SAT slotting solver + async run servisi | 184 SKU / 96 lokasyonda <5 sn feasible; infeasible'da çakışan kısıtlar döner; OPTIMAL iddiası yok | Bekliyor |
| 5 | Move plan, kısmi yayın, ölçüm, rollback | Kısmi onay paket bütünlüğünü korur; publish idempotent; rollback lineage'ı bozmaz | Bekliyor |
| 6 | IAM/RBAC, RLS, audit, gözlemlenebilirlik | Yetkisiz publish reddedilir; tüm plan değişiklikleri audit'te | Bekliyor |

Her paket kendi başına gösterilebilir olmalı — demo satış aracı olarak çalışmaya
devam ederken ürün altında büyür.

### Faz 0'da ne yapıldı

- Monorepo: `apps/web`, `apps/api`, `packages/domain`, `packages/seed`
- PostgreSQL + Prisma: 24 tablo, hepsi `tenantId` taşıyor; ilk migration uygulandı
- Fastify API: correlation ID, tenant bağlamı, hata biçimi, `/health`, layout ucu
- `@gbsoft/seed`: fixture üreticileri golden dataset paketine taşındı
- Süre modeli (`estimateLocationPickTimeSec`) `@gbsoft/domain`'e taşındı
- Harita sabit ızgaradan kurtarıldı; `FacilityLayout` sözleşmesiyle çiziyor
- `MapSurface`: dijital ikiz için yükleme ve hata durumları

Doğrulandı: 96 lokasyon / 184 SKU / 38 wave / 2.840 order line veritabanından
geliyor, tarayıcıda harita bu yanıttan çiziliyor; 26 vitest + 4 Playwright
senaryosu geçiyor, konsol hatası yok.

### Gerçekleşen sapmalar

| Plan | Gerçekleşen | Neden |
|---|---|---|
| pnpm workspaces | **npm workspaces** | pnpm kurulu değildi; yeni araç dayatmamak için |
| PostgreSQL + **PostGIS** | Sade **postgres:16-alpine** | postgis imajının otomatik kurduğu 4 eklenti Prisma'nın shadow veritabanında olmadığı için her migration'da "drift" üretti. Bugün hiçbir geometry tipi kullanılmıyor; raflar dikdörtgen, rota/mesafe mekânsal değil graf problemi. Gerçekten gerekirse ayrı migration ile eklenir. |
| Port 5432 | Port **5434** | 5432 ve 5433 makinedeki diğer projelerin konteynerlerince kullanılıyor |
| Kök `seed/` klasörü | `packages/seed` workspace paketi | Hem veritabanı seed'i hem arayüzün demo modu aynı paketi kullanabilsin diye |
| `packages/contracts` (OpenAPI) | Ertelendi | Tipler `@gbsoft/domain` üzerinden zaten paylaşılıyor; OpenAPI dış entegrasyon gerektiğinde eklenecek |
| Prisma şeması Faz 1'de | Faz 0'da yapıldı | Layout ucunun çıkış koşulu şemayı zaten gerektiriyordu |

---

## Hedef mimari

```text
gbsoft-warehouse/
├── apps/
│   ├── web/                      React + TypeScript arayüz          [var]
│   └── api/                      Fastify + Prisma + PostgreSQL      [var]
├── services/
│   └── optimizer/                Python + FastAPI + OR-Tools CP-SAT [Faz 4]
├── packages/
│   ├── domain/                   paylaşılan tipler + saf fonksiyonlar [var]
│   └── seed/                     golden dataset üreticileri           [var]
└── docker-compose.yml            postgres                            [var]
```

`packages/domain` tek doğruluk kaynağıdır: `Location`, `SKU`, `SlotPlan`,
`SlotRecommendation`, `MoveTask`, `PickTimeBreakdown`, `FacilityLayout`,
`ReoptimizeRequest/Response` tipleri hem API sözleşmesi hem arayüz modelidir.
`slotScore()`, `calculatePickTime()` ve `estimateLocationPickTimeSec()` referans
uygulamalardır; solver bunlarla karşılaştırmalı test edilir.

`packages/seed` üç yeri birden besler: veritabanı seed'i, arayüzün demo modu ve
regresyon testleri. Demo ile ürün asla farklı sayı gösteremez.

---

## Veri modeli

Tüm tablolar `tenantId` taşır; Faz 6'da Row Level Security eklenir.
Kaynak: `apps/api/prisma/schema.prisma`.

**Mekân:** `Facility`, `LayoutVersion`, `Zone`, `Aisle`, `RackFace`, `Location`,
`FloorArea` — dijital ikiz sürümlenir; planlar hangi sürümde üretildiklerini
saklar. Cross-aisle de bir `FloorArea`'dır.
*(Faz 2'de eklenecek: `GraphNode`, `GraphEdge`.)*

**Ürün:** `Sku`, `SkuDimension` (ölçü kaynağı, ölçüm zamanı ve toleransıyla),
`SkuAffinity`, `VelocitySnapshot`, `SkuPlacement` (geçerlilik aralıklı; taşıma
uygulanınca yeni satır açılır, geçmiş silinmez).

**Talep/execution:** `Wave`, `PickTask`.

**Olay:** tek `Event` tablosu — PDF §17 zarfı birebir: `eventId, tenantId,
eventType, source, sourceId, entityType/entityId, eventTime, ingestTime,
facilityId/locationCode, actor/sensor, payloadSchemaVersion, payload,
confidence, evidenceUri, correlationId`. `eventTime ≠ ingestTime` zorunlu.

**Plan:** `SlotPlan` (lineage: `basePlanId`, `snapshotAt`, `modelVersion`,
`solverVersion`, `objectiveProfileId`), `SlotRecommendation`, `SlotAlternative`,
`MoveTask`, `MoveDependency`, `PlanLock`, `PlanExclusion`, `OptimizationRun`.

**Model:** `PickTimeModel` — sürüm, parametreler, `calibrated`, eğitim penceresi,
örnek sayısı.

**Yönetişim:** `ObjectiveProfile`, `DataQualityIssue`, `ImportBatch`,
`AuditLog`, `User`, `Tenant`.
*(Faz 1'de eklenecek: `IdentityMap`.)*

### Bilinçli kısıtlar

- `SlotRecommendation.sku` ilişkisi **Restrict**'tir: plana girmiş bir SKU
  sessizce silinemez. Seed bu yüzden çocuk tabloları sırayla temizler.
- `Event` üzerinde `(tenantId, source, sourceId, eventType)` benzersizdir: aynı
  kaynak olayı iki kez işlenemez.
- `MoveTask.idempotencyKey`: WMS'e tekrar gönderimi engeller.

---

## Servisler

### API (`apps/api`) — Fastify + Prisma

```
GET  /health                            [var]
GET  /api/facilities/:code/layout       FacilityLayout + locations   [var]
GET  /api/facilities/:code/overview     KPI, istisna kuyruğu, zone yükü, tamamlanma serisi
GET  /api/facilities/:code/picking-time bileşen dağılımı + beklenen/gerçekleşen + model kalitesi
GET  /api/slot-plans, /api/slot-plans/:id   sürümler ve lineage
POST /api/optimization-runs             async job → 202 + runId
GET  /api/optimization-runs/:id         status | feasible | infeasible + gap
POST /api/slot-plans/:id/locks | exclusions
POST /api/slot-plans/:id/publish        ayrı yetki, idempotency-key zorunlu
GET  /api/slot-plans/:id/move-tasks
GET  /api/data-quality
POST /api/imports/:kind                 CSV/Excel yükleme → doğrulama raporu
```

Kurallar (PDF §17): idempotency key; `sourceSystem`/`sourceId` asla üzerine
yazılmaz; bulk import'ta partial reject + hata raporu, hatalı kayıt sessizce
atılmaz; plan publish ayrı yetkili komuttur — solver sonucu kendiliğinden göreve
dönüşmez.

**Hangi uç canlı?** `apps/web/src/data/api.ts` içindeki `LIVE_ENDPOINTS` ve
`FIXTURE_ENDPOINTS` listeleri ürünün gerçekte ne kadarının canlı olduğunu tek
bakışta gösterir. Bir uç bağlandıkça listeden çıkarılır.

### Optimizer (`services/optimizer`) — Python + OR-Tools CP-SAT · Faz 4

SKU→lokasyon atama problemi.

**Hard constraints** (ihlal edilemez, ceza değil): göz hacmi/ağırlık kapasitesi,
ekipman sınıfı uyumu, zon/sıcaklık/tehlike ayrımı, bloklu göz, kilitli atama,
freeze zone, fixed-slot politikası, bir gözde tek SKU.

**Objective:** `α·pick süresi + β·replenishment + γ·congestion + δ·relocation +
ε·ergonomi cezası` — ağırlıklar `ObjectiveProfile` olarak versiyonlanır (dört
profil seed'de hazır: dengeli, picking öncelikli, düşük taşıma, yoğun dönem).

**Davranış:**
- Feasible-first: hızlı sezgiyle başlangıç çözümü, kalan bütçe iyileştirmeye
- Timeout'ta **OPTIMAL iddiası yok** — `FEASIBLE` + gap + çözüm kalitesi
- Infeasible'da CP-SAT assumption'larıyla çakışan kısıt kümesi ve gevşetme
  seçenekleri döner (demodaki infeasible ekranı gerçek veriyle beslenir)
- Warm start: önceki plan çözümü seed olarak verilir → plan oynaklığı düşer
- Determinizm: sabit seed, `OptimizationRun` kaydına yazılır

**Move plan üretimi** ayrı adımdır: boşaltma zincirlerini topolojik sıralar,
döngü tespit eder (boş göz yoksa geçici staging görevi ekler), koridor kapatma
penceresine göre paketler. Dört görev tipi (`VACATE/MOVE/VERIFY/OPEN`) ve paket
bütünlüğü kuralı korunur.

### Pick-time modeli · Faz 3

v1'de **parametreli analitik model**: `estimateLocationPickTimeSec()`.
Parametreler (sabit bileşenler, ortalama travel, congestion katsayısı, ergonomi
cezası, P90 çarpanı) tesis bazlı, versiyonlu ve API'den okunur; koda gömülmez.
Travel bileşeni tesis ortalamasına normalize edilir, böylece lokasyon
sürelerinin ortalaması tesis P50'siyle örtüşür.

Event pipeline **kurulur ama kalibrasyon iddia edilmez**: `TASK_STARTED` /
`TASK_COMPLETED` çiftlerinden süre etiketleri, feature üretimi ve quantile
regression eğitim işi yazılır; yeterli veri gelene kadar model
`calibrated: false` döner ve arayüz bunu açıkça gösterir.

---

## Web app refactoru

Tasarım sistemi, `WarehouseMap`, `DataTable`, karar rail'i, grafikler ve tüm
ekran kompozisyonu **korunur**. Değişen dört şey:

**1. Fixture bağımlılığını kes.** [Faz 0'da kısmen yapıldı]
Harita ve ısı katmanları artık API'den beslenir; `WarehouseMap` bir
`layout: FacilityLayout` prop'u alır, `layers.ts` skalayı yüklenen
lokasyonlardan hesaplar. Kalan sayfalar (`operations`, `picking-time`,
`move-plan`, `data-quality`) ve `planStore` ilgili uç canlıya bağlandıkça
geçecek.

**2. Sunucu state'i.** [Faz 5] `src/lib/useAsync.ts` yerine TanStack Query:
önbellek, dedupe, `OptimizationRun` için polling, optimistic lock/exclusion.
`planStore` yalnız **UI kararlarını** taşır (seçim, görünüm modu, kaydedilmemiş
kilitler) — plan sürümü sunucudan gelir.

**3. Kimlik ve tenant.** [Faz 6] Giriş, oturum, rol bazlı yetki (PDF §2 karar
hakları: publish ve rollback yalnız yetkili rolde), üst barda gerçek
kullanıcı/tesis.

**4. Demo modu korunur.** [Faz 0'da yapıldı] `VITE_DEMO_MODE=1` ile demo
adaptörü devrededir; satış demosu backend olmadan çalışmaya devam eder.

Ek: route bazlı code splitting, error boundary, `tr` varsayılan i18n katmanı.

---

## Veri girişi (müşteri yok senaryosu) · Faz 1

Konektör yerine kendi giriş yüzeyimiz:

- **Import şablonları** (CSV/Excel): tesis geometrisi, lokasyon kapasitesi, SKU
  master + ölçü/ağırlık, sipariş satırı geçmişi, görev olayları. Yükleme →
  satır bazlı doğrulama raporu → partial reject; hatalı kayıt sessizce atılmaz.
- **2B layout editörü** (basit sürüm): zone/koridor/raf yüzü/göz tanımlama,
  cross-aisle ve dock konumu. Mevcut `WarehouseMap` düzenleme moduyla genişler.
- **Golden dataset:** `packages/seed` — testlerin, demo modunun ve solver
  regresyonunun ortak temeli. [hazır]
- **Veri kalitesi kapısı:** `DataQualityIssue.blocksPublish`; kritik eksik (ölçü
  verisi yok) plan yayınını bloklar. Demodaki davranış gerçek kurala bağlanır.

---

## Yönetişim ve güven katmanı

- **Reproducibility:** her `OptimizationRun` input snapshot, kısıt profili,
  ağırlıklar, solver/model sürümü, seed, limit, status, skor ve infeasibility
  nedenini saklar
- **Lineage:** plan sürümü hangi twin sürümü ve hangi veri snapshot'ıyla
  üretildi; rollback plan sürümünü geri alır, yayınlanmış görevleri ayrı iptal
  akışı ele alır
- **RBAC + audit:** publish, kural değişikliği ve rollback için görev ayrılığı;
  tüm plan değişiklikleri `AuditLog`'a
- **KVKK:** çalışan kimliği taşıyan görev olayları için amaç sınırlaması,
  maskeleme, saklama süresi; performans sıralaması varsayılan özellik değil
- **Gözlemlenebilirlik:** correlation ID, solver süresi/gap/feasibility
  metrikleri, input drift

---

## Doğrulama

**Faz 0-2**

```bash
npm install && cp .env.example .env && npm run build
npm run db:up && npm run db:migrate && npm run db:seed
```

- `curl -s localhost:3001/api/facilities/MARMARA-DC-01/layout | jq '.locations | length'` → 96
- Web'i aç, harita veritabanı verisiyle çizilsin
- `.env` içinde `VITE_DEMO_MODE=1` ile fixture modu da çalışsın

**Faz 3-4**

- `npm test --workspace @gbsoft/domain` — `calculatePickTime` / `slotScore` /
  `estimateLocationPickTimeSec` referans testleri
- `pytest services/optimizer` — hard constraint ihlali üretmeyen çözüm; aynı seed
  aynı sonuç; kilitli atama korunur; freeze zone dokunulmaz; move budget aşılmaz
- Solver regresyonu golden dataset üzerinde: her koşuda `netOperationDeltaPct`,
  `moveTaskCount`, `hardViolationCount` snapshot'a karşı karşılaştırılır

**Faz 5-6**

- `apps/web/e2e/golden-path.spec.ts` gerçek backend'e karşı: giriş → plan seç →
  kilitle → yeniden optimize → kısmi yayın → rollback
- `apps/web/src/tests/demo-data.test.ts` seed veri tutarlılık testine dönüşür
  (26 görev, Zone A 11 görev · 2 paket gibi sabitler artık solver çıktısından
  doğrulanır, elle yazılmaz)
- Yetki testi: publish yetkisi olmayan rol 403 alır ve audit'e yazılır

---

## Açık kararlar

1. ~~`git init`~~ — yapıldı; baseline demo `main`'de, ürün çalışması
   `feat/product-v1-foundation` dalında.
2. **Hosting/altyapı** seçilmedi (kendi sunucu / bulut sağlayıcı). Faz 6'dan
   önce gerekli.
3. **Kimlik sağlayıcı**: kendi kullanıcı tablomuz mu, kurumsal SSO mu?
   `User` tablosu hazır ama kimlik doğrulama akışı yazılmadı.
4. İlk pilot müşteri profili netleşene kadar **konektör yazılmayacak**; import
   şablonları bu boşluğu doldurur.
5. **Türkçe sıralama**: veritabanı `C.UTF-8` yerelleştirmesiyle kuruldu (imajda
   `tr_TR` yok). Sıralama uygulama katmanında `localeCompare("tr")` ile yapılıyor.
   Veritabanı seviyesinde Türkçe collation gerekirse ICU collation eklenmeli.
