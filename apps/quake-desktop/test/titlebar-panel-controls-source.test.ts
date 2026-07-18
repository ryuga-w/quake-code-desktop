import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("titlebar panel controls", () => {
  it("hides both panel toggles in a new chat and while settings are open", () => {
    const titlebar = readFileSync(
      join(root, "src/client/src/components/chrome/Titlebar.tsx"),
      "utf8",
    );
    const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");

    expect(titlebar).toContain("showPanelToggles = true");
    expect(titlebar).toContain("{showPanelToggles && (");
    expect(shell).toContain(
      'showPanelToggles={!settingsModalOpen && !(centerView === "chat" && !hasVisibleMessages)}',
    );
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
    expect(navStyles).toContain("background: var(--surface-navigation, #201e20)");
    expect(foundation).toContain("--surface-navigation: #f1eff1");
    expect(foundation).toContain("--font-navigation: 14.5px");
    expect(appSettings).toContain('setOverlay?.("#201e20", "#e8e8ea")');
    expect(appSettings).toContain('setOverlay?.("#f1eff1", "#1a1a1a")');
  });
});
