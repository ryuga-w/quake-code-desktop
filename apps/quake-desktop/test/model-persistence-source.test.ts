import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const main = readFileSync(join(root, "src/client/src/app/App.tsx"), "utf8");
const composerModels = readFileSync(join(root, "src/client/src/app/hooks/useComposerModels.ts"), "utf8");
const sessionWorkspace = readFileSync(join(root, "src/client/src/app/hooks/useSessionWorkspace.ts"), "utf8");
const settingsPanel = readFileSync(join(root, "src/client/src/components/settings/SettingsPanels.tsx"), "utf8");
const runtime = readFileSync(join(root, "src/server/runtime.ts"), "utf8");
const webSettings = readFileSync(join(root, "src/server/web-settings.ts"), "utf8");

describe("model persistence contracts", () => {
  it("flushes the selected model to global agent settings", () => {
    expect(runtime).toContain("await this.session.setModel(model)");
    expect(runtime).toContain("await this.session.settingsManager.flush()");
  });

  it("persists and restores the composer model allowlist", () => {
    expect(webSettings).toContain("pinnedComposerModels?: string[]");
    expect(webSettings).toContain('"desktop-settings.json"');
    expect(webSettings).toContain("One-time migration from the former workspace-scoped model preferences");
    expect(settingsPanel).toContain('apiPost("/api/web-settings", { pinnedComposerModels: next })');
    expect(settingsPanel).toContain('apiGet<any>("/api/web-settings")');
    expect(main).toContain("useComposerModels");
    expect(composerModels).toContain("result?.settings?.pinnedComposerModels");
  });

  it("persists terminal policy via web-settings and restores on boot", () => {
    const serverIndex = readFileSync(join(root, "src/server/index.ts"), "utf8");
    expect(webSettings).toContain('terminalPolicyMode?: TerminalPolicyModeSetting');
    expect(webSettings).toContain("sanitizeTerminalPolicyMode");
    expect(serverIndex).toContain("initialWebSettings.terminalPolicyMode");
    expect(serverIndex).toContain("await webSettings.patch({ terminalPolicyMode })");
    expect(sessionWorkspace).toContain('type: "fork_session"');
    expect(main).toContain("forkSessionFromMessage");
    expect(settingsPanel).toContain("Seçiminiz kaydedilir");
  });
});
