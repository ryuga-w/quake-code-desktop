import { expect, type Page } from "@playwright/test";

/** Wait until boot splash is gone so chrome buttons are clickable. */
export async function waitForShell(page: Page) {
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#composer")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#prompt")).toBeVisible({ timeout: 30_000 });
  // Splash intercepts pointer events until config + sessions finish loading.
  await expect(page.locator('[data-component="splash-screen"]')).toHaveCount(0, { timeout: 45_000 });
}

/** Dismiss first-run trust modal if it appears (does not fail when absent). */
export async function dismissTrustIfPresent(page: Page) {
  const trust = page.getByRole("dialog", { name: "Güven ve erişim" });
  // Modal opens after async web-settings; short wait only.
  try {
    await trust.waitFor({ state: "visible", timeout: 1_500 });
  } catch {
    return;
  }
  await page.getByRole("button", { name: "Anladım" }).click();
  await expect(trust).toBeHidden({ timeout: 5_000 });
}

export async function openSettings(page: Page) {
  await waitForShell(page);
  await dismissTrustIfPresent(page);
  await page.locator("button[title='Ayarlar']").click();
  await expect(page.getByRole("dialog", { name: "Ayarlar" })).toBeVisible();
}

/** Left nav only — quick-link buttons in the content pane can duplicate labels. */
export function settingsNav(page: Page) {
  return page.getByRole("navigation", { name: "Ayar bölümleri" });
}
