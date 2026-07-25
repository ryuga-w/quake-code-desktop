import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const general = readFileSync(join(root, "src/client/src/components/settings/GeneralSettings.tsx"), "utf8");
const terminal = readFileSync(join(root, "src/client/src/components/terminal/XtermTerminal.tsx"), "utf8");
const contextUsage = readFileSync(join(root, "src/client/src/components/composer/ContextUsageIndicator.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/src/components/settings/GeneralSettings.module.css"), "utf8");

describe("general settings live-controls contract", () => {
  it("keeps only preferences with active runtime consumers", () => {
    for (const label of [
      "Terminal",
      "Entegre terminal kabuğu",
      "Oluşturucu",
      "Bağlam penceresi kullanımını göster",
    ]) {
      expect(general).toContain(label);
    }

    for (const removedLabel of [
      "Otonom ajan ortamı",
      "Varsayılan dosya açma hedefi",
      "Gönderme kısayolu",
      "Takip davranışı",
      "Açılır Pencere",
      "Projesiz görev için varsayılan yap",
      "Diğer AI uygulamalarından çalışmaları içe aktar",
      "Açık kaynak lisansları",
    ]) {
      expect(general).not.toContain(removedLabel);
    }
  });

  it("wires the remaining terminal and composer preferences", () => {
    expect(general).toContain('writeStorageValue("quake-web:terminalShell"');
    expect(terminal).toContain('readStorageValue("quake-web:terminalShell"');
    expect(terminal).toContain("defaultTerminalProfile()");
    expect(general).toContain("emitGeneralPreferencesChanged(next)");
    expect(contextUsage).toContain("GENERAL_PREFERENCES_CHANGED_EVENT");
  });

  it("keeps readable desktop sizing and accessible controls", () => {
    expect(general).toContain('role="switch"');
    expect(styles).toContain("width: min(100%, 820px)");
    expect(styles).toContain("font-size: 13px");
    expect(styles).toContain("min-height: 68px");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
