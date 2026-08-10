import { expect, test, type Page } from "@playwright/test";

/**
 * Faz 7–8 outbound akışı: palet editörü ve rota-duyarlı araç yükleme.
 *
 * `golden-path.spec.ts` yalnız slotting tarafını görüyordu; outbound ekranları
 * en çok etkileşim taşıyan ekranlar olduğu hâlde uçtan uca hiç sınanmıyordu.
 *
 * Bu senaryolar **canlı hattı** kullanır: palet ve araç planları veritabanı ve
 * optimizer olmadan üretilemez, demo adaptörü yoktur. Servisler ayakta değilse
 * dosya atlanır — yanlış bir "yeşil" vermemek için sessizce geçilmez, atlandığı
 * açıkça görünür.
 */

const API_URL = process.env.VITE_API_URL ?? "http://127.0.0.1:3001";

const servicesReady = await fetch(`${API_URL}/health`)
  .then((response) => response.ok)
  .catch(() => false);

test.skip(!servicesReady, `Canlı API ${API_URL} adresinde yok; outbound akışı atlandı.`);

/** Çözücü koşusu ağ üzerinden sürer; buton etiketleri ona göre beklenir. */
const SOLVE_TIMEOUT = 60_000;

// Varsayılan 30 sn'lik test süresi tek bir çözücü koşusunu bile karşılamıyor.
test.setTimeout(150_000);

/**
 * Sevkiyat seçimi.
 *
 * Seçici sevkiyat listesine kısıtlanır: elleçleme birimi kodları sevkiyat
 * kodunu içeriyor (`SHP-DEMO-002-L003-001`), sayfa genelinde arayınca yükleme
 * sırasındaki 27 birim de eşleşiyor.
 */
async function selectShipment(page: Page, listSelector: string, code: string) {
  const item = page.locator(listSelector).getByRole("button", { name: new RegExp(code) });
  await item.click();
  await expect(item).toHaveAttribute("aria-current", "true");
}

/**
 * İlk birimi seçip kilitler.
 *
 * Seçim ve kilitleme tek bir yeniden-deneme bloğunda: plan üretildikten sonra
 * sevkiyat listesi ve yürütme kaydı arka planda yenileniyor, gelen yeni plan
 * nesnesi seçimi sıfırlıyor. İki adımı ayırmak, tam aradaki yenilemeye denk
 * gelince kilit tıklamasının boşa düşmesine yol açıyordu.
 *
 * Blok idempotent: birim zaten kilitliyse (senaryo ikinci kez koşuyorsa)
 * tıklama yapılmaz, yalnız durum doğrulanır.
 */
async function lockFirstUnit(page: Page, sequenceSelector: string): Promise<string> {
  const first = page.locator(`${sequenceSelector} button`).first();
  const unitCode = (await first.locator("strong").innerText()).trim();

  await expect(async () => {
    await first.click();
    const lock = page.getByRole("button", { name: /Yerini kilitle|Kilidi kaldır/ });
    await expect(lock).toBeVisible({ timeout: 3_000 });
    if ((await lock.innerText()).includes("Yerini kilitle")) {
      await lock.click();
    }
    await expect(page.getByRole("button", { name: "Kilidi kaldır" })).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 60_000 });

  return unitCode;
}

/* ------------------------------------------------------------------ */
/* Palet Studio                                                        */
/* ------------------------------------------------------------------ */

test.describe.serial("palet studio", () => {
  test("plan üretir, birimi kilitler ve warm-start'ta kilidi korur", async ({ page }) => {
    await page.goto("/operations/pallets");
    await selectShipment(page, ".palletstudio__shipment-list", "SHP-DEMO-001");

    // Plan üretimi: buton etiketi mevcut duruma göre değişiyor ve kilit
    // veritabanında kalıcı olduğu için "Kilitlerle yeniden çöz" de olabilir.
    await page
      .getByRole("button", {
        name: /Palet planı oluştur|Planı yeniden üret|Kilitlerle yeniden çöz/,
      })
      .click();
    // Koşunun bittiğini metrik değil başarı mesajı kanıtlar: metrikler eski
    // plandan zaten görünür durumda olduğu için bekleme anında geçerdi.
    await expect(
      page.getByText(/bağımsız doğrulamadan geçirildi|yeniden yerleştirildi/),
    ).toBeVisible({ timeout: SOLVE_TIMEOUT });
    await expect(page.getByText("Hacim doluluğu")).toBeVisible();
    // Başarı mesajı `refresh()` tamamlanmadan görünüyor; liste oturmadan
    // seçim yapmak yarışa giriyor.
    await page.waitForLoadState("networkidle");

    const unitCode = await lockFirstUnit(page, ".palletstudio__sequence");

    // Kilit varken yeniden çözmek warm-start'tır: kilitli birim yerinde kalır.
    await page.getByRole("button", { name: "Kilitlerle yeniden çöz" }).click();
    await expect(page.getByText(/Kilitli birimler korunarak/)).toBeVisible({
      timeout: SOLVE_TIMEOUT,
    });
    await expect(
      page.locator(".palletstudio__sequence button", { hasText: unitCode }),
    ).toContainText("kilitli");
  });
});

