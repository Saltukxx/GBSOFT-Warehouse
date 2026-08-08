# GBSoft Slotting & Picking Intelligence

WMS üstü çalışan karar ve kanıt katmanı. Bu depo, sunum demosundan gerçek ürüne
geçişi barındırır.

**Kapsam (v1):** Foundation, dijital ikiz, dynamic slotting, picking analitiği,
yönetişim. Palletization, 3B araç yükleme, kamera/LiDAR doğrulama, Yard/Dock ve
Freight Audit sonraki sürümlerdedir.

> Veriler kurgusal bir tesise (Marmara Dağıtım Merkezi) aittir. Gerçek müşteri
> verisi bağlanana kadar plan KPI'ları **tahmin**dir; ölçülmüş kazanç değildir.

## Hızlı başlangıç

```bash
npm install && cp .env.example .env && npm run build
```

```bash
npm run db:up && npm run db:migrate && npm run db:seed
```

İki terminalde:

```bash
npm run dev:api
```

```bash
npm run dev
```

Arayüz `http://localhost:5173`, API `http://127.0.0.1:3001`.

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
```

`packages/domain` tek doğruluk kaynağıdır: süre modeli (`estimateLocationPickTimeSec`),
slot skoru (`slotScore`) ve bütün alan tipleri web, API ve solver tarafından
ortak kullanılır.

`packages/seed` üç yeri birden besler: veritabanı seed'i, arayüzün demo modu ve
regresyon testleri. Böylece demo ile ürün asla farklı sayı göstermez.

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | Web geliştirme sunucusu |
| `npm run dev:api` | API geliştirme sunucusu |
| `npm run build` | Tüm workspace'leri derler (strict TypeScript) |
| `npm test` | Birim ve veri tutarlılık testleri |
| `npm run test:e2e` | Playwright ana demo akışı |
| `npm run db:up` / `db:down` | Veritabanı konteyneri |
| `npm run db:migrate` | Prisma migration |
| `npm run db:seed` | Golden dataset (idempotent) |
| `npm run db:psql` | Konteyner içinden psql |

Host'ta `psql` veya PostgreSQL kurulu olması gerekmez. Veritabanı **5434**
portunu kullanır; 5432/5433 başka projeler tarafından kullanıldığı için seçildi.

## Faz durumu

| Faz | Kapsam | Durum |
|---|---|---|
| 0 | Monorepo, veritabanı, API iskeleti, layout ucu | **Tamam** |
| 1 | Import şablonları, layout editörü, veri girişi | Sırada |
| 2 | Twin graph, mesafe matrisi, veri kalitesi motoru | Bekliyor |
| 3 | Pick-time modeli, event ingest, kalibrasyon | Bekliyor |
| 4 | CP-SAT slotting solver (Python + OR-Tools) | Bekliyor |
| 5 | Move plan, kısmi yayın, ölçüm, rollback | Bekliyor |
| 6 | IAM/RBAC, RLS, audit, gözlemlenebilirlik | Bekliyor |

### Hangi uç canlı?

`apps/web/src/data/api.ts` içindeki `LIVE_ENDPOINTS` ve `FIXTURE_ENDPOINTS`
listeleri, ürünün gerçekte ne kadarının canlı olduğunu tek bakışta gösterir.
Şu an yalnız **layout** ucu veritabanından okur; kalanı golden dataset'ten gelir.

## Kararlar

- **Kiracı:** kurulum tek kiracıdır, ancak her tablo `tenantId` taşır. Çok
  kiracılıya geçiş migration gerektirmez; Faz 6'da RLS eklenir.
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

- `GBSoft_Warehouse_to_Truck_Optimization_Engine_Proje_Tasarimi.pdf` — ürün ve
  mimari tasarımı
- `GBSoft_Picking_Time_Slot_Optimization_Demo_Spec.md` — demo şartnamesi
- `apps/web/README.md` — arayüz ayrıntıları ve sunum akışı
