# 3B Warehouse ve Rota-Duyarlı Truck Loading Planı

## Özet

Mevcut yol haritası genişletilecek: 3B özellikler mevcut güvenlik fazından
önce geliştirilecek, eski Faz 6 yönetişim çalışmaları Faz 9'a kaydırılacak.
Tasarım, ana ürün belgesindeki warehouse-to-truck yaklaşımını izleyecek.

Kararlaştırılan kapsam:

- Depoda tam ayrık olay simülasyonu yerine operasyonel 3B dijital ikiz.
- Kamyon, treyler ve ISO konteyner.
- Koli, palet, kasa, varil/silindir, düzensiz rijit yük ve güvenli zarfla
  modellenen çuval/balya.
- Rota/durak sırası sabit TMS veya manuel girdi; yükleme motoru rotayı
  değiştirmeyecek.
- Dengeli hedef: araç kullanımı, doluluk, durak erişimi, yükleme süresi ve
  yeniden elleçleme.
- Otomatik + manuel + hibrit planlama; adım adım mobil/basılabilir yükleme
  talimatı ve barkod teyidi.
- İlk doğrulama deterministik golden senaryolar ve CSV importlarıyla yapılacak.

## Yeni Yol Haritası

### Faz 6 — 3B altyapı ve Warehouse Twin

- Three.js, React Three Fiber ve instanced rendering tabanlı ortak 3B sahne
  katmanı.
- Mevcut 2B layout verisini raf, göz, dock, staging ve engel geometrisine
  yükseltme.
- Raf yüksekliği, göz kotu/derinliği, kat yüksekliği ve traversable ekipman
  yollarını veri modeline ekleme.
- Pick, replenishment ve move-task rotalarını graph üzerinde hareketli replay
  olarak gösterme.
- Mevcut/önerilen/onaylı senaryo, heatmap, section-cut, kat ve zon filtreleri.
- WebGL bulunmadığında veya düşük donanımda mevcut 2B/2.5D görünüm.

### Faz 7 — Outbound modeli ve Palletization

- `Shipment`, `Stop`, `RouteVersion`, `HandlingUnit`, `PackageType`,
  `PalletPlan` ve hiyerarşik SSCC ilişkileri.
- Koli/palet/varil/düzensiz rijit/esnek-zarf yük profilleri.
- Geometri, rotasyon, maksimum üst yük, support ratio, kırılganlık,
  stackability, sıcaklık ve ayrım kuralları.
- Extreme-point/maximal-space başlangıç çözümü, layer-building ve LNS
  iyileştirmesi.
- Palet yerleştirme sırasını picking precedence kurallarına geri besleme.
- Palet editöründe move/rotate/lock; kilitli nesneleri fixed obstacle kabul
  ederek warm-start replan.

### Faz 8 — Route-Aware Truck Loading ve Execution

Uygulama sırası ve bağımsız çıkış koşulları:

1. **8.1 — Araç şablonları + bağımsız doğrulayıcı:** ölçü, kapı, engel,
   toplam/aks yükü, CoG ve durak erişimini saf alan motoru yeniden hesaplar.
2. **8.2 — Solver + kalıcı API:** rota-duyarlı yerleşim, precedence sırası,
   `OptimizationRun(TRUCK_LOAD)` ve sürümlü `LoadPlan` kayıtları.
3. **8.3 — 3B Load Studio:** section view, stop/SKU rengi, aks grafiği,
   replay ve move/rotate/lock sonrası warm-start.
4. **8.4 — Execution:** barkod/SSCC teyidi, eksik/hasarlı yükte sapma
   replanı, mobil/basılabilir talimat ve Faz 9'a kadar shadow publish.

#### Faz 8.1 teslim kaydı

- `VehicleTemplate` kiracı bazında kalıcıdır; iç hacim, arka kapı,
  engeller, aks grupları, taşıma kapasitesi ve güvenli CoG zarfını taşır.
- `GET /api/vehicle-templates` ve `GET /api/vehicle-templates/:code`
  aynı sürümlü sözleşmeyi sunar.
- Solver'dan bağımsız doğrulayıcı; sınır/kapı/engel/çakışma,
  toplam ve aks yükü, CoG, rota erişimi ve yükleme önceliğini yeniden
  hesaplar. İhlalli plan yayınlanabilir sayılmaz.
