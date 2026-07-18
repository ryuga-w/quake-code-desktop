import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const launcher = readFileSync(join(root, "src/client/src/components/chrome/QuickLauncher.tsx"), "utf8");
const launcherStyles = readFileSync(join(root, "src/client/src/components/chrome/QuickLauncher.module.css"), "utf8");
const rightTabs = readFileSync(join(root, "src/client/src/components/shell/RightPanelTabs.tsx"), "utf8");
const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");
const dock = readFileSync(join(root, "src/client/src/app/hooks/useRightDock.ts"), "utf8");
const keyboard = readFileSync(join(root, "src/client/src/app/hooks/useAppKeyboard.ts"), "utf8");
const globalStyles = readFileSync(join(root, "src/client/styles.css"), "utf8");

describe("Codex reference right-panel launcher", () => {
  it("uses the reference item order, labels, and shortcuts", () => {
    const panelItems = launcher.slice(launcher.indexOf("const PANEL_ITEMS"), launcher.indexOf("/**\n * Props:"));
    const files = panelItems.indexOf('label: "Dosyalar"');
    const subtask = panelItems.indexOf('label: "Yan görev"');
    const browser = panelItems.indexOf('label: "Tarayıcı"');
    const terminal = panelItems.indexOf('label: "Terminal"');

    expect(files).toBeGreaterThan(-1);
    expect(files).toBeLessThan(subtask);
    expect(subtask).toBeLessThan(browser);
    expect(browser).toBeLessThan(terminal);
    expect(panelItems).toContain('shortcut: "Ctrl+P"');
    expect(panelItems).toContain('shortcut: "Ctrl+Alt+S"');
    expect(panelItems).toContain('shortcut: "Ctrl+T"');
    expect(panelItems).not.toContain('label: "Mobil"');
    expect(launcher).toContain('panel: "mobile", label: "Mobil"');
  });

  it("renders a narrow borderless list centered in the empty panel", () => {
    expect(launcherStyles).toContain("justify-content: center;");
    expect(launcherStyles).toContain("width: min(376px, 100%);");
    expect(launcherStyles).toContain("gap: 10px;");
    expect(launcherStyles).toMatch(/\.panelItem \{[\s\S]*?border: 0;/);
    expect(launcherStyles).toMatch(/\.panelItem \.kbd \{[\s\S]*?border: 0;[\s\S]*?border-radius: 999px;/);
  });

  it("replaces launcher plus and close chrome with expand and panel controls", () => {
    expect(rightTabs).toContain('const isLauncher = active === "launcher"');
    expect(rightTabs).toContain("!isLauncher && <React.Fragment>");
    expect(rightTabs).toContain("<Maximize2");
    expect(rightTabs).toContain("<PanelRight");
    expect(rightTabs).toContain("onToggleLauncherExpand");
    expect(dock).toContain("function toggleRightPanelExpanded()");
    expect(dock).toContain("rightPanelExpanded");
  });

  it("opens the tab plus menu as the compact reference launcher", () => {
    const files = rightTabs.indexOf('tab: "files", label: "Dosyalar"');
    const subtask = rightTabs.indexOf('tab: "sidechat", label: "Yan görev"');
    const browser = rightTabs.indexOf('tab: "browser", label: "Tarayıcı"');

    expect(files).toBeGreaterThan(-1);
    expect(files).toBeLessThan(subtask);
    expect(subtask).toBeLessThan(browser);
    expect(rightTabs).toContain('shortcut: "Ctrl+P"');
    expect(rightTabs).toContain('shortcut: "Ctrl+Alt+S"');
    expect(rightTabs).toContain('shortcut: "Ctrl+T"');
    expect(rightTabs).toContain("createPortal(");
    expect(globalStyles).toContain("width: min(280px, calc(100vw - 16px))");
    expect(globalStyles).toContain("grid-template-columns: 20px minmax(0, 1fr) auto");
    expect(globalStyles).toContain('[data-theme="light"] .dock-add-menu');
  });

  it("removes the launcher scrollbar and dark light-theme residue", () => {
    expect(shell).toContain('data-active-panel={rightTab}');
    expect(globalStyles).toMatch(/\.rightbar\[data-active-panel="launcher"\] \{[\s\S]*?overflow: hidden;[\s\S]*?background: var\(--bg\);/);
    expect(globalStyles).toMatch(/\[data-theme="light"\] \.rightbar\[data-active-panel="launcher"\] \{[\s\S]*?background: #ffffff;/);
  });

  it("backs every displayed shortcut with a global keyboard route", () => {
    expect(keyboard).toContain('event.key.toLowerCase() === "p"');
    expect(keyboard).toContain('h.openRightPanel("files")');
    expect(keyboard).toContain('event.key.toLowerCase() === "t"');
    expect(keyboard).toContain('h.openRightPanel("browser")');
    expect(keyboard).toContain('event.altKey && event.key.toLowerCase() === "s"');
    expect(keyboard).toContain('h.openRightPanel("sidechat")');
  });
});
