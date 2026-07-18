import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const browser = readFileSync(join(root, "src/client/src/components/settings/BrowserSettings.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/src/components/settings/BrowserSettings.module.css"), "utf8");
const settings = readFileSync(join(root, "src/client/src/components/settings/SettingsPanels.tsx"), "utf8");

describe("browser settings reference contract", () => {
  it("keeps every referenced browser section and row", () => {
    for (const label of [
      "Tarayıcı",
      "Genel",
      "Web URL ve bağlantı açma hedefi",
      "Yerel URL açma hedefi",
      "Tarama verileri",
      "Açıklama ekran görüntüleri",
      "Otomatik doldurma ve parolalar",
      "Şifre yöneticisi",
      "İletişim bilgileri",
      "İndirilenler",
      "Konum",
      "İndirilenlerin nereye kaydedileceğini sor",
      "İndirme geçmişi",
      "İzinler",
      "Site ayarları",
      "Onay",
    ]) {
      expect(browser).toContain(label);
    }
  });

  it("persists controls and connects available navigation and folder behavior", () => {
    expect(browser).toContain('const BROWSER_STORAGE_KEY = "quake-web:browserPreferences"');
    expect(browser).toContain("writeStorageJson(BROWSER_STORAGE_KEY, next)");
    expect(browser).toContain("desktop?.pickFolder");
    expect(browser).toContain("onOpenComputerUse");
    expect(browser).toContain("onOpenPermissions");
    expect(settings).toContain("<BrowserSettings");
    expect(settings).toContain('"quake-web:browserPreferences"');
  });

  it("uses readable sizing and keyboard-accessible controls", () => {
    expect(browser).toContain('role="switch"');
    expect(browser).toContain('role="status"');
    expect(browser).toContain("aria-live=\"polite\"");
    expect(styles).toContain("width: min(100%, 820px)");
    expect(styles).toContain("font-size: 13px");
    expect(styles).toContain("min-height: 68px");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