- Başlangıçtaki `RIGID-12T`, `SEMI-13M6` ve `ISO-40HC` şablonları
  `golden-assumption` etiketlidir; üretici belgesi veya saha ölçümü yerine
  geçmez.

#### Faz 8.2 teslim kaydı

- `POST /api/shipments/:id/truck-load` sabit rotayı değiştirmeden bir
  `TRUCK_LOAD` optimizasyon koşusu başlatır; araç şablonu ve tüm yük
  birimleri değişmez input snapshot'ında saklanır.
- Deterministik route-band sezgiseli son durak yüklerini ön/derin bölgeye
  ve ilk yükleme adımlarına; ilk durak yüklerini arka kapıya ve son
  adımlara koyar. Sonuç için optimumluk iddiası yapılmaz.
- Solver araç içindeki boyuna ofseti aks limitleri, CoG zarfı ve engelleri
  birlikte sağlayacak biçimde arar. Bulamazsa neden ve gevşetme seçeneğiyle
  `infeasible` döner.
- Solver sonucu doğrudan onaylanmaz; Faz 8.1 doğrulayıcısı geometri,
  ağırlık ve rota erişimini yeniden hesaplar. Plan ancak bundan sonra
  `VALIDATED` olabilir.
- `GET /api/shipments/:id/load-plans` eski koşuları silmeden sürümlü plan,
  yerleşim, aks yükü, CoG, doluluk ve ihlal kaydını döner.

#### Demo verisi: kısıtın bağlayıcı olduğu senaryo

`SHP-DEMO-001` karışık koli sevkiyatıdır; kırılgan, varil ve çuval kurallarını
tetikler ama 13,6 m'lik römorkun %2'sini doldurur. Aks yükü, CoG ve rota
erişimi kısıtlarının hiçbiri bağlayıcı olmaz — yani Faz 8.1 doğrulayıcısının
asıl dalları demo veriyle hiç çalışmıyordu.

`SHP-DEMO-002` bu boşluğu kapatır: 3 durak, 27 palet birim yükü, ~640 kg/palet,
toplam 17,2 t. Ölçülen sonuç:

| Ölçü | Değer |
| --- | --- |
| Hacim doluluğu | %41,3 |
| KINGPIN | 10.673 / 12.000 kg (%88,9) |
| TRIDEM | 14.076 / 27.000 kg (%52,1) |
| CoG x | 7,92 m (zarf 3–10,8 m) |
| Yerleşim x aralığı | 2,4 → 12,8 m |

Yük öne yaslansaydı kingpin payı 14,6 t'ye çıkardı — sınırın 2,6 t üstünde.
Çözücü bloğu arkaya kaydırdığı için plan geçerli. Aks kısıtının yerleşimi
gerçekten değiştirdiği tek senaryo budur; `axleLimit.test.ts` hem sonucu hem
"öne yaslanmış yerleşim ihlal ederdi" iddiasını sınar.

Sevkiyat satırları palet birim yükünü doğrudan taşır (`PALLET-EUR-LOADED`).
Bu bir **modelleme kısayoludur**: Faz 7 kolileri palete istifliyor ama üretilen
paleti bir üst elleçleme birimi olarak kaydetmiyor, bu yüzden araç yerleşimi
kolileri tek tek görüyor. Faz 7 → 8 devri yazılana kadar palet birim yükü
sevkiyat satırında tanımlanır; tedarikçi paletli gönderdiğinde gerçek akış
zaten budur.

#### Faz 8.3 teslim kaydı

- `/operations/loading` sevkiyat, araç şablonu ve plan sürümünü aynı çalışma
  alanında birleştirir. Yeni plan ile kilitleri koruyan warm-start ayrı
  eylemlerdir.
- 3B araç görünümü durak bazlı renk, section view, engel/aks geometrisi,
  CoG işareti ve yükleme sırası replay'i sunar. WebGL yoksa aynı yerleşim 2B
  üst görünümle okunabilir.
- Hacim, toplam yük, yeniden elleçleme, aks kullanımı ve CoG değerleri planın
  bağımsız doğrulama sonucuyla birlikte gösterilir; golden araç geometrisi
  uyarısı arayüzde kaybolmaz.
