import { test, expect } from "@playwright/test";
import { waitForShell, settingsNav } from "./helpers";

/**
 * Minimal green path against the current Turkish shell (NavRail + Settings modal).
 * Prefer this over broad snapshot suites when the UI is mid-refactor.
 */
test.describe("Smoke", () => {
  test("app shell loads, settings round-trip, composer visible", async ({ page }) => {
    await waitForShell(page);

    await page.locator("button[title='Ayarlar']").click();
    const settings = page.getByRole("dialog", { name: "Ayarlar" });
    await expect(settings).toBeVisible();
    const nav = settingsNav(page);
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("button", { name: "Genel" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Görünüm" })).toBeVisible();

    await page.getByRole("button", { name: "Uygulamaya geri dön" }).click();
    await expect(settings).toBeHidden();
    await expect(page.locator("#prompt")).toBeVisible();
  });
});
