import { test, expect } from "@playwright/test";
import { openSettings, settingsNav, waitForShell } from "./helpers";

test.describe("Settings", () => {
  test("can open settings page", async ({ page }) => {
    await openSettings(page);
    await expect(settingsNav(page)).toBeVisible();
  });

  test("settings nav has current sections", async ({ page }) => {
    await openSettings(page);
    const nav = settingsNav(page);
    for (const label of ["Genel", "Görünüm", "Modeller", "İzinler", "Bildirimler"]) {
      await expect(nav.getByRole("button", { name: label })).toBeVisible();
    }
  });

  test("settings has appearance section", async ({ page }) => {
    await openSettings(page);
    await settingsNav(page).getByRole("button", { name: "Görünüm" }).click();
    await expect(page.getByRole("heading", { name: "Görünüm" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Tema" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Aydınlık tema" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Karanlık tema" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tercihler" })).toBeVisible();
  });

  test("settings has reference general sections", async ({ page }) => {
    await openSettings(page);
    for (const heading of ["İzinler", "Genel", "Oluşturucu", "Açılır Pencere", "Bildirimler"]) {
      await expect(page.getByRole("heading", { name: heading, exact: true }).last()).toBeVisible();
    }
    await expect(page.getByLabel("Varsayılan izinler")).toBeVisible();
    await expect(page.getByLabel("Entegre terminal kabuğu")).toBeVisible();
    await expect(page.getByLabel("Tur tamamlama bildirimleri")).toBeVisible();
  });

  test("settings has reference browser sections", async ({ page }) => {
    await openSettings(page);
    await settingsNav(page).getByRole("button", { name: "Tarayıcı" }).click();
    await expect(page.getByRole("heading", { name: "Tarayıcı", exact: true })).toBeVisible();
    for (const heading of ["Genel", "Otomatik doldurma ve parolalar", "İndirilenler", "İzinler"]) {
      await expect(page.getByRole("heading", { name: heading, exact: true }).last()).toBeVisible();
    }
    await expect(page.getByRole("switch", { name: "Yerleşik tarayıcı denetimi" })).toBeVisible();
    await expect(page.getByLabel("Web URL ve bağlantı açma hedefi")).toBeVisible();
    await expect(page.getByLabel("Web sitesi açma onayı")).toBeVisible();
  });

  test("settings has models section", async ({ page }) => {
    await openSettings(page);
    await settingsNav(page).getByRole("button", { name: "Modeller" }).click();
    await expect(page.getByText("Geçerli model")).toBeVisible();
  });

  test("can change density", async ({ page }) => {
    await openSettings(page);
    await settingsNav(page).getByRole("button", { name: "Görünüm" }).click();
    await page.getByLabel("Yoğunluk").selectOption("compact");
    await expect(page.locator("#app")).toHaveAttribute("data-density", "compact");
  });

  test("can close settings with Uygulamaya geri dön", async ({ page }) => {
    await openSettings(page);
    await page.getByRole("button", { name: "Uygulamaya geri dön" }).click();
    await expect(page.getByRole("dialog", { name: "Ayarlar" })).toBeHidden();
  });

  test("shows security info under permissions", async ({ page }) => {
    await openSettings(page);
    await settingsNav(page).getByRole("button", { name: "İzinler" }).click();
    await expect(page.getByText("Kimlik doğrulama", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bağlantı & kimlik doğrulama" })).toBeVisible();
  });

  test("shows terminal policy under permissions", async ({ page }) => {
    await openSettings(page);
    await settingsNav(page).getByRole("button", { name: "İzinler" }).click();
    await expect(page.getByText("Durum").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Erişim rejimi (Codex approval)" })).toBeVisible();
  });
});

test.describe("Theme", () => {
  test("has system, light and dark theme cards", async ({ page }) => {
    await openSettings(page);
    await settingsNav(page).getByRole("button", { name: "Görünüm" }).click();
    const theme = page.getByRole("radiogroup", { name: "Tema" });
    await expect(theme.getByRole("radio")).toHaveCount(3);
    await expect(theme.getByRole("radio", { name: "Sistem" })).toBeVisible();
    await expect(theme.getByRole("radio", { name: "Açık" })).toBeVisible();
    await expect(theme.getByRole("radio", { name: "Koyu" })).toBeVisible();
  });

  test("can select light theme", async ({ page }) => {
    await openSettings(page);
    await settingsNav(page).getByRole("button", { name: "Görünüm" }).click();
    await page.getByRole("radio", { name: "Açık" }).check();
    await expect(page.locator("#app")).toHaveAttribute("data-theme", "light");
  });

  test("can select dark theme", async ({ page }) => {
    await openSettings(page);
    await settingsNav(page).getByRole("button", { name: "Görünüm" }).click();
    await page.getByRole("radio", { name: "Koyu" }).check();
    await expect(page.locator("#app")).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("Config API", () => {
  test("returns server config", async ({ page }) => {
    await waitForShell(page);
    const response = await page.request.get("/api/config");
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.config).toBeDefined();
    expect(result.config.host).toBeDefined();
    expect(result.config.port).toBeDefined();
  });

  test("returns models", async ({ page }) => {
    await waitForShell(page);
    const response = await page.request.get("/api/models");
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.models).toBeDefined();
    expect(Array.isArray(result.models)).toBeTruthy();
  });

  test("returns commands", async ({ page }) => {
    await waitForShell(page);
    const response = await page.request.get("/api/commands");
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.commands).toBeDefined();
    expect(Array.isArray(result.commands)).toBeTruthy();
  });
});
