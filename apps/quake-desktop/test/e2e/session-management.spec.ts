import { test, expect } from "@playwright/test";
import { waitForShell } from "./helpers";

test.describe("Session Management", () => {
  test("can list sessions", async ({ page }) => {
    await waitForShell(page);
    const response = await page.request.get("/api/sessions");
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.sessions).toBeDefined();
    expect(Array.isArray(result.sessions)).toBeTruthy();
  });

  test("can start new session via Yeni görev", async ({ page }) => {
    await waitForShell(page);
    await page.locator("button[title='Yeni görev']").click();
    await expect(page.locator("#composer")).toBeVisible();
    await expect(page.locator("#prompt")).toBeVisible();
  });

  // SessionPickerModal ("Sohbet sürdür") is no longer wired from the NavRail;
  // history is ConversationHistoryPage / thread list. Keep skipped until a
  // stable open control returns (search / history page).
  test.skip("can open session picker", async () => {
    // Was: button[title='Sohbet sürdür'] + .session-picker-modal
  });
});

test.describe("Session API", () => {
  test("can switch session", async ({ page }) => {
    await waitForShell(page);

    const listResponse = await page.request.get("/api/sessions");
    const { sessions } = await listResponse.json();

    if (sessions.length > 0) {
      const response = await page.request.post("/api/command", {
        data: {
          type: "switch_session",
          sessionPath: sessions[0].path,
        },
      });
      expect(response.ok()).toBeTruthy();
    }
  });

  test("can fork session", async ({ page }) => {
    await waitForShell(page);

    const listResponse = await page.request.get("/api/sessions");
    const { sessions } = await listResponse.json();

    if (sessions.length > 0) {
      const response = await page.request.post("/api/command", {
        data: {
          type: "fork_session",
          entryId: sessions[0].id,
        },
      });
      expect(response.ok()).toBeTruthy();
    }
  });
});
