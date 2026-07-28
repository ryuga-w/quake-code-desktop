import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const panel = readFileSync(join(root, "src/client/src/components/settings/SettingsPanels.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/src/components/settings/SettingsPanels.module.css"), "utf8");
const providerStyles = readFileSync(join(root, "src/client/src/components/settings/ProvidersSection.module.css"), "utf8");

describe("settings page layout consistency", () => {
  it("uses one content shell for every non-specialized settings view", () => {
    for (const view of [
      "goal-mode",
      "permissions",
      "models",
      "providers",
      "computer-use",
      "mcp",
      "shortcuts",
      "about",
      "customizations",
      "app",
      "advanced",
    ]) {
      expect(panel).toMatch(
        new RegExp(`view === "${view}"[\\s\\S]{0,180}<div className=\\{styles\\.settingsViewContent\\}>`),
      );
    }

    expect(panel).not.toContain("styles.appearanceContent");
  });

  it("shares the reference width, top rhythm, cards and rows across views", () => {
    expect(styles).toContain("--settings-content-width: 820px");
    expect(styles).toContain("--settings-page-gap: 30px");
    expect(styles).toContain("--settings-row-min-height: 68px");
    expect(styles).toContain("padding: clamp(34px, 6vh, 58px)");
    expect(styles).toMatch(/\.settingsViewContent\s*\{[\s\S]*?display:\s*grid;[\s\S]*?gap:\s*var\(--settings-page-gap\)/);
    expect(styles).toMatch(/\.settingsContent > \*\s*\{[\s\S]*?var\(--settings-content-width\)/);
    expect(styles).toContain("border-radius: var(--settings-card-radius)");
    expect(styles).not.toContain('data-settings-view="appearance"');
    expect(providerStyles).toContain("border-radius: 13px");
    expect(providerStyles).toContain("font-size: 13px");
    expect(providerStyles).toContain("background: color-mix(in srgb, var(--elev-1) 90%, transparent)");
  });

  it("normalizes legacy rows, controls, providers, and narrow layouts", () => {
    expect(styles).toContain("Reference-aligned settings surfaces");
    expect(styles).toContain(".settingsViewContent .card > h3");
    expect(styles).toContain("min-height: var(--settings-row-min-height)");
    expect(styles).toContain("min-height: var(--settings-control-height)");
    expect(styles).toContain("background: #d946ef");
    expect(styles).toContain(".settingsViewContent .mcpForm");
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(styles).toContain("@media (pointer: coarse)");
    expect(providerStyles).toMatch(/\.grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(providerStyles).toContain("min-height: 68px");
    expect(providerStyles).toContain("border-top: 1px solid var(--border)");
  });
});
