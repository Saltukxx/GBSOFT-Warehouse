# Demodan ürüne: GBSoft Slotting & Picking Intelligence v1

> **Yaşayan belge.** Her faz bittiğinde durum tablosu ve sapmalar bölümü
> güncellenir. Son güncelleme: Faz 8.4 tamamlandı — shadow publish,
> barkod/SSCC sıra teyidi, eksik/hasarlı yük sapması, sabit yüklü replan ve
> mobil/yazdırılabilir yükleme talimatı (10.08.2026).

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

**Kapsam dışı (v1):** kamera/LiDAR doğrulama, Yard/Dock, Freight Audit, WMS
konektörleri, çok kiracılı onboarding/faturalama. Palletization ve rota-duyarlı
araç yükleme kapsama alındı ve Faz 7-8'e planlandı
(`docs/WAREHOUSE_3D_TRUCK_LOADING_PLAN.md`).

**Müşteri olmamasının sonucu — kalıcı kısıt:** tasarruf yüzdesi doğrulanamaz.
Ürün hiçbir yerde ölçülmemiş kazanç iddia etmez; her sayı "tahmin", model sürümü
ve kalibrasyon durumuyla birlikte gösterilir. Kalibrasyon altyapısı v1'de
kurulur, kalibrasyonun kendisi ilk müşteriyle yapılır.

---

## Durum

| # | Paket | Çıkış koşulu | Durum |
|---|---|---|---|
| 0 | Monorepo, veritabanı, API iskeleti, `packages/domain`, layout ucu | `GET /facilities/:code/layout` gerçek DB'den 96 lokasyon döner, web onu çizer | **Tamam** |
| 1 | Import şablonları, veri giriş ekranı, kimlik eşlemesi | Golden dataset import edilir, satır bazlı doğrulama raporu üretir | **Tamam** |
| 1b | 2B layout editörü | Yeni tesis geometrisi arayüzden tanımlanır ve kaydedilir | **Tamam** |
| 2 | Twin graph + mesafe matrisi + veri kalitesi motoru | Graph coverage %100; 96 lokasyonda mesafe matrisi <200 ms; kritik eksik yayını bloklar | **Tamam** |
| 3 | Pick-time modeli + event ingest | Model sürümü/parametreleri API'den okunur; kalibre değilse UI açıkça söyler | **Tamam** |
| 4 | CP-SAT slotting solver + async run servisi | 184 SKU / 96 lokasyonda <5 sn feasible; infeasible'da çakışan kısıtlar döner; OPTIMAL iddiası yok | **Tamam** |
| 5 | Move plan, kısmi yayın, ölçüm, rollback | Kısmi onay paket bütünlüğünü korur; publish idempotent; rollback lineage'ı bozmaz | **Tamam** |
| 6 | 3B dijital ikiz, raf sistemi, rota replay | `scene-3d` 96 gözü metre biriminde döner; ölçülmemiş kot `derived` diye bildirilir; WebGL yoksa 2B'ye düşer | **Tamam** |
| 6.5 | Yükleme siparişi ve toplama turu optimizasyonu | Sipariş kapasiteye göre turlara bölünür; makespan alt sınırla birlikte raporlanır; optimum iddia edilmez | **Tamam** |
| 7.1 | Paket profilleri ve bağımsız doğrulayıcı | Geometri/fizik kuralları çözücüden bağımsız ikinci kez doğrulanır | **Tamam** |
| 7.2 | Outbound modeli ve palet API'si | `Shipment`, `HandlingUnit`, `PalletPlan`; doğrulama kapılı extreme-point packing | **Tamam** |
| 7.3 | 3B palet görüntüleyici ve editör | Move/rotate/lock kalıcıdır; kilitli destek zinciri warm-start çözmede korunur | **Tamam** |
| 8.1 | Araç şablonları ve bağımsız load doğrulayıcı | Sınır, kapı, engel, katar/dingil zinciri, CoG ve stop erişimi tekrar hesaplanır | **Tamam** |
| 8.2 | Rota-duyarlı truck-load solver ve API | Sabit rotada ilk durak kapıya, son durak derine gider; plan/run kalıcıdır | **Tamam** |
| 8.3 | 3B Load Studio ve editör | Stop rengi, aks/CoG, replay, move/rotate/lock ve warm-start | **Tamam** |
| 8.4 | Execution ve shadow publish | Barkod teyidi, sapma replanı, talimat çıktısı; Faz 9'a kadar canlı publish kapalı | **Tamam** |
| 9 | IAM/RBAC, RLS, audit, gözlemlenebilirlik | Yetkisiz publish reddedilir; tüm plan değişiklikleri audit'te | Bekliyor |

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

