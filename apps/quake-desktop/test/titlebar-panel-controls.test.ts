import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Titlebar } from "../src/client/src/components/chrome/Titlebar";

const root = process.cwd();

describe("titlebar panel controls", () => {
  const renderTitlebar = () => renderToStaticMarkup(
    React.createElement(Titlebar, {
      leftOpen: true,
      onToggleSidebar: () => {},
      onOpenSessions: () => {},
      workspaceName: "quake-desktop",
      workspacePath: root,
    }),
  );

  it("does not render direct panel toggle buttons in the titlebar", () => {
    const markup = renderTitlebar();

    expect(markup).not.toContain('aria-label="Alt paneli aç/kapat"');
    expect(markup).not.toContain('aria-label="Sağ paneli aç/kapat"');
  });

  it("routes the terminal control through the workspace controls", () => {
    const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");

    expect(shell).toContain("onToggleTerminal={toggleBottomPanel}");
    expect(shell).toContain("terminalOpen={bottomOpen}");
    expect(shell).not.toContain("showPanelToggles=");
  });
});
