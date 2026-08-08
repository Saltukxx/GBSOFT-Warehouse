import { expect, test } from "@playwright/test";

/**
 * Ana demo akışı (§24).
 * Operasyon → Time Intelligence → Slotting Studio → kilitle →
 * yeniden optimize et → Move Plan → kısmi yayın.
 */
test("slotting demo golden path", async ({ page }) => {
  await page.goto("/operations");

  await page
    .getByRole("button", { name: "A-03 congestion incele" })
    .click();
  await page.getByRole("link", { name: "Time Intelligence'ta aç" }).click();

  await expect(page.getByText("71,4 sn/line")).toBeVisible();
  await expect(page.getByText("94,2 sn/line")).toBeVisible();

  await page.getByRole("link", { name: "Slotting Studio'da aç" }).click();
  await page.getByTestId("location-B-11-04").click();

  await expect(page.getByText("SKU-184 · Organik Yulaf 500 g")).toBeVisible();
  // Karar rail'inde "Önerilen" satırı hedef gözü gösterir.
  const rail = page.locator(".rail");
  await expect(rail.getByText("A-03-02", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Bu atamayı kilitle" }).click();
  await page.getByRole("button", { name: "Yeniden optimize et" }).click();
  await page.getByRole("button", { name: "Planı çalıştır" }).click();

  await expect(page.getByText("SP-2026-081-R1")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("-7,2%")).toBeVisible();

  await page.getByRole("button", { name: "Sonucu plana uygula" }).click();
  await expect(
    page.getByText("Plan SP-2026-081-R1", { exact: false }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Move Plan" }).first().click();
  await page.getByRole("checkbox", { name: "Zone A görevleri" }).check();

  await expect(
    page.getByRole("button", { name: "11 görevi WMS'e yayınla" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "11 görevi WMS'e yayınla" }).click();

  await expect(
    page.getByText("Demo modunda 11 görev yayınlandı"),
  ).toBeVisible();
});

test("veri kalitesi ve plan geçmişi hard refresh sonrası açılır", async ({
  page,
}) => {
  await page.goto("/data-quality");
  await expect(page.getByRole("heading", { name: "Veri kalitesi" })).toBeVisible();
  await expect(page.getByText("%94")).toBeVisible();

  await page.goto("/optimization/history");
  await expect(
    page.getByRole("rowheader", { name: "SP-2026-081", exact: true }),
  ).toBeVisible();
});

test("uygulanabilir plan bulunamadığında nedenler gösterilir", async ({
  page,
}) => {
  await page.goto("/optimization/slotting");
  await page.getByRole("button", { name: "Yeniden optimize et" }).click();
  await page.getByLabel("Move budget").fill("6");
  await page.getByRole("button", { name: "Planı çalıştır" }).click();

  await expect(
    page.getByText("Uygulanabilir plan bulunamadı"),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText("Zone A move budget yetersiz", { exact: false }),
  ).toBeVisible();
});

test("konsolda hata yoktur", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  for (const route of [
    "/operations",
    "/analysis/time",
    "/optimization/slotting",
    "/optimization/moves",
    "/data-quality",
  ]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
  }

  expect(errors).toEqual([]);
});