/* ------------------------------------------------------------------ */
/* Load Studio                                                         */
/* ------------------------------------------------------------------ */

test.describe.serial("load studio", () => {
  test("dolu römork planı aks ve CoG ölçüleriyle üretilir", async ({ page }) => {
    await page.goto("/operations/loading");
    await selectShipment(page, ".loadstudio__shipment-list", "SHP-DEMO-002");

    await page
      .getByRole("button", { name: /Araç planı oluştur|Yeni sürüm üret|Kilitlerle yeniden çöz/ })
      .click();

    // Koşunun bittiğini metrik değil başarı mesajı kanıtlar: metrikler eski
    // plandan zaten görünür durumda olduğu için bekleme anında geçerdi.
    await expect(
      page.getByText(/bağımsız doğrulamadan geçti|yeniden yerleştirildi/),
    ).toBeVisible({ timeout: SOLVE_TIMEOUT });
    await expect(page.getByText("Hacim doluluğu")).toBeVisible();

    // Aks paneli iki grup ve kullanım oranı gösterir; kingpin bu senaryoda
    // bağlayıcı kısıttır.
    await expect(page.getByText("KINGPIN")).toBeVisible();
    await expect(page.getByText("TRIDEM")).toBeVisible();
    await expect(page.locator(".loadstudio__cog")).toContainText("x ");

    // Golden geometri uyarısı ekranda kalmalı — canlı yayının önündeki kapı bu.
    await expect(page.getByText(/araç geometrisi demo varsayımıdır/)).toBeVisible();

    // Bağımsız doğrulamadan geçmiş plan ihlalsizdir.
    await expect(
      page.getByText(/araç sınırı, kapı, engel, çakışma/),
    ).toBeVisible();
  });

  test("shadow yayın, barkod teyidi, sapma ve replan zinciri çalışır", async ({
    page,
  }) => {
    await page.goto("/operations/loading");
    await selectShipment(page, ".loadstudio__shipment-list", "SHP-DEMO-002");
    await expect(page.getByText("Hacim doluluğu")).toBeVisible({
      timeout: SOLVE_TIMEOUT,
    });

    // Yayın kapısı: yalnız doğrulanmış plan shadow yürütmeye alınabilir.
    const publish = page.getByRole("button", { name: "Shadow yayına al" });
    if (await publish.isVisible()) {
      await publish.click();
    }
    await expect(page.getByText("Teyit", { exact: true })).toBeVisible({
      timeout: SOLVE_TIMEOUT,
    });

    // Doğru sırayla okutma teyit sayısını artırır.
    await page.getByRole("button", { name: "Bekleneni doldur" }).click();
    await page.getByRole("button", { name: "Teyit et" }).click();
    await expect(page.getByText(/\d+\/\d+ yük teyit edildi/)).toBeVisible({
      timeout: SOLVE_TIMEOUT,
    });

    // Hasarlı okutma sapma üretir; canlı sisteme hiçbir şey yazılmaz.
    await page.getByRole("button", { name: "Bekleneni doldur" }).click();
    await page.getByLabel("Sonuç").selectOption("damaged");
    await page.getByRole("button", { name: "Teyit et" }).click();
    await expect(page.getByText(/Okutma sapma oluşturdu/)).toBeVisible({
      timeout: SOLVE_TIMEOUT,
    });

    // Sapma replanı teyitli yükleri sabitler, sorunlu birimi dışarıda bırakır.
    await page.getByRole("button", { name: "Sapmayı yeniden planla" }).click();
    await expect(
      page.getByText(/teyitli yük sabitlendi, \d+ sorunlu yük çıkarıldı/),
    ).toBeVisible({ timeout: SOLVE_TIMEOUT });
  });

  test("yükleme talimatı shadow damgasıyla üretilir", async ({ page }) => {
    await page.goto("/operations/loading");
    await selectShipment(page, ".loadstudio__shipment-list", "SHP-DEMO-002");
    await expect(page.getByText("Hacim doluluğu")).toBeVisible({
      timeout: SOLVE_TIMEOUT,
    });

    const sheet = page.locator(".loadstudio__instruction-sheet");
    await expect(sheet).toBeVisible({ timeout: SOLVE_TIMEOUT });
    // Damga kâğıda da basılır: çıktıyla sahaya inen kişi bunun canlı bir WMS
    // görevi olmadığını görmelidir.
    await expect(sheet.getByText("SHADOW / SİMÜLASYON")).toBeVisible();
    await expect(sheet.locator("ol > li").first()).toContainText("kg");
  });
});

/* ------------------------------------------------------------------ */
/* Konsol temizliği                                                    */
/* ------------------------------------------------------------------ */

test("outbound ekranlarında konsol hatası yoktur", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  for (const route of ["/operations/pallets", "/operations/loading"]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
  }

  expect(errors).toEqual([]);
});
