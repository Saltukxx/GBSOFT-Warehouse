# GBSoft Warehouse Intelligence — Picking & Slotting demosu

Sunumda çalıştırılabilir, verisi tutarlı, kurumsal bir web demosu.
`GBSoft_Picking_Time_Slot_Optimization_Demo_Spec.md` şartnamesinin uygulamasıdır;
ürün bağlamı `GBSoft_Warehouse_to_Truck_Optimization_Engine_Proje_Tasarimi.pdf`
belgesinden gelir.

Bu demo gerçek bir WMS değildir. Bir karar ve optimizasyon katmanının nasıl
çalışacağını gösterir.

## Çalıştırma

```bash
npm install
```

```bash
npm run dev
```

Uygulama `http://localhost:5173` adresinde açılır ve `/operations` sayfasına
yönlenir.

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | TypeScript strict derleme + üretim paketi |
| `npm run preview` | Üretim paketini yerelde sunar |
| `npm test` | Demo veri tutarlılık testleri (Vitest) |
| `npm run test:e2e` | Ana demo akışı (Playwright) |
| `npm run lint` | oxlint |

Playwright ilk kullanımda tarayıcı ister: `npx playwright install chromium`.

## Sunum akışı

1. **`/operations`** — Müdahale kuyruğunda `A-03 congestion` satırında **İncele**.
2. Açılan panelde **Time Intelligence'ta aç**.
3. **`/analysis/time`** — `Travel` bileşenine tıklayın; kök neden haritası ve
   route karşılaştırması açılır.
4. **Slotting Studio'da aç**.
5. Haritada `B-11-04` gözünü seçin → karar rail'inde SKU-184 önerisi, nedenleri,
   trade-off'u ve alternatif lokasyonları görünür.
6. **Bu atamayı kilitle** → **Yeniden optimize et** → **Planı çalıştır**.
   Sonuç: `SP-2026-081-R1`, net etki `-7,2%`, 24 görev.
7. **Sonucu plana uygula** → plan özeti ve karşılaştırma şeridi güncellenir.
8. **Move Plan** → **Zone A görevleri** kutusunu işaretleyin:
   11 görev, 2 bağımlılık paketi, 1,7 sa, tahmini net etki `-4,1%`.
9. **11 görevi WMS'e yayınla** → "Demo modunda 11 görev yayınlandı".
10. **Plan geçmişi** — sürüm lineage'ı ve geri alma.

## Demo durumlarını tetikleme

| Durum | Nasıl |
|---|---|
| Hata (error) | `/operations?fail=overview` |
| Uygulanabilir plan yok (infeasible) | Optimizer modalında move budget'ı 12'nin altına indirin |
| Boş (empty) | Move Plan'de Zone ve Durum filtrelerini eşleşmeyecek şekilde seçin |
| Yükleniyor | Mock API sabit gecikmelerle çalışır (140-420 ms) |

## Veri ve determinizm

- Bütün ekranlar `src/data/fixtures/` altındaki tek kaynaktan beslenir.
- `Math.random` kullanılmaz; değişkenlik `src/data/rng.ts` içindeki seed'li
  mulberry32 ile üretilir, hard refresh sonrası aynı sonucu verir.
- `src/tests/demo-data.test.ts` şartnamedeki sabitleri (plan özeti, 26/24 görev,
  Zone A için 11 görev · 2 paket · 1,7 sa · -4,1%) doğrular.

### Sabit değerler

| Değer | Plan SP-2026-081 | Kilitli plan SP-2026-081-R1 |
|---|---:|---:|
| Net operasyon etkisi | -7,6% | -7,2% |
| Picking süresi | -9,8% | -9,4% |
| Yürüyüş | -12,4% | -11,9% |
| Replenishment | +3,1% | +2,8% |
| Taşıma görevi | 26 | 24 |
| Taşıma yükü | 4,3 sa | 3,9 sa |
| Etkilenen SKU | 21 | 21 |
| Hard constraint ihlali | 0 | 0 |

## Mimari

```text
src/
├── app/          router, kabuk, plan UI state'i (kilit/exclusion/aktif sürüm)
├── domain/       warehouse, picking, slotting, optimization tipleri ve formüller
├── data/
│   ├── fixtures/ tek kaynak demo verisi
│   ├── rng.ts    deterministik üretim
│   └── api.ts    §15 endpoint sözleşmesinin in-memory adaptörü
├── components/   ui, charts, warehouse-map, data-table
├── features/     operations, picking-time, slotting, move-plan, data-quality
├── styles/       tokens.css (§4), global.css, utilities.css
└── tests/        veri tutarlılık testleri
e2e/              Playwright golden path
```

Şartnameden sapmalar:

- Mock API MSW yerine `src/data/api.ts` içinde in-memory adaptör olarak
  uygulandı; endpoint sözleşmesi, sabit gecikmeler ve hata/infeasible
  senaryoları korunur.
- Server state için TanStack Query yerine iptal destekli küçük bir `useAsync`
  kancası kullanıldı; veri kaynağı ağ üzerinden gelmediği için önbellek
  katmanına ihtiyaç yok.
- Grafikler bağımlılıksız, elde çizilmiş SVG'dir (varsayılan chart teması
  kullanılmaması şartı bu şekilde garanti edilir).

## Depo modeli

12 koridor · her koridorda iki raf yüzü · her yüzde 4 göz = **96 pick lokasyonu**.
Bir koridorun iki yüzü farklı zonlara ait olabilir; cross-aisle koridoru ikiye
böler ve bay 01 dock'a en yakın gözdür. Lokasyon kimliği `ZONE-KORİDOR-GÖZ`
biçimindedir (`A-03-02`).

Lokasyon picking süresi, tesis ortalaması Time Intelligence'taki P50 (71,4
sn/line) ile örtüşecek şekilde normalize edilir; böylece harita ısı katmanı ile
süre analizi aynı modeli anlatır.

## Erişilebilirlik

- Harita ok tuşlarıyla gezilir, Escape seçimi kaldırır.
- Grafiklerin tablo alternatifi vardır.
- Modal ve drawer'da focus trap, Escape ile kapanma.
- Renk tek gösterge değildir; ikon, metin veya desenle desteklenir.
- `prefers-reduced-motion` desteklenir.
