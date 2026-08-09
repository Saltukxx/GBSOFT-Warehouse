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
  - `GET /api/load-plans/:id`
  - `GET /api/load-plans/:id/sequence`
  - `POST /api/load-plans/:id/positions` — move/rotate/lock
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
