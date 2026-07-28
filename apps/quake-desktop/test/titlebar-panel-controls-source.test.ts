import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("titlebar panel controls", () => {
  it("keeps direct panel controls out of the titlebar", () => {
    const titlebar = readFileSync(
      join(root, "src/client/src/components/chrome/Titlebar.tsx"),
      "utf8",
    );
    const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");

    expect(titlebar).not.toContain("showPanelToggles");
    expect(titlebar).not.toContain('aria-label="Alt paneli aç/kapat"');
    expect(titlebar).not.toContain('aria-label="Sağ paneli aç/kapat"');
    expect(titlebar).toContain('label: t("common.titlebar.view")');
    expect(titlebar).toContain('action: "toggle-sidebar"');
    expect(titlebar).toContain('action: "toggle-bottom-panel"');
    expect(titlebar).toContain('action: "toggle-right-panel"');
    expect(shell).toContain("onToggleTerminal={toggleBottomPanel}");
    expect(shell).toContain("terminalOpen={bottomOpen}");
  });

  it("uses one opaque navigation surface for the titlebar, sidebar and window controls", () => {
    const titlebarStyles = readFileSync(
      join(root, "src/client/src/components/chrome/Titlebar.module.css"),
      "utf8",
    );
    const navStyles = readFileSync(
      join(root, "src/client/src/components/chrome/NavRail.module.css"),
      "utf8",
    );
    const foundation = readFileSync(join(root, "src/client/foundation.css"), "utf8");
    const appSettings = readFileSync(
      join(root, "src/client/src/app/hooks/useAppSettings.ts"),
      "utf8",
    );

    expect(titlebarStyles).toContain("background: var(--surface-navigation, #201e20)");
    expect(titlebarStyles).not.toContain("backdrop-filter:");
    expect(titlebarStyles).not.toContain("border-bottom:");
    expect(titlebarStyles).toContain(".projectContextSidebarOpen { display: none; }");
    expect(navStyles).toContain("background: var(--surface-navigation, #201e20)");
    expect(foundation).toContain("--surface-navigation: #0d0e0f");
    expect(foundation).toContain("--surface-navigation-hover: #171819");
    expect(foundation).toContain("--surface-navigation-active: #202124");
    expect(foundation).toContain("--stroke-navigation: #202124");
    expect(foundation).toContain("--stroke-workspace: #252628");
    expect(foundation).toContain("--surface-navigation: #f1eff1");
    expect(foundation).toContain("--font-navigation: 14.5px");
    expect(appSettings).toContain('setOverlay?.("#0d0e0f", "#e8e8ea")');
    expect(appSettings).toContain('setOverlay?.("#f1eff1", "#1a1a1a")');
  });
});
