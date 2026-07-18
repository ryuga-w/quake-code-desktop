import { test, expect } from "@playwright/test";
import { waitForShell } from "./helpers";

test.describe("File Operations", () => {
  test("can create a new file", async ({ page }) => {
    await waitForShell(page);

    const response = await page.request.post("/api/file/write", {
      data: {
        path: "test-new-file.txt",
        content: "Test content",
        createBackup: false,
      },
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.path).toBe("test-new-file.txt");
    expect(result.bytes).toBeGreaterThan(0);
  });

  test("can read a file", async ({ page }) => {
    await waitForShell(page);

    const response = await page.request.get("/api/file?path=test-new-file.txt");
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.content).toBe("Test content");
  });

  test("can patch a file", async ({ page }) => {
    await waitForShell(page);

    const response = await page.request.post("/api/file/patch", {
      data: {
        path: "test-new-file.txt",
        patches: [{ oldText: "Test content", newText: "Updated content" }],
      },
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.edits).toBe(1);
  });

  test("can delete a file", async ({ page }) => {
    await waitForShell(page);

    const response = await page.request.post("/api/file/delete", {
      data: { path: "test-new-file.txt" },
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.path).toBe("test-new-file.txt");
  });

  test("can create directory", async ({ page }) => {
    await waitForShell(page);

    const response = await page.request.post("/api/file/mkdir", {
      data: { path: "test-dir" },
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.path).toBe("test-dir");

    await page.request.post("/api/file/delete", { data: { path: "test-dir" } });
  });

  test("can rename file", async ({ page }) => {
    await waitForShell(page);

    await page.request.post("/api/file/write", {
      data: { path: "rename-test.txt", content: "content", createBackup: false },
    });

    const response = await page.request.post("/api/file/rename", {
      data: { from: "rename-test.txt", to: "renamed-test.txt" },
    });
    expect(response.ok()).toBeTruthy();

    await page.request.post("/api/file/delete", { data: { path: "renamed-test.txt" } });
  });

  test("prevents writing outside workspace", async ({ page }) => {
    await waitForShell(page);

    const response = await page.request.post("/api/file/write", {
      data: { path: "../escape.txt", content: "escape attempt", createBackup: false },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe("File History", () => {
  test("can get file history", async ({ page }) => {
    await waitForShell(page);

    await page.request.post("/api/file/write", {
      data: { path: "history-test.txt", content: "v1", createBackup: true },
    });

    const response = await page.request.get("/api/file/history?path=history-test.txt");
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.versions).toBeDefined();

    await page.request.post("/api/file/delete", { data: { path: "history-test.txt" } });
  });
});