### Faz 1'de ne yapıldı

- **CSV motoru** `@gbsoft/domain`'de: RFC 4180 ayrıştırıcı, ayraç tespiti
  (`,` `;` sekme), BOM, tırnak içinde satır sonu; Türkçe Excel'in ondalık
  virgülü ve `GG.AA.YYYY` tarihleri
- **Altı şablon** tek yerde tanımlı: `layout`, `floor-area`, `sku`,
  `velocity`, `wave`, `pick-task`. API doğrulamayı, arayüz hem kolon
  dokümanını hem indirilebilir dosyayı aynı tanımdan üretir
- **İki aşamalı akış:** yükleme varsayılan olarak kuru koşudur; yazma ayrı ve
  açık bir komuttur (`dryRun=0`). İki aşama da aynı kontrollerden geçer
- **Ret politikası tür bazlı:** geometri all-or-nothing (yarım ikiz, hiç
  ikiz olmamasından kötüdür), kalanı kısmi ret
- **`IdentityMap`**: kaynak sistem kimliği bir kez bağlanır, asla üzerine
  yazılmaz; başka bir kanonik koda bağlanmak isteyen satır reddedilir
- **Olay omurgası ilk kez besleniyor:** `pick-task` yüklemesi
  `TASK_STARTED` / `TASK_COMPLETED` olayları yazar, `eventTime` ile
  `ingestTime` ayrı tutulur — Faz 3'ün girdisi hazır
- **Veri aktarımı ekranı** (`/system/imports`): şablon indir, doğrula, satır
  bazlı raporu gör, uygula, geçmişi izle
- **`npm run export:csv`**: golden dataset'i şablon biçiminde dışa aktarır;
  yeni tesis kurarken iki satırlık örnek yerine dolu dosya görülür

Doğrulandı: boş bir tesise sıfırdan yüklenen golden dataset 96 lokasyon ·
184 SKU · 38 dalga / 2.840 sipariş satırı üretti — seed script'inin doğrudan
yazdığı sayıların aynısı. Tek bozuk satır geometri dosyasının tamamını
reddetti (422) ve yeni ikiz sürümü açılmadı; hız dosyasındaki bilinmeyen SKU
satırı düşürüldü, kalanı yazıldı. 57 birim/entegrasyon testi ve 4 Playwright
senaryosu geçiyor.

### Faz 1b'de ne yapıldı

**Layout editörü** (`/system/layout`): tesis geometrisi parametrik olarak
tanımlanır — koridor sayısı, yüz başına göz, cross-aisle konumu, çizim
ölçüleri, ölçek, dock alanı, koridor bazlı zon ataması ve göz sırasına göre
raf profili (seviye, kapasite, ekipman, altın bölge). Harita üzerinde bir göz
seçilip engel nedeniyle bloklanabilir.

İki karar bu ekranın omurgası:

- **Harita bileşenine dokunulmadı.** Faz 0'da `WarehouseMap` keyfi geometri
  çizecek biçimde genelleştirilmişti; editör aynı bileşeni `layout` ve
  `locations` prop'larıyla besliyor. Ayrı bir çizim katmanı yok.
- **Editörün ayrı yazma yolu yok.** Taslak, elle doldurulmuş bir dosyayla
  birebir aynı CSV satırlarına çevrilip aynı içe aktarma hattından geçiyor.
  Doğrulama, all-or-nothing ret politikası, sürümleme ve `ImportBatch`
  denetim izi tek yerde kalıyor; editörle dosya yükleme arasında davranış
  farkı oluşamaz. Kaydetme iki adımdır: geometri (aktifleştirerek), sonra
  raf dışı alanlar.