- `PATCH /api/load-plans/:planId/placements/:huCode` move/rotate/lock
  değişikliğini kalıcılaştırır ve planı her değişiklikten sonra bağımsız
  doğrulayıcıdan yeniden geçirir. Kilitli pozlar sonraki çözümde
  `fixed_placements` olarak tam koordinatlarıyla korunur.
- Tarayıcı doğrulamasında plan üretme, seçim/editör, kilitleme, warm-start,
  section view ve replay akışları gerçek API ile çalıştırıldı.

#### Faz 8.4 teslim kaydı

- `LoadExecution` ve `LoadScanEvent` kayıtları shadow yürütmenin durumunu,
  idempotency anahtarını, teyit sayısını ve sapma kanıtını kalıcı tutar.
- `POST /api/load-plans/:id/publish` yalnız bağımsız doğrulanmış planı kabul
  eder ve açıkça `mode: shadow` döner. Canlı WMS/TMS yazımı Faz 9 yetki kapısı
  tamamlanana kadar yapılmaz.
- `POST /api/load-plans/:id/scan-events` HU kodu veya SSCC'yi beklenen fiziksel
  yükleme sırasıyla karşılaştırır; doğru, eksik, hasarlı, sıra dışı ve
  bilinmeyen sonuçlarını idempotent olay olarak saklar.
- `POST /api/load-plans/:id/reoptimize` teyit edilmiş yükleri mutlak
  koordinatında sabitler, eksik/hasarlı birimleri dışarıda bırakır ve eski
  planı silmeden yeni sürüm üretir. Solver sabit yük çevresindeki kilitsiz
  birimleri yeniden akıtır ve CoG'yi güvenli zarfa geri dengeler; bağımsız
  doğrulama kapısı son sözü söyler.
- `GET /api/load-plans/:id/instructions` mobil/yazdırılabilir sıra, durak,
  koordinat, ölçü ve ağırlık talimatını üretir. Load Studio aynı sözleşmeyi
  yazdırma görünümünde sunar.
- Canlı tarayıcı kabulü; shadow publish → barkod teyidi → hasarlı/eksik sapma
  → replan → doğrulanmış yeni sürüm zinciriyle tamamlandı.

- Parametrik araç şablonları: iç hacim, kapılar, teker yuvaları, engeller, aks
  grupları, toplam/aks limitleri ve CoG zarfı.
- Araç koordinatı: `x` ön duvardan arka kapıya, `y` sol-sağ, `z` tabandan
  yukarı.
- Son durak yükleri aracın ön/derin bölümüne; ilk durak yükleri kapıya
  erişilebilir bölüme yerleştirilecek.
- Her durakta ilgili yük, sonraki durak yüklerini indirmeden erişilebilir olmak
  zorunda olacak.
- Yükleme sırası precedence grafından üretilecek:
  - destekleyen yük, üstündeki yükten önce;
  - sonraki durak yükü, önceki durak yükünden önce;
  - forklift yaklaşımı ve kapı yönü korunacak;
  - cycle oluşursa plan infeasible dönecek.
- 3B Load Studio: stop/SKU rengi, aks yük grafiği, CoG, doluluk, section view,
  adım oynatma, manuel taşı/döndür/kilitle.
- Barkodla doğru HU ve sıra teyidi; eksik/hasarlı yükte yüklenen pozisyonları
  kilitleyip kalan alanı yeniden çözme.
- PDF/etiket/mobil talimat çıktısı.

### Faz 9 — Güvenlik ve Yönetişim

- Mevcut eski Faz 6 kapsamı: IAM, RBAC, RLS, audit, gözlemlenebilirlik ve
  incident rollback.
- Truck-load yayınlama Faz 9 tamamlanana kadar feature flag altında
  shadow/simülasyon modunda kalacak.
- Aks, toplam ağırlık ve güvenlik kuralları versiyonlu rule pack olacak; canlı
  limitler uzman onayı olmadan koda sabitlenmeyecek.

## Veri, API ve Solver Değişiklikleri

- Yeni import türleri: `package-type`, `handling-unit`, `vehicle-template`,
  `shipment`, `shipment-stop`.
