import { test, expect } from "@playwright/test";
import { waitForShell } from "./helpers";

/**
 * Component checks against current shell classes.
 * Full visual baselines deferred (see screenshot.spec.ts fixme).
 */
test.describe("Component Snapshots", () => {
  test("nav rail is visible", async ({ page }) => {
    await waitForShell(page);
    await expect(page.getByLabel("Gezinme")).toBeVisible();
  });

  test("composer and prompt are interactive", async ({ page }) => {
    await waitForShell(page);
    await expect(page.locator("#composer")).toBeVisible();
    const prompt = page.locator("#prompt");
    await prompt.fill("snapshot-prompt");
    await expect(prompt).toHaveValue("snapshot-prompt");
  });

  test.fixme("nav rail screenshot", async ({ page }) => {
    // Baselines not refreshed for current NavRail shell — prefer smoke.spec.ts for CI.
    await waitForShell(page);
    await expect(page.getByLabel("Gezinme")).toHaveScreenshot("nav-rail.png", { maxDiffPixelRatio: 0.15 });
  });
});