Üretici `packages/domain/src/layoutBuilder.ts` içinde saf fonksiyondur.
Varsayılan taslak Marmara DM geometrisini birebir üretiyor — aynı göz
kodları, aynı ızgara, aynı dock referansı (150, 376) ve aynı mesafeler.
Bu, editörün mevcut dijital ikizle tutarlı olduğunun regresyon testidir.

Yeni bir tesiste ölçülmüş etkinlik verisi olmadığı için `picksPerDay`,
`replenishmentsPerDay` ve `congestionScore` sıfırdır ve arayüz ısı
katmanlarının düz olduğunu söyler. Bunları uydurmak, ölçülmemiş bir şeyi
ölçülmüş göstermek olurdu.

Doğrulandı: editörün ürettiği geometri boş bir tesise yazıldı, layout ucundan
96 lokasyon, doğru viewBox/dock/ölçek ve engel nedeni korunmuş olarak geri
geldi. Koridor sayısı değiştirildiğinde harita, zon tablosu ve sayaçlar
birlikte güncelleniyor.

**Kapsam dışı bırakıldı:** serbest sürükle-bırak geometri (düzensiz raf
yerleşimi), göz bazlı kapasite override'ı ve mevcut bir sürümü açıp
düzenleme. Editör bugün yeni sürüm üretir; var olanı yüklemez.

### Faz 2'de ne yapıldı

- **Kalıcı twin graph:** her `LayoutVersion`, dock/junction/location
  `GraphNode` kayıtları ve iki yönlü `GraphEdge` kayıtları taşır. Bloklu gözün
  erişim kenarı graf üzerinde kalır ama shortest-path hesabına girmez.
- **Tek üretim yolu:** layout içe aktarımı grafı aynı transaction içinde
  üretir; cross-aisle/floor-area değişince graf yeniden kurulur. Yarım layout
  veya yarım graf kalıcı olamaz.
- **Gerçek mesafe:** CSV'deki geçici Manhattan tahmini, graf üretildikten
  sonra dock'tan Dijkstra shortest-path mesafesiyle değiştirilir.
- **Mesafe matrisi:** `GET /api/facilities/:code/distance-matrix`, aktif ikizin
  96×96 simetrik lokasyon matrisini döner. Saf domain regresyonu ve gerçek DB
  entegrasyonunda hesap süresi 200 ms çıkış koşulunun altındadır.
- **Graph görünürlüğü:** `GET /api/facilities/:code/graph`, kalıcı node/edge
  kümesini ve coverage özetini verir. Golden dataset 96 göz için 181 node ve
  %100 coverage üretir.
- **Canlı veri kalitesi:** `/api/data-quality`, SKU fiziksel veri, lokasyon
  kapasitesi, event completeness, graph coverage ve kaynak kimlik eşlemesini
  gerçek snapshot'tan hesaplar. Arayüz artık bu ekran için fixture kullanmaz.
- **Yayın kapısı:** eksik SKU ölçüsü, eksik kapasite veya bağlantısız graf
  `DataQualityIssue.blocksPublish=true` üretir; yanıt hangi sorunların yayını
  blokladığını açıkça taşır. Faz 5 publish komutu bu hazır kapıyı kullanacak.

Doğrulandı: 76 birim/entegrasyon testi ve canlı API ile 4 Playwright senaryosu
geçiyor; production build başarılı.

### Faz 3'te ne yapıldı

- **Canlı model API'si:** `GET /api/facilities/:code/pick-time-model`, aktif
  sürümü, tesis parametrelerini, algoritmayı, eğitim penceresini, örnek sayısını,
  P50 medyan hatayı ve P90 coverage'ı döndürür.
- **Canlı Time Intelligence:** `GET /api/facilities/:code/picking-time`, aktif
  modelden beklenen bileşen dağılımını ve varsa görev etiketlerinden
  gerçekleşen P50/P90 dağılımını üretir. Arayüz bu ekran için artık fixture
  kullanmaz.
- **Feature/label hattı:** `TASK_STARTED/TASK_COMPLETED` çifti materialize
  edilmiş `PickTask` üzerinden süre etiketi; graf mesafesi, mean-distance oranı,
  congestion ve golden-zone feature'ları üretilir. Exception görevleri normal
  süre modeline karıştırılmaz.
- **Quantile eğitim işi:** `POST /api/facilities/:code/pick-time-model/calibrate`,
  deterministik `quantile-irls-v1` ile ayrı P50/P90 katsayıları fit eder. Aynı
  snapshot aynı parametreleri üretir.