- Mevcut `OptimizationRun` ayrımlı hale gelecek: `SLOT`, `PALLET`,
  `TRUCK_LOAD`; eski slotting istekleri geriye uyumlu kalacak.
- Temel uçlar:
  - `GET /api/facilities/:code/scene-3d`
  - `POST /api/optimization-runs` — pallet/load run için 202 + run ID
  - `GET /api/shipments/:id/load-plans`
  - `GET /api/load-plans/:id/instructions`
  - `GET /api/load-plans/:id/execution`
  - `PATCH /api/load-plans/:id/placements/:huCode` — move/rotate/lock
  - `POST /api/load-plans/:id/reoptimize`
  - `POST /api/load-plans/:id/publish`
  - `POST /api/load-plans/:id/scan-events`
- Python optimizer içinde ayrı `pallet` ve `truck_load` modülleri kurulacak:
  - hızlı feasible çözüm;
  - candidate orientation/position üretimi;
  - extreme-point/maximal-space packing;
  - stop-aware LNS;
  - CP-SAT ile aday seçimi ve precedence;
  - sabit seed, warm start, timeout ve best-feasible kalite raporu.
- Solver'dan bağımsız ikinci validator; no-overlap, sınır, support, üst yük,
  toplam/aks ağırlığı, CoG ve stop erişimini yeniden hesaplayacak. Validator
  geçmeden plan yayınlanamayacak.
- Esnek yükler soft-body fizik kullanmayacak; ölçülmüş hacme
  deformasyon/sıkışma toleransı eklenen muhafazakâr zarf, üst yük ve komşuluk
  kurallarıyla çözülecek.
- Serbest sıvı/dökme yük, canlı hayvan, asılı yük, ileri lashing mühendisliği
  ve eksiksiz ADR kombinasyonları bu teslimin dışında kalacak.

## Test ve Kabul Kriterleri

- Golden set: en az 3 araç şablonu, 8 durak, karma HU tipleri, iki araçlık
  senaryo ve bilinen infeasible örnekler.
- Aynı snapshot + seed aynı yerleşim ve yükleme sırasını üretmeli.
- 120 HU / 8 durak / 2 araç senaryosunda 10 saniye içinde feasible sonuç;
  timeout'ta optimal iddiası yok.
- Bağımsız validator sonucu:
  - sıfır çakışma ve araç dışına taşma;
  - toplam ve aks ağırlığı ihlali yok;
  - CoG güvenli zarf içinde;
  - support/top-load kuralları geçiyor;
  - her durakta sonraki durak yükünü taşımadan erişim mümkün.
- İlk durak kapıya yakın, son durak derinde olmalı; istisnalar yalnız hard
  constraint gerekçesiyle açıklanmalı.
- Manuel lock sonrası yalnız kilitsiz yükler değişmeli; undo ve aynı snapshot'a
  rollback çalışmalı.
- Araç değişiminde eski plan korunmalı, yeni vehicle template ile yeni plan
  sürümü üretilmeli.
- Eksik ölçü/ağırlık/stop/araç aks verisi yayın kapısını bloklamalı.
- Warehouse 3B sahnesi mevcut 96 lokasyonda akıcı çalışmalı; düşük donanım
  fallback'i ve klavye erişimi test edilmeli.
- Canlı ve demo E2E: shipment seç → rota görüntüle → optimize et → 3B incele →
  nesne kilitle → yeniden çöz → adım talimatı → barkod teyidi → sapmada
  replan.

## Varsayımlar

- İlk veri kaynağı golden dataset ve CSV; TMS/WMS konektörü sonraki entegrasyon
  katmanıdır.
- Birimler kanonik olarak metre ve kilogram; kaynak birim ve dönüşüm korunur.
- Araç rotası yükleme run'ı boyunca sabittir.
- Güvenlik her zaman hard constraint'tir; objective ağırlıkları güvenlik
  kuralını gevşetemez.
- Depo 3B, operasyonel replay ve what-if sunar; işçi/forklift kuyruklarını
  modelleyen tam discrete-event simulation daha sonraki fazdır.
- Kamera/LiDAR doğrulama bu kapsamda yoktur; barkod/SSCC teyidi kullanılır.
