import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const browserPanel = readFileSync(join(root, "src/client/src/components/dock/BrowserPanel.tsx"), "utf8");
const browserStyles = readFileSync(join(root, "src/client/src/components/dock/BrowserPanel.module.css"), "utf8");
const rightTabs = readFileSync(join(root, "src/client/src/components/shell/RightPanelTabs.tsx"), "utf8");
const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/styles.css"), "utf8");
const responsive = readFileSync(join(root, "src/client/styles-responsive.css"), "utf8");
const foundation = readFileSync(join(root, "src/client/foundation.css"), "utf8");
const electronMain = readFileSync(join(root, "electron/main.ts"), "utf8");
const preload = readFileSync(join(root, "electron/preload.ts"), "utf8");
const appSettings = readFileSync(join(root, "src/client/src/app/hooks/useAppSettings.ts"), "utf8");

describe("reference browser panel chrome", () => {
  it("uses a compact two-row browser surface instead of nested cards", () => {
    expect(styles).toContain('data-active-panel="browser"');
    expect(styles).toContain("flex: 0 0 48px");
    expect(styles).toContain("background: var(--surface-browser-tab, var(--panel-2))");
    expect(browserStyles).toContain("flex: 0 0 40px");
    expect(browserStyles).toContain("grid-template-columns: minmax(86px, 1fr) minmax(100px, 2fr) minmax(86px, 1fr)");
    expect(browserStyles).toContain("border-radius: 0");
  });

  it("centers a compact hostname and keeps Enter navigation", () => {
    expect(browserPanel).toContain("function compactAddress");
    expect(browserPanel).toContain("addressFocused ? draft : compactAddress(draft)");
    expect(browserPanel).toContain("event.preventDefault(); go();");
    expect(browserPanel).not.toContain("styles.goBtn");
    expect(browserStyles).toContain("text-align: center");
    expect(browserStyles).toContain("border: 1px solid transparent");
    expect(browserStyles).toContain(".addressForm:focus-within");
    expect(browserStyles).toContain("border-color: transparent");
    expect(browserStyles).toContain(".address:focus-visible");
    expect(browserStyles).toContain("box-shadow: none");
  });

  it("shows live page identity in the browser tab", () => {
    expect(electronMain).toContain('title: browserView?.webContents.getTitle() || ""');
    expect(browserPanel).toContain("onMetadataChange?.({");
    expect(shell).toContain('browserTitle={browserTabMetadata.title || t("runtime.shell.browser")}');
    expect(shell).toContain("onMetadataChange={setBrowserTabMetadata}");
    expect(rightTabs).toContain("getBrowserFavicon");
    expect(rightTabs).toContain('className="dock-tab-favicon"');
    expect(rightTabs).toContain('active === "browser" ? "dock-header-browser"');
  });

  it("matches the reference actions and remains theme responsive", () => {
    expect(browserPanel).toContain("<CirclePlus");
    expect(browserPanel).toContain("<EllipsisVertical");
    expect(rightTabs).toContain('className="browser-chrome-close"');
    expect(foundation).toContain("--surface-browser-chrome: #ffffff");
    expect(foundation).toContain("--surface-browser-tab: #f1eff1");
    expect(responsive).toContain('#app .rightbar[data-active-panel="browser"]');
  });

  it("expands the live element picker to the left as a note pill", () => {
    expect(browserPanel).toContain("styles.inspectorToggle");
    expect(browserPanel).toContain('<span className={styles.inspectorLabel}>Not ekleme</span>');
    expect(browserStyles).toContain("justify-content: flex-end");
    expect(browserStyles).toContain("width: 54px");
    expect(browserStyles).toContain("transform-origin: right center");
    expect(browserStyles).toContain("width: 110px");
    expect(browserStyles).toContain("background: var(--surface-browser-note, #fbe7ff)");
    expect(foundation).toContain("--surface-browser-note: #fbe7ff");
  });

  it("keeps the native page fixed by fitting a compact menu inside browser chrome", () => {
    expect(rightTabs).toContain('active === "browser" ? "dock-add-menu-browser" : ""');
    expect(styles).toContain(".dock-add-menu-browser");
    expect(styles).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(styles).toContain("height: 34px");
    expect(styles).not.toContain(".dock-header-browser.dock-header-add-open");
    expect(browserPanel).not.toContain("chromeMenuOpen");
    expect(shell).not.toContain("chromeMenuOpen={dockAddOpen}");
  });

  it("uses Quake's resolved theme for native browser color preference", () => {
    expect(appSettings).toContain("desktop?.setResolvedTheme?.(theme)");
    expect(preload).toContain('ipcRenderer.send("theme:setResolved", theme)');
    expect(electronMain).toContain('ipcMain.on("theme:setResolved"');
    expect(electronMain).toContain('theme !== "light" && theme !== "dark"');
    expect(electronMain).toContain("nativeTheme.themeSource = theme");
  });
});