- **Dürüst eşik:** en az 200 uygun görev yoksa endpoint
  `insufficient-data` döndürür, yeni model açmaz ve baseline aktif kalır.
  Golden dataset'te gerçek görev olayı olmadığı için UI açıkça **Kalibre
  değil · 0/200** gösterir; ölçülmüş kazanç iddiası yoktur.
- **Sürümlü aktivasyon:** yeterli örnekte eski model pasifleşir, yeni model
  sürümü parametre/algoritma/metrik/eğitim penceresiyle birlikte aktifleşir.

Doğrulandı: yetersiz örnek ve 220+ görevli başarılı eğitim yolları gerçek
PostgreSQL üzerinde geçiyor. Toplam 80 birim/entegrasyon testi, canlı API ile
4 Playwright senaryosu ve backend'siz demo akışı doğrulandı.

### Faz 4'te ne yapıldı

- **Ayrı solver servisi:** `services/optimizer`, FastAPI ve OR-Tools CP-SAT
  kullanır; yerel sanal ortamla veya Docker servisi olarak çalışır.
- **Hard constraint modeli:** hacim/ağırlık kapasitesi, ekipman, zon, blokaj,
  bir SKU/göz, kilit, freeze/fixed-slot ve move budget ceza olarak değil,
  ihlal edilemez kural olarak modellenir.
- **Deterministik warm start:** mevcut yerleşim başlangıç çözümüdür; sabit seed,
  tek worker ve süre sınırı her `OptimizationRun` kaydında korunur.
- **Dürüst çözüm kalitesi:** kanıtlanan optimum ayrı `solutionQuality=optimal`
  alanında tutulur; zaman sınırında optimum iddia edilmez, gap raporlanır.
- **Açıklanabilir infeasible:** CP-SAT assumption core, çakışan move budget,
  minimum fayda, kilit ve freeze kurallarını kullanıcı dilinde neden ve
  gevşetme seçeneğine dönüştürür.
- **Kalıcı asenkron API:** `POST /api/optimization-runs` 202 + run ID döner,
  `GET /api/optimization-runs/:id` queued/running/terminal durumu verir. Girdi
  ve sonuç snapshot'ları, solver/model sürümü, süre, amaç değeri ve gap saklanır.
- **Plan üretimi:** feasible sonuç yeni, lineage'lı `SlotPlan` sürümü ve taşınan
  SKU'lar için `SlotRecommendation`/alternatif kayıtları üretir; solver sonucu
  kendiliğinden WMS görevine dönüşmez.
- **Canlı arayüz:** Slotting Studio modalı API'ye gönderir ve polling ile gerçek
  sonucu gösterir; demo modu aynı sözleşmenin fixture adaptörünü korur.

Doğrulandı: 184 SKU / 96 lokasyon altın snapshot'ında planlanan 90 SKU 5 saniye
altında feasible; aynı seed deterministik, kilit/freeze/blockaj/kapasite ve
infeasible core testleri geçiyor. Canlı Marmara snapshot'ı 78 aktif SKU için
821 ms'de 0 hard ihlalle çözülüp 25 önerilik kalıcı plan üretti.

### Faz 5'te ne yapıldı

- **Gerçek move plan:** feasible solver atamaları plan sürümüne bağlı
  `MoveTask` kayıtlarına ve bölünemez zon paketlerine dönüşür. Solver sonucu
  açık yayın komutu gelmeden WMS durumu kazanmaz.
- **Canlı plan uçları:** plan listesi/detayı, öneriler, alternatifler ve
  move-task'lar PostgreSQL'den okunur; Move Plan ve Plan Geçmişi ekranları
  demo modu dışında bu uçlara bağlandı.
- **Sunucu tarafı paket bütünlüğü:** arayüz kontrolü atlatılsa bile paketin tek
  görevi yayınlanamaz; eksik seçim HTTP 409 ile gerekçeli reddedilir.
- **Idempotent kısmi yayın:** `idempotency-key` zorunludur. Aynı görev kümesi ve
  anahtarın tekrarı çift yazım üretmez; plan `PARTIALLY_PUBLISHED` veya
  `PUBLISHED` durumuna geçer.
