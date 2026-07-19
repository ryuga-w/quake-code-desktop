import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("settings navigation", () => {
  it("keeps the application titlebar visible above full-page settings", () => {
    const shellCss = readFileSync(join(root, "src/client/styles.css"), "utf8");

    expect(shellCss).toContain("inset: var(--titlebar-height, 36px) 0 0");
    expect(shellCss).toMatch(/\.settings-dialog\s*\{[\s\S]*?height:\s*100%;/);
  });

  it("shares the main sidebar width and navigation surface tokens", () => {
    const css = readFileSync(join(root, "src/client/src/components/settings/SettingsPanels.module.css"), "utf8");

    expect(css).toContain("--settings-rail: var(--left-sidebar-width, 340px)");
    expect(css).toContain("background: var(--surface-navigation, #201e20)");
    expect(css).toContain("border-right: 1px solid var(--stroke-navigation, #343134)");
    expect(css).toContain("background: var(--surface-navigation-hover, #302d30)");
    expect(css).toContain("background: var(--surface-navigation-active, #363336)");
    expect(css).toContain("font-size: var(--font-navigation, 14.5px)");
    expect(css).toContain("min-height: 30px");
    expect(css).toContain("font-size: 12.5px");
  });

  it("renders the application return action above settings search", () => {
    const panel = readFileSync(join(root, "src/client/src/components/settings/SettingsPanels.tsx"), "utf8");
    const search = panel.indexOf("className={styles.navSearchWrap}");
    const back = panel.indexOf("className={styles.backToAppButton}");
    const navigation = panel.indexOf("className={styles.navScroll}");

    expect(back).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(back);
    expect(navigation).toBeGreaterThan(search);
    expect(panel).toContain("<span>Uygulamaya geri dön</span>");
    expect(panel).toContain("className={styles.backToAppButton} onClick={onClose}");
    expect(panel).not.toContain("settingsPageTop");
    expect(panel).not.toContain("settingsBackBtn");
  });

  it("SecuritySection ships isolation cards with honest Turkish titles", () => {
    const panel = readFileSync(join(root, "src/client/src/components/settings/SettingsPanels.tsx"), "utf8");
    expect(panel).toContain("Ajan ağ proxy (işbirlikçi)");
    expect(panel).toContain("İşletim sistemi izolasyonu");
    expect(panel).toContain("Paralel izole ajanlar (worktree)");
    expect(panel).toContain("Experimental OS sandbox bayrağı");
    expect(panel).toContain("Host (politika)");
    expect(panel).toContain("Experimental — helper yok (fail-closed)");
    expect(panel).toContain("/api/security/agent-http-proxy");
    expect(panel).toContain("/api/security/os-sandbox");
    // Only mention Windows Sandbox to deny the claim — never as a product label alone.
    expect(panel).toMatch(/Windows Sandbox.*değildir/);
    expect(panel).not.toMatch(/title:\s*["']Windows Sandbox["']/);
    // S-OS.3: PTY excluded from OS isolation + worktree honesty.
    expect(panel).toMatch(/PTY.*OS izolasyonu dışındadır|PTY.*sandboxed değildir/);
    expect(panel).toMatch(/worktree izolasyonunu atlayabilir/);
  });

  it("keeps PTY isolation details in settings instead of the terminal surface", () => {
    const xterm = readFileSync(join(root, "src/client/src/components/terminal/XtermTerminal.tsx"), "utf8");
    const panel = readFileSync(join(root, "src/client/src/components/settings/SettingsPanels.tsx"), "utf8");
    expect(xterm).not.toContain("PTY_ISOLATION_NOTICE_TR");
    expect(xterm).not.toContain("pty-isolation-banner");
    expect(xterm).not.toContain("OS sandbox dışı");
    expect(xterm).not.toContain("paintIsolationBanner");
    expect(panel).toMatch(/PTY.*OS izolasyonu dışındadır|PTY.*sandboxed değildir/);
  });
});
