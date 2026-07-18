import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const general = readFileSync(join(root, "src/client/src/components/settings/GeneralSettings.tsx"), "utf8");
const terminal = readFileSync(join(root, "src/client/src/components/terminal/XtermTerminal.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/src/components/settings/GeneralSettings.module.css"), "utf8");

describe("general settings reference contract", () => {
  it("keeps every referenced General section and row", () => {
    for (const label of [
      "İzinler",
      "Varsayılan izinler",
      "Otomatik inceleme",
      "Tam erişim",
      "Varsayılan dosya açma hedefi",
      "Otonom ajan ortamı",
      "Entegre terminal kabuğu",
      "Dil",
      "Alt panel",
      "Diğer AI uygulamalarından çalışmaları içe aktar",
      "Açık kaynak lisansları",
      "Oluşturucu",
      "Bağlam penceresi kullanımını göster",
      "Gönderme kısayolu",
      "Takip davranışı",
      "Açılır Pencere",
      "Projesiz görev için varsayılan yap",
      "Bildirimler",
      "Tur tamamlama bildirimlerini etkinleştir",
      "İzin bildirimlerini etkinleştir",
      "Soru bildirimlerini etkinleştir",
    ]) {
      expect(general).toContain(label);
    }
  });

  it("wires real permission, notification and terminal preferences", () => {
    expect(general).toContain("onTerminalPolicy");
    expect(general).toContain("saveNotificationConfig");
    expect(general).toContain('writeStorageValue("quake-web:terminalShell"');
    expect(terminal).toContain('readStorageValue("quake-web:terminalShell"');
    expect(terminal).toContain("defaultTerminalProfile()");
  });

  it("uses readable desktop sizing and accessible controls", () => {
    expect(general).toContain('role="switch"');
    expect(general).toContain('role="group"');
    expect(styles).toContain("width: min(100%, 820px)");
    expect(styles).toContain("font-size: 13px");
    expect(styles).toContain("min-height: 68px");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