- **Veri kalitesi kapısı:** planın kullandığı SKU/lokasyon/graf için kritik
  eksik varsa yayın durur. Plan dışında bırakılmış reserve SKU ölçüsü, güvenli
  bir planın yayınını gereksiz yere engellemez.
- **Rollback lineage:** kaynak ve hedef plan sürümleri korunur, işlem audit'e
  yazılır; daha önce yayınlanmış görevler sessizce iptal edilmez.
- **Dürüst ölçüm:** `PlanMeasurement`, beklenen etki ile gerçekleşen P50 farkını
  ayrı saklar. Yayın öncesi ve sonrası en az 50'şer gerçek görev yoksa
  `insufficient-data` döner ve actual kazanç yazılmaz.

Doğrulandı: 9 görevlik Zone A paketi canlı API ile kısmi yayınlandı; aynı
idempotency anahtarı tekrarında çift kayıt oluşmadı, tek görevle paket bölme
409 döndü ve rollback sonrasında 9 yayınlanmış görev korunurken iki audit kaydı
oluştu. Faz 5 entegrasyon testiyle toplam API testi 15'e çıktı; canlı ve demo
Playwright akışları 4/4 geçiyor.

### Faz 6'da ne yapıldı

- **Kanonik 3B sözleşme:** `packages/domain/src/scene3d.ts` 2B SVG birimini
  metreye çevirir; `geometry3d.ts` ortak `Vec3`/`Box3D` ilkellerini taşır.
  Ayak izi 2B haritayla birebir aynıdır — sahne yeni geometri uydurmaz.
- **Raf sistemi** (`rack.ts`): dikme, ön/arka traverse rayı ve kademe
  hücreleri. Raf kademe 1'den tepeye kadar süreklidir; golden dataset'te
  24 raf yüzü × 4 göz × 3 kademe = 288 hücre, 96'sı pick yüzü.
- **Tek yükleme yolu:** `twin/layout.ts` hem 2B hem 3B ucu besler. İki ayrı
  sorgu zamanla iki farklı geometri anlamı doğururdu.
- **Dürüst kot:** ölçülmüş raf yüksekliği olmayan tesiste düşey eksen
  türetilir ve `geometrySource: "derived"` bildirilir. Kısmen ölçülmüş sahne
  "ölçülmüş" sayılmaz.
- **Rota grafı:** `shortestPathNodes` mesafeyle aynı Dijkstra'yı öncül kaydıyla
  yürütür. `DOCK→A-01-01 = 25.033 m`, gözün `distanceToDockM` değeriyle aynı —
  3B'de çizilen yol ile mesafe matrisi tek kaynaktan çıkar.
- **Arayüz:** instanced gözler ve raf taşıyıcıları (480 draw call → 3),
  `frameloop="demand"`, üç kamera açısı, kesit düzlemi, kademe/zon filtresi,
  plan senaryosu katmanı, klavye gezinme, WebGL yoksa 2B fallback.

### Faz 6.5'te ne yapıldı

- **Yükleme siparişi:** `PickOrder`/`PickOrderLine`. `Wave` bir zaman
  penceresidir; bu bir yükleme işidir ve dock kapısını bilir.
- **Tur süre modeli** (`pickTour.ts`): ikinci bir model değil, mevcut modelin
  genişletilmesi. Satır başına sabit bileşenler kalibre `PickTimeModel`'den
  aynen alınır; duraklar arası travel graf mesafesinden gelir. `queueSec` tur
  başına bir kez sayılır — aynı kalemi hem tur hem satır başına saymak süreyi
  şişirirdi. Regresyon testi iki modelin ayrışmasını imkânsız kılıyor.
- **CVRP solver** (`services/optimizer/picktour`): OR-Tools Routing, hacim ve
  ağırlık iki ayrı dimension, hedef **makespan** (`SetGlobalSpanCostCoefficient`).
  Toplam süreyi küçültmek tek toplayıcıya bütün işi yükleyen çözümleri
  ödüllendirirdi.
- **Determinizm çözüm sayısından gelir**, duvar saatinden değil; süre sınırına
  takılırsa yanıt `stopped_by: time-limit` der ve tekrar üretilebilirlik iddia
  edilmez.
