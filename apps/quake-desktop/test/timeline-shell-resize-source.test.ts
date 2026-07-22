import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clampLeftSidebarWidth,
  LEFT_SIDEBAR_CLOSE_THRESHOLD,
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
} from "../src/client/src/lib/layout-sizing";

const root = process.cwd();
const electronMain = readFileSync(join(root, "electron/main.ts"), "utf8");
const app = readFileSync(join(root, "src/client/src/app/App.tsx"), "utf8");
const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");
const titlebar = readFileSync(join(root, "src/client/src/components/chrome/Titlebar.tsx"), "utf8");
const titlebarStyles = readFileSync(join(root, "src/client/src/components/chrome/Titlebar.module.css"), "utf8");
const navStyles = readFileSync(join(root, "src/client/src/components/chrome/NavRail.module.css"), "utf8");
const foundation = readFileSync(join(root, "src/client/foundation.css"), "utf8");
const settings = readFileSync(join(root, "src/client/src/components/settings/SettingsPanels.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/styles.css"), "utf8") + readFileSync(join(root, "src/client/styles/themes.css"), "utf8");
const responsive = readFileSync(join(root, "src/client/styles-responsive.css"), "utf8");

describe("timeline shell and left sidebar sizing", () => {
  it("uses the compact titlebar height across web and native chrome", () => {
    expect(foundation).toContain("--titlebar-height: 36px");
    expect(titlebarStyles).toContain("height: var(--titlebar-height, 36px)");
    expect(titlebarStyles).toContain("top: calc(var(--titlebar-height, 36px) + 1px)");
    expect(responsive).toContain("top: var(--titlebar-height, 36px)");
    expect(electronMain.match(/height: 36/g)).toHaveLength(2);
  });

  it("frames only the desktop chat surface with the reference corner", () => {
    expect(shell).toContain('centerView === "chat" ? "chat-workspace"');
    expect(styles).toContain("#app.chat-workspace:not(.browser-layout-focus) > .main.chat-active");
    expect(styles).toContain("border-radius: 14px 0 0 0");
    expect(styles).toContain("border-top: 1px solid");
    expect(styles).toContain("background: var(--surface-timeline, var(--bg))");
    expect(styles).toContain("background: var(--surface-navigation, var(--paper-soft))");
    expect(styles).toContain("border-left: 1px solid var(--stroke-workspace, #252628)");
    expect(styles).toContain("box-shadow: none");
    expect(foundation).toContain("--surface-navigation: #f1eff1");
    expect(foundation).toContain("--surface-timeline: #ffffff");
    expect(foundation).toContain("--stroke-workspace: #252628");
    expect(responsive).toContain("border-radius: 0");
  });

  it("keeps the dark right dock on the exact timeline surface", () => {
    expect(foundation).toContain("--surface-timeline: #101112");
    expect(styles).toMatch(
      /\[data-theme="dark"\] \.rightbar \{[\s\S]*?background: var\(--surface-timeline, var\(--bg\)\);/,
    );
  });

  it("limits the titlebar fade to the shared timeline text column", () => {
    expect(titlebar).toContain("showTimelineFade &&");
    expect(shell).toContain('showTimelineFade={!settingsModalOpen && centerView === "chat" && hasVisibleMessages');
    expect(shell).toContain('"--active-left-sidebar-width"');
    expect(titlebarStyles).toContain("left: var(--left-sidebar-preview-width, var(--active-left-sidebar-width, 0px))");
    expect(titlebarStyles).toContain("right: var(--dock-w, 0px)");
    expect(titlebarStyles).toContain("top: calc(var(--titlebar-height, 36px) + 1px)");
    expect(titlebarStyles).toContain(".edgeFade::before");
    expect(titlebarStyles).toContain("var(--surface-timeline, var(--bg, #f0f0f0))");
    expect(titlebarStyles).toContain("var(--chat-column-max-width, 736px)");
  });

  it("keeps expanded sizing bounded while allowing a little more width", () => {
    expect(LEFT_SIDEBAR_CLOSE_THRESHOLD).toBe(240);
    expect(LEFT_SIDEBAR_MIN_WIDTH).toBe(280);
    expect(LEFT_SIDEBAR_DEFAULT_WIDTH).toBe(340);
    expect(LEFT_SIDEBAR_MAX_WIDTH).toBe(500);
    expect(clampLeftSidebarWidth(120)).toBe(280);
    expect(clampLeftSidebarWidth(352.4)).toBe(352);
    expect(clampLeftSidebarWidth(480)).toBe(480);
    expect(clampLeftSidebarWidth(900)).toBe(500);
    expect(clampLeftSidebarWidth(Number.NaN)).toBe(340);
  });

  it("persists and exposes pointer and keyboard accessible resizing", () => {
    expect(app).toContain('readStorageValue("quake-web:leftWidth")');
    expect(app).toContain('writeStorageValue("quake-web:leftWidth"');
    expect(settings).toContain('"quake-web:leftWidth"');
    expect(shell).toContain('className="left-resize-handle"');
    expect(shell).toContain('role="separator"');
    expect(shell).toContain('aria-orientation="vertical"');
    expect(shell).toContain("handleLeftResizeKey");
    expect(shell).toContain("nextWidth <= LEFT_SIDEBAR_CLOSE_THRESHOLD");
    expect(shell).toContain("if (collapseReady) {");
    expect(shell).toContain("toggleLeftPanel();");
    expect(shell).toContain('style.setProperty("--left-sidebar-preview-width"');
    expect(shell).toContain('style.removeProperty("--left-sidebar-preview-width")');
    expect(shell).toContain('appGridRef.current?.style.removeProperty("--left-sidebar-width")');
    expect(styles).toContain("var(--left-sidebar-preview-width, var(--left-sidebar-width, 340px))");
    expect(shell).toContain("Sola sürükleyerek kapat");
    expect(shell).toContain("onDoubleClick");
    expect(styles).toContain("left-sidebar-collapse-ready");
    expect(styles).toContain("--left-sidebar-width");
    expect(responsive).toContain(".left-resize-handle");
  });

  it("keeps both desktop side panels mounted for smooth open and close transitions", () => {
    expect(navStyles).not.toContain("display: none !important");
    expect(foundation).toContain("--duration-panel: 280ms");
    expect(foundation).toContain("--ease-panel: cubic-bezier(0.22, 1, 0.36, 1)");
    expect(navStyles).toContain("transform: translateX(-20px)");
    expect(navStyles).toContain("visibility 0s linear var(--duration-panel, 280ms)");
    expect(styles).not.toContain("#app.right-collapsed .rightbar { display: none; }");
    expect(styles).toContain("#app.right-collapsed .rightbar {");
    expect(styles).toContain("transform: translateX(20px)");
    expect(styles).toContain("grid-template-columns var(--duration-panel, 280ms)");
    expect(styles).toContain("visibility 0s linear var(--duration-panel, 280ms)");
    expect(titlebarStyles).toContain("left var(--duration-panel, 280ms) var(--ease-panel, ease)");
  });

  it("keeps the settings shortcut hover theme-aware", () => {
    expect(navStyles).toContain("background: var(--surface-navigation-hover, #302d30)");
    expect(navStyles).toContain(':global([data-theme="light"]) .settingsRow:hover');
    expect(navStyles).toContain("background: var(--surface-navigation-hover, #e5e2e5)");
    expect(navStyles).toContain("color: var(--text-navigation, #2c292c) !important");
  });

  it("keeps the resize hit target invisible until interaction", () => {
    expect(styles).toMatch(/\.left-resize-handle::after \{[\s\S]*?background: transparent;/);
    expect(styles).toMatch(/\.left-resize-handle:hover::after,[\s\S]*?background: var\(--stroke-workspace, #252628\);/);
  });
});
