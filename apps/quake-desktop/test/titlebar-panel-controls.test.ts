import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Titlebar } from "../src/client/src/components/chrome/Titlebar";

const root = process.cwd();

describe("titlebar panel controls", () => {
  const renderTitlebar = (showPanelToggles: boolean) => renderToStaticMarkup(
    React.createElement(Titlebar, {
      leftOpen: true,
      onToggleSidebar: () => {},
      onOpenSessions: () => {},
      workspaceName: "quake-desktop",
      workspacePath: root,
      showPanelToggles,
    }),
  );

  it("omits both panel toggle buttons when controls are hidden", () => {
    const hidden = renderTitlebar(false);
    const visible = renderTitlebar(true);

    expect(hidden).not.toContain('aria-label="Alt paneli aç/kapat"');
    expect(hidden).not.toContain('aria-label="Sağ paneli aç/kapat"');
    expect(visible).toContain('aria-label="Alt paneli aç/kapat"');
    expect(visible).toContain('aria-label="Sağ paneli aç/kapat"');
  });

  it("hides both panel toggles in a new chat and while settings are open", () => {
    const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");

    expect(shell).toContain(
      'showPanelToggles={!settingsModalOpen && !(centerView === "chat" && !hasVisibleMessages)}',
    );
  });
});