- **Optimum iddiası yok:** Routing kanıtlanmış optimum vermez. Yanıt `feasible`
  döner ve makespan için gerçek bir alt sınır raporlar
  (`max(Σ servis / araç, en uzak tek durak)`).
- **`OptimizationRun.kind`** ayrımı başladı: `SLOT | PICK_TOUR`. Yol
  haritasındaki `PALLET`/`TRUCK_LOAD` ayrımının ilk adımı.

Doğrulandı: canlı Marmara ikizinde 14 satırlık sipariş 3 tura bölündü;
makespan 11:43, toplam iş gücü 34:39, alt sınır 7:52 — turlar 11:25/11:31/11:43
ile dengelenmiş. Tur mesafesi 309.494 m, aynı turun 3B güzergâhı 309.492 m.
130 TypeScript testi (domain 75, API 29, web 26) ve 17 Python testi geçiyor.

### Faz 7.1–7.3'te ne yapıldı

- `PackageType`, `Shipment`, `ShipmentStop`, `HandlingUnit`, `PalletPlan` ve
  `PalletPlacement` tenant-scoped olarak kalıcılaştırıldı; örnek outbound
  sevkiyatı golden seed'e eklendi.
- Extreme-point palet çözücüsü sınır, yönelim, ağırlık, destek, üst yük,
  kırılganlık, sıcaklık ve ayrım kurallarını yerleştirme sırasında uygular.
  Optimum iddia etmez; bağımsız TypeScript doğrulayıcı sonucu yeniden kurar.
- `/operations/pallets` 3B palet, durak rengi, seçim, yükleme sırası replay'i,
  koordinatla taşıma, yatay döndürme ve kilitleme sağlar. WebGL yoksa tepeden
  2B görünüm aynı edit akışını korur.
- Her manuel değişiklik tekrar doğrulanır. Kilitler veritabanında saklanır;
  yeniden çözmede kilitli birim ile onu taşıyan destek zinciri fixed obstacle
  olur, geri kalan birimler deterministik biçimde yeniden paketlenir.

### Gerçekleşen sapmalar

| Plan | Gerçekleşen | Neden |
|---|---|---|
| pnpm workspaces | **npm workspaces** | pnpm kurulu değildi; yeni araç dayatmamak için |
| PostgreSQL + **PostGIS** | Sade **postgres:16-alpine** | postgis imajının otomatik kurduğu 4 eklenti Prisma'nın shadow veritabanında olmadığı için her migration'da "drift" üretti. Bugün hiçbir geometry tipi kullanılmıyor; raflar dikdörtgen, rota/mesafe mekânsal değil graf problemi. Gerçekten gerekirse ayrı migration ile eklenir. |
| Port 5432 | Port **5434** | 5432 ve 5433 makinedeki diğer projelerin konteynerlerince kullanılıyor |
| Kök `seed/` klasörü | `packages/seed` workspace paketi | Hem veritabanı seed'i hem arayüzün demo modu aynı paketi kullanabilsin diye |
| `packages/contracts` (OpenAPI) | Ertelendi | Tipler `@gbsoft/domain` üzerinden zaten paylaşılıyor; OpenAPI dış entegrasyon gerektiğinde eklenecek |
| Prisma şeması Faz 1'de | Faz 0'da yapıldı | Layout ucunun çıkış koşulu şemayı zaten gerektiriyordu |
| Faz 1 tek parça | İkiye ayrıldı: veri girişi + layout editörü | Çıkış koşulunu (golden dataset import) veri girişi tek başına karşılıyor; editör ayrı ve büyük bir arayüz işi, ara doğrulama noktası kazanmak için ayrıldı |
| CSV kütüphanesi | Kendi ayrıştırıcımız (`packages/domain/src/csv.ts`) | ~150 satır; karşılığında bağımlılık yok ve Türkçe Excel davranışı (noktalı virgül, ondalık virgül, BOM) baştan doğru. Aynı kod hem sunucuda hem tarayıcıda çalışıyor, demo modu bu sayede backend'siz doğruluyor |
| `POST /imports/:kind` çok parçalı yükleme | Ham `text/csv` gövdesi veya JSON `{fileName, content}` | `@fastify/multipart` bağımlılığı gerekmedi; curl ve tarayıcı ikisi de doğal kullanıyor |
| Sipariş satırı geçmişi tek şablon | `wave` + `pick-task` olarak ikiye ayrıldı | Şemada `OrderLine` tablosu yok; talep verisi `Wave.orderLines`, gerçekleşen iş `PickTask` üzerinde duruyor |
| Faz 6 = IAM/RBAC | Faz 6 = 3B dijital ikiz; yönetişim Faz 9'a kaydı | `docs/WAREHOUSE_3D_TRUCK_LOADING_PLAN.md` yol haritasını genişletti; truck-load yayını Faz 9 bitene kadar shadow modda kalacak |
| Raf hücreleri `StoragePosition` tablosunda | Sahne üretiminde türetiliyor, kalıcılaştırılmıyor | Görselleştirme ve kapasite görünürlüğü için yeterli. Faz 7-8'in "bu palet hangi gözde duruyor" sorusu için kalıcılık gerekecek; geometri üretimi `rack.ts` içinde saf fonksiyon olarak hazır |
| Toplama turu CP-SAT ile | OR-Tools **Routing** ile | Kapasiteli çok araçlı turlama tam olarak routing kütüphanesinin problemi; CP-SAT'ta elle modellemek hem yavaş hem kırılgan olurdu. İkisi de aynı `ortools` paketinde |

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
`FloorArea`, `GraphNode`, `GraphEdge` — dijital ikiz sürümlenir; planlar hangi
sürümde üretildiklerini saklar. Cross-aisle de bir `FloorArea`'dır; graf bu
alanları yatay rota omurgasına dönüştürür.

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

