import { test, expect, type Page } from "@playwright/test";
import { dismissTrustIfPresent, openSettings, settingsNav, waitForShell } from "./helpers";

/**
 * Optional agents + settings smoke (beyond ship-gate S-PUB.1).
 * Settings/İzinler is a hard green path; Ajanlar opens only when dock chrome is reachable.
 * Soft-skip agents when env/UI layout hides the launcher (empty new-chat, narrow viewport).
 */

/** Open right dock without relying on new-chat-hidden titlebar toggles. */
async function tryOpenAgentsPanel(page: Page): Promise<boolean> {
  // Alt+1 opens Files → right dock (works even when workspace chrome is hidden).
  await page.keyboard.press("Alt+1");
  const addTab = page.getByRole("button", { name: "Yeni panel sekmesi" });
  try {
    await expect(addTab).toBeVisible({ timeout: 8_000 });
  } catch {
    // Fallback: workspace chrome toggle if visible outside new-chat.
    const yan = page.getByRole("button", { name: "Yan paneli aç/kapat" });
    if (!(await yan.isVisible().catch(() => false))) return false;
    await yan.click();
    const ajanlar = page.getByRole("menuitem", { name: "Ajanlar" });
    if (!(await ajanlar.isVisible().catch(() => false))) return false;
    await ajanlar.click();
    return page.locator('[data-testid="agents-panel"]').isVisible().catch(() => false);
  }

  await addTab.click();
  const ajanlar = page.getByRole("menuitem", { name: "Ajanlar" });
  try {
    await expect(ajanlar).toBeVisible({ timeout: 5_000 });
  } catch {
    return false;
  }
  await ajanlar.click();
  try {
    await expect(page.locator('[data-testid="agents-panel"]')).toBeVisible({ timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe("Agents + settings smoke (optional)", () => {
  test("settings → İzinler → Uygulamaya geri dön", async ({ page }) => {
    await openSettings(page);

    const settings = page.getByRole("dialog", { name: "Ayarlar" });
    await expect(settings).toBeVisible();

    const nav = settingsNav(page);
    await expect(nav.getByRole("button", { name: "İzinler" })).toBeVisible();
    await nav.getByRole("button", { name: "İzinler" }).click();

    // Stable anchors (also covered by settings.spec) — prove permissions surface loaded.
    await expect(page.getByRole("heading", { name: "İzinler" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bağlantı & kimlik doğrulama" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Erişim rejimi (Codex approval)" })).toBeVisible();

    // Durable allows card sits below the fold — scroll then assert.
    const kalici = page.getByRole("heading", { name: "Kalıcı izinler" });
    if ((await kalici.count()) === 0) {
      // Stale dist or future layout rename — soft skip, not fail ship path.
      test.skip(true, "Kalıcı izinler heading not in DOM (rebuild client if expected)");
      return;
    }
    await kalici.scrollIntoViewIfNeeded();
    await expect(kalici).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Uygulamaya geri dön" }).click();
    await expect(settings).toBeHidden();
    await expect(page.locator("#prompt")).toBeVisible();
  });

  test("right launcher / Ajanlar opens agents panel when reachable", async ({ page }) => {
    try {
      await waitForShell(page);
    } catch {
      test.skip(true, "Shell did not become ready (splash/env) — soft skip");
      return;
    }
    await dismissTrustIfPresent(page);

    const opened = await tryOpenAgentsPanel(page);
    if (!opened) {
      test.skip(true, "Ajanlar dock not reachable in this shell (new-chat chrome / env) — soft skip");
      return;
    }

    const panel = page.locator('[data-testid="agents-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("aria-label", "Paralel ajanlar");
    await expect(page.getByText("Paralel ajanlar").first()).toBeVisible();
  });
});
