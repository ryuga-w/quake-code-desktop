import { test, expect } from "@playwright/test";
import { waitForShell } from "./helpers";

/**
 * Terminal lives in the bottom panel (Xterm PTY), not the legacy
 * TerminalPanel input/run/output testids. Open via Ctrl+J (titlebar
 * toggle is hidden on empty new-chat shells).
 */
async function openBottomTerminal(page: import("@playwright/test").Page) {
  await waitForShell(page);
  await page.keyboard.press("Control+j");
  await expect(page.getByRole("region", { name: "Alt panel" })).toBeVisible({ timeout: 10_000 });
}

test.describe("Terminal Panel", () => {
  test("opens bottom terminal panel with xterm surface", async ({ page }) => {
    await openBottomTerminal(page);
    await expect(page.getByText("Quake Terminal")).toBeVisible();
    await expect(page.locator("[data-testid='terminal-surface']")).toBeVisible({ timeout: 15_000 });
  });

  test("can create new terminal tab from profile menu", async ({ page }) => {
    await openBottomTerminal(page);
    await expect(page.locator("[data-testid='terminal-surface']")).toBeVisible({ timeout: 15_000 });
    await page.locator("button[aria-label='Yeni terminal']").click();
    const item = page.getByRole("menuitem").first();
    await expect(item).toBeVisible();
    await item.click();
    const tabs = page.locator('[role="tablist"][aria-label="Terminal oturumları"] [role="tab"]');
    await expect(tabs).toHaveCount(2, { timeout: 10_000 });
  });

  // Legacy TerminalPanel used data-testid terminal-input/run/output.
  // Xterm PTY has no stable typed-command hooks yet — keep skipped until hooks exist.
  test.skip("can run echo command via PTY", async () => {
    // TODO: drive xterm with page.keyboard after terminal-surface focus,
    // or add data-testid hooks for scripted command + exit status.
  });
});

test.describe("Terminal Security", () => {
  test("policy API blocks dangerous git reset", async ({ page }) => {
    await waitForShell(page);
    const response = await page.request.post("/api/terminal/run", {
      data: { command: "git reset --hard HEAD" },
    });
    const body = await response.json().catch(() => ({}));
    expect(body.error || body.message || !response.ok()).toBeTruthy();
    if (body.error) {
      expect(String(body.error)).toMatch(/engellendi|reset/i);
    }
  });
});