**Yönetişim:** `ObjectiveProfile`, `DataQualityIssue`, `ImportBatch`
(durum, kuru koşu bayrağı ve satır bazlı rapor ile), `IdentityMap`,
`AuditLog`, `User`, `Tenant`.

### Bilinçli kısıtlar

- `SlotRecommendation.sku` ilişkisi **Restrict**'tir: plana girmiş bir SKU
  sessizce silinemez. Seed bu yüzden çocuk tabloları sırayla temizler.
- `Event` üzerinde `(tenantId, source, sourceId, eventType)` benzersizdir: aynı
  kaynak olayı iki kez işlenemez.
- `MoveTask.idempotencyKey`: WMS'e tekrar gönderimi engeller.
- `IdentityMap` üzerinde `(tenantId, facilityId, entityType, sourceSystem,
  sourceId)` benzersizdir ve `canonicalCode` **güncellenmez**: bir kez kurulan
  kimlik eşlemesi değişmez, çakışan satır reddedilir.

---

## Servisler

### API (`apps/api`) — Fastify + Prisma

```
GET  /health                            [var]
GET  /api/facilities/:code/layout       FacilityLayout + locations   [var]
GET  /api/facilities/:code/graph        kalıcı twin graph + coverage [var]
GET  /api/facilities/:code/distance-matrix  96×96 shortest-path      [var]
GET  /api/facilities/:code/overview     KPI, istisna kuyruğu, zone yükü, tamamlanma serisi
GET  /api/facilities/:code/picking-time bileşen dağılımı + beklenen/gerçekleşen + model kalitesi [var]
GET  /api/facilities/:code/pick-time-model aktif parametreler + kalibrasyon [var]
POST /api/facilities/:code/pick-time-model/calibrate quantile eğitim işi [var]
GET  /api/slot-plans, /api/slot-plans/:id   sürümler ve lineage
POST /api/optimization-runs             async job → 202 + runId
GET  /api/optimization-runs/:id         status | feasible | infeasible + gap
POST /api/slot-plans/:id/locks | exclusions
POST /api/slot-plans/:id/publish        ayrı yetki, idempotency-key zorunlu
GET  /api/slot-plans/:id/move-tasks
GET  /api/data-quality                  coverage + yayın kapısı       [var]
GET  /api/imports/templates             altı şablonun kolon tanımı        [var]
GET  /api/imports/templates/:kind.csv   doldurulmaya hazır dosya          [var]
POST /api/imports/:kind                 yükleme → satır bazlı rapor       [var]
GET  /api/imports/batches               yükleme geçmişi                   [var]
GET  /api/imports/batches/:id           saklanan rapor                    [var]
```

