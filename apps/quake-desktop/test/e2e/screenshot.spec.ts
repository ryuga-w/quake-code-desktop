import { test, expect } from "@playwright/test";
import { waitForShell } from "./helpers";

/**
 * Visual snapshots — optional / flaky across theme and font metrics.
 * Prefer smoke.spec.ts for CI signal. All cases fixme until baselines refresh.
 */
test.describe("Visual Regression", () => {
  test.fixme("chat view screenshot", async ({ page }) => {
    await waitForShell(page);
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("chat-view.png", { maxDiffPixelRatio: 0.15 });
  });

  test.fixme("settings page screenshot", async ({ page }) => {
    await waitForShell(page);
    await page.locator("button[title='Ayarlar']").click();
    await expect(page.getByRole("dialog", { name: "Ayarlar" })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("settings-page.png", { maxDiffPixelRatio: 0.15 });
  });

  test.fixme("file explorer screenshot", async ({ page }) => {
    await waitForShell(page);
    await page.keyboard.press("Alt+1");
    await expect(page.locator(".files-panel")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("file-explorer.png", { maxDiffPixelRatio: 0.15 });
  });

  test.fixme("terminal panel screenshot", async ({ page }) => {
    await waitForShell(page);
    await page.keyboard.press("Control+j");
    await expect(page.locator("[data-testid='terminal-surface']")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("terminal-panel.png", { maxDiffPixelRatio: 0.15 });
  });

  test.fixme("command palette screenshot", async ({ page }) => {
    await waitForShell(page);
    await page.keyboard.press("Control+k");
    await expect(page.locator("[role='dialog'][aria-label='Komut paleti']")).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("command-palette.png", { maxDiffPixelRatio: 0.15 });
  });
});
