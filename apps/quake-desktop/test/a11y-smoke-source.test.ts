/**
 * Lightweight a11y source contracts (S-A11Y.1) — not a full axe run.
 * Ensures critical dialogs/panels keep role/name hooks and key Turkish copy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("a11y smoke source contracts", () => {
  it("trust onboarding dialog has dialog semantics", () => {
    const src = read("src/client/src/components/security/TrustOnboardingModal.tsx");
    expect(src).toMatch(/role=["']dialog["']/);
    expect(src).toMatch(/aria-modal/);
    expect(src).toContain("Güven ve erişim");
    expect(src).toContain("Anladım");
    expect(src).toContain("İzinler'e git");
    expect(src).toContain("aria-labelledby");
  });

  it("trust modal keeps workspace / worktree / OS sandbox honesty copy", () => {
    const src = read("src/client/src/components/security/TrustOnboardingModal.tsx");
    expect(src).toContain("Çalışma alanı sınırı");
    expect(src).toContain("Paralel ajanlar (worktree)");
    expect(src).toMatch(/Windows Sandbox/);
    expect(src).toContain("İsteğe bağlı ağ proxy");
  });

  it("agents panel exposes labeled region and activity list hooks", () => {
    const src = read("src/client/src/components/agents/AgentsPanel.tsx");
    expect(src).toContain('data-testid="agents-panel"');
    expect(src).toMatch(/aria-label=["']Paralel ajanlar["']/);
    expect(src).toContain("agents-activity");
    expect(src).toContain("Konuşma");
    expect(src).toContain('data-testid="agents-thread-label"');
    expect(src).toContain('data-testid="agents-activity-list"');
    expect(src).toContain('data-testid="agents-activity-pane"');
  });

  it("subagent split workspace exposes standard tabs, composer, and create controls", () => {
    const src = read("src/client/src/components/agents/SubagentWorkspace.tsx");
    const tabPortal = read("src/client/src/components/shell/DockPanelTabPortal.tsx");
    const composer = read("src/client/src/components/composer/DockConversationComposer.tsx");
    const rightTabs = read("src/client/src/components/shell/RightPanelTabs.tsx");
    expect(src).toContain('data-testid="subagent-workspace"');
    expect(src).toContain('aria-label="Subagent çalışma alanı"');
    expect(src).toContain('aria-label="Yeni subagent oluştur"');
    expect(src).toContain('ariaLabel="Subagent mesajı"');
    expect(tabPortal).toContain('role="tab"');
    expect(tabPortal).toContain('aria-selected={active}');
    expect(composer).toContain("stopLabel");
    expect(rightTabs).toContain('aria-label={t("rightPanel.closeRightPanel")}');
  });

  it("settings permissions surface keeps Kalıcı izinler card", () => {
    const src = read("src/client/src/components/settings/SettingsPanels.tsx");
    expect(src).toContain("Kalıcı izinler");
    expect(src).toContain("GuardianDurableAllowsSection");
    expect(src).toContain("/api/security/guardian-allows");
    expect(src).toContain("Tümünü temizle");
  });

  it("keeps PTY isolation metadata server-side without repeating a terminal warning", () => {
    const terminal = read("src/client/src/components/terminal/XtermTerminal.tsx");
    expect(terminal).not.toContain('data-testid="pty-isolation-banner"');
    expect(terminal).not.toContain("PTY_ISOLATION_NOTICE_TR");
    expect(terminal).not.toContain("OS sandbox dışı");

    const server = read("src/server/terminal-pty.ts");
    expect(server).toContain("PTY_ISOLATION_NOTICE_TR");
    expect(server).toMatch(/Etkileşimli terminal OS sandboxed değildir/);
  });

  it("composer approval and confirm patterns keep accessible controls", () => {
    const approval = read("src/client/src/components/security/ComposerApproval.tsx");
    expect(approval.length).toBeGreaterThan(100);
    // Buttons should be real <button> elements for keyboard
    expect(approval).toContain("<button");
    expect(approval).toContain('t("runtime.approval.always")');
    expect(approval).toContain('t("runtime.approval.alwaysDescription")');
  });
});
