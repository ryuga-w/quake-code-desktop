import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("UI accessibility hardening contracts", () => {
  it("keeps a visible keyboard focus indicator in settings navigation", () => {
    const css = read("src/client/src/components/settings/SettingsPanels.module.css");
    const focusVisible = css.match(/\.settingsNavItem:focus-visible\s*\{([^}]*)\}/)?.[1] || "";

    expect(focusVisible).toMatch(/outline:\s*2px solid/);
    expect(focusVisible).not.toMatch(/outline:\s*(?:none|0)/);
  });

  it("documents the composer-scoped Plan shortcut", () => {
    const settings = read("src/client/src/components/settings/SettingsPanels.tsx");

    expect(settings).toContain('{ keys: "Shift + Tab", action: "Composer odaktayken Plan modunu aç/kapat" }');
  });

  it("focus-traps conditional session and file dialogs", () => {
    const focusHook = read("src/client/src/lib/modal-focus.ts");
    const sessions = read("src/client/src/components/sessions/SessionsPanel.tsx");
    const files = read("src/client/src/components/files/FilesPanel.tsx");

    expect(focusHook).toContain("active = true");
    expect(sessions).toContain("useModalFocusTrap<HTMLDivElement>(compareOpen)");
    expect(sessions).toContain("ref={compareDialogRef}");
    expect(files).toContain("useModalFocusTrap<HTMLFormElement>(Boolean(mutationDialog))");
    expect(files).toContain("ref={mutationDialogRef}");
  });
});
