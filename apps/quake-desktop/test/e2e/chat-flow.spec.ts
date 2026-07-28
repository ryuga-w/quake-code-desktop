import { test, expect } from "@playwright/test";
import { dismissTrustIfPresent, waitForShell, settingsNav } from "./helpers";

test.describe("Chat Flow", () => {
  test("loads the app", async ({ page }) => {
    await waitForShell(page);
    await expect(page.locator(".composer")).toBeVisible();
  });

  test("can type in the prompt", async ({ page }) => {
    await waitForShell(page);
    const input = page.locator("#prompt");
    await input.fill("Merhaba");
    await expect(input).toHaveValue("Merhaba");
  });

  test("composer is ready for a new task", async ({ page }) => {
    await waitForShell(page);
    // Empty chat has no #timeline until the first visible message.
    await expect(page.locator("#composer")).toBeVisible();
  });

  test("adds a dropped text file to composer context without uploading it twice", async ({ page }) => {
    const workspaceWrites: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/file/write") workspaceWrites.push(request.url());
    });
    await waitForShell(page);
    await dismissTrustIfPresent(page);

    await page.locator("#composer").evaluate((composer) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(["export const dropped = true;\n"], "dragged-context.ts", {
        type: "text/typescript",
      }));
      for (const type of ["dragenter", "dragover", "drop"]) {
        composer.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
      }
    });

    await expect(page.locator(".context-chip.file")).toContainText("dragged-context.ts");
    await expect(page.getByRole("button", { name: "Gönder" })).toBeEnabled();
    await page.waitForTimeout(100);
    expect(workspaceWrites).toEqual([]);
  });

  test("can open command palette with Ctrl+K", async ({ page }) => {
    await waitForShell(page);
    await page.keyboard.press("Control+k");
    await expect(page.locator("[role='dialog'][aria-label='Komut paleti']")).toBeVisible();
    await page.keyboard.press("Escape");
  });
});

test.describe("File Explorer", () => {
  test("can open files panel via Alt+1", async ({ page }) => {
    await waitForShell(page);
    // No sidebar title="Dosyalar" in current NavRail; Alt+1 opens right files dock.
    await page.keyboard.press("Alt+1");
    await expect(page.locator(".files-panel")).toBeVisible({ timeout: 10_000 });
  });

  test("shows file tree", async ({ page }) => {
    await waitForShell(page);
    await page.keyboard.press("Alt+1");
    await expect(page.locator("#files")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Terminal", () => {
  test("can open terminal bottom panel", async ({ page }) => {
    await waitForShell(page);
    await page.keyboard.press("Control+j");
    await expect(page.getByRole("region", { name: "Alt panel" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-testid='terminal-surface']")).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Sessions", () => {
  test("can start new session", async ({ page }) => {
    await waitForShell(page);
    await page.locator("button[title='Yeni görev']").click();
    await expect(page.locator("#composer")).toBeVisible();
  });
});

test.describe("Settings", () => {
  test("can open settings", async ({ page }) => {
    await waitForShell(page);
    await page.locator("button[title='Ayarlar']").click();
    await expect(page.getByRole("dialog", { name: "Ayarlar" })).toBeVisible();
  });

  test("can change theme", async ({ page }) => {
    await waitForShell(page);
    await page.locator("button[title='Ayarlar']").click();
    await settingsNav(page).getByRole("button", { name: "Görünüm" }).click();
    await expect(page.getByLabel("Tema")).toBeVisible();
  });
});
