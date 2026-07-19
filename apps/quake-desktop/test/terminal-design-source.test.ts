import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const bottomPanel = read("src/client/src/components/chrome/BottomPanel.tsx");
const bottomStyles = read("src/client/src/components/chrome/BottomPanel.module.css");
const terminal = read("src/client/src/components/terminal/XtermTerminal.tsx");
const terminalStyles = read("src/client/src/components/terminal/XtermTerminal.module.css");
const foundation = read("src/client/foundation.css");

describe("Quake terminal visual contract", () => {
  it("uses the product charcoal surface hierarchy", () => {
    expect(foundation).toContain("--surface-terminal: var(--surface-navigation)");
    expect(foundation).toContain("--surface-terminal-raised: var(--surface-navigation)");
    expect(foundation).toContain("--surface-terminal-active: var(--surface-navigation-hover)");
    expect(bottomStyles).toContain("background: var(--surface-terminal, #0d0e0f)");
    expect(terminalStyles).toContain("background: var(--surface-terminal-raised, #101112)");
    expect(terminal).toContain('tok("--surface-terminal", "#0d0e0f")');
    expect(terminalStyles).not.toContain("backdrop-filter");
    expect(terminalStyles).not.toContain("linear-gradient");
  });

  it("keeps connection color out of terminal tabs", () => {
    expect(terminal).not.toContain('<span className={`${styles.stateDot} ${styles[tab.metadata.state]}`}');
    expect(terminalStyles).toContain(".connected { background: var(--text-terminal-muted, var(--muted)); }");
  });

  it("keeps the shell compact, responsive, and keyboard operable", () => {
    expect(bottomPanel).toContain('aria-label="Terminal alt panel"');
    expect(bottomPanel).not.toContain("<strong>Terminal</strong>");
    expect(bottomPanel).not.toContain("Yerel PTY");
    expect(bottomPanel).toContain('typeof children === "function" ? children(panelControls)');
    expect(terminal).toContain("panelControls?: React.ReactNode");
    expect(bottomPanel).toContain("onHandleKeyDown");
    expect(bottomPanel).toContain("aria-valuenow={Math.round(innerHeight)}");
    expect(bottomStyles).toContain("container-name: terminal-panel");
    expect(terminalStyles).toContain("@container terminal-panel (max-height: 230px)");
    expect(terminalStyles).toContain("@media (max-width: 560px)");
  });

  it("uses semantic tabs, menus, and persistent compact actions", () => {
    expect(terminal).toContain('role="tablist"');
    expect(terminal).toContain('role="tabpanel"');
    expect(terminal).toContain("onTabListKeyDown");
    expect(terminal).toContain('role="toolbar"');
    expect(terminal).toContain("handleMenuKeyDown");
    expect(terminal).toContain("focusFirstMenuItem");
    expect(terminal).toContain('className={styles.actionLabel}');
    expect(terminalStyles).toContain(".actionLabel");
  });
});