İçe aktarma sözleşmesi: yükleme varsayılan olarak **kuru koşudur**
(`?dryRun=0` ile yazılır). Kısmi ret bir başarıdır ve 200 döner — kabul
edilen satırlar yazılmış, reddedilenler raporda durur; yalnız dosyanın
tamamı reddedildiğinde 422 döner ve gövde yine tam rapordur.

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

### Pick-time modeli · Faz 3 [hazır]

v1'de **parametreli analitik model**: `estimateLocationPickTimeSec()`.
Parametreler (sabit bileşenler, ortalama travel, congestion katsayısı, ergonomi
cezası, P90 çarpanı) tesis bazlı, versiyonlu ve API'den okunur; koda gömülmez.
Travel bileşeni tesis ortalamasına normalize edilir, böylece lokasyon
sürelerinin ortalaması tesis P50'siyle örtüşür.

Event pipeline **kuruldu ama kalibrasyon iddia edilmez**: `TASK_STARTED` /
`TASK_COMPLETED` çiftlerinden süre etiketleri, feature üretimi ve quantile
regression eğitim işi yazılır; yeterli veri gelene kadar model
`calibrated: false` döner ve arayüz bunu açıkça gösterir.

---

## Web app refactoru

Tasarım sistemi, `WarehouseMap`, `DataTable`, karar rail'i, grafikler ve tüm
ekran kompozisyonu **korunur**. Değişen dört şey:

**1. Fixture bağımlılığını kes.** [Faz 0-1'de kısmen yapıldı]
Harita ve ısı katmanları artık API'den beslenir; `WarehouseMap` bir
`layout: FacilityLayout` prop'u alır, `layers.ts` skalayı yüklenen
lokasyonlardan hesaplar. Veri aktarımı ekranı da baştan canlıdır. Kalan
sayfalar (`operations`, `move-plan`) ve
`planStore` ilgili uç canlıya bağlandıkça geçecek.

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

- **Import şablonları** (CSV) [hazır]: `layout` (geometri + göz kapasitesi),
  `floor-area`, `sku` (master + ölçü/ağırlık), `velocity`, `wave`,
  `pick-task`. Yükleme → satır bazlı doğrulama raporu → kısmi ret; hatalı
  kayıt sessizce atılmaz, her reddedilen satır numarası, kolonu ve nedeniyle
  raporda ve `ImportBatch` içinde saklanır.
- **2B layout editörü** (`/system/layout`) [hazır]: zon/koridor/raf yüzü/göz
  tanımlama, cross-aisle ve dock konumu, raf profili. Mevcut `WarehouseMap`
  önizleme olarak kullanılır; çıktı içe aktarma hattından geçer.
- **Golden dataset:** `packages/seed` — testlerin, demo modunun ve solver
  regresyonunun ortak temeli. `npm run export:csv` ile şablon biçiminde dışa
  aktarılır; import hattının regresyon girdisi de budur. [hazır]
- **Veri kalitesi kapısı:** `DataQualityIssue.blocksPublish`; kritik eksik (ölçü
  verisi yok) plan yayınını bloklar. Demodaki davranış gerçek kurala bağlanır.
  [hazır] İçe aktarma ölçüsü eksik SKU'yu **uyarıyla** geçirir ve slot planı
  kapsamı dışında kalacağını söyler; veri kalitesi motoru gerçek kaydı üretip
  yayın kapısını kapatır.

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

İçe aktarma hattı — boş bir tesise sıfırdan kurulum:

```bash
npm run export:csv --workspace @gbsoft/api -- ./seed-csv
```

```bash
curl -s -X POST "localhost:3001/api/imports/layout?facility=MARMARA-DC-01&dryRun=0&activate=1&unitsPerMeter=7" \
  -H 'content-type: text/csv' --data-binary @seed-csv/layout.csv | jq '{status, rowsAccepted, summary}'
```

- Sıra: `layout → floor-area → sku → velocity → wave`
- Kuru koşu (`dryRun` varsayılan) hiçbir şey yazmaz ama parti kaydı bırakır
- Geometri dosyasında tek bozuk satır → 422, sıfır yazma, yeni ikiz sürümü yok
- Arayüzde `/system/imports`: şablon indir → doğrula → raporu gör → uygula

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
