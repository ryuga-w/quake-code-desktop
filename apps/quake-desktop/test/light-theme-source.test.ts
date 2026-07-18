import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const appStyles = readFileSync(join(root, "src/client/styles.css"), "utf8");
const composerStyles = readFileSync(join(root, "src/client/src/components/composer/ChatComposer.module.css"), "utf8");
const queueStyles = readFileSync(join(root, "src/client/src/components/composer/ComposerQueue.module.css"), "utf8");
const planQuestionStyles = readFileSync(join(root, "src/client/src/components/plan/PlanQuestionsPanel.module.css"), "utf8");
const approvalStyles = readFileSync(join(root, "src/client/src/components/security/ComposerApproval.module.css"), "utf8");
const confirmStyles = readFileSync(join(root, "src/client/src/components/common/ConfirmDialog.module.css"), "utf8");

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrast(first: string, second: string): number {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("light theme source contract", () => {
  it("gives composer input and placeholder accessible light-theme contrast", () => {
    expect(appStyles).toContain("--composer-text: #1c1c1e;");
    expect(appStyles).toContain("--composer-placeholder: #747479;");
    expect(contrast("#1c1c1e", "#ffffff")).toBeGreaterThan(12);
    expect(contrast("#747479", "#ffffff")).toBeGreaterThan(4.5);
    expect(composerStyles).toContain("color: var(--composer-text, var(--text-primary, var(--heading)));");
    expect(composerStyles).toContain("color: var(--composer-placeholder, var(--text-muted, var(--muted)));");
    expect(composerStyles).not.toContain("color: #e8e8e8;");
  });

  it("themes compact and browser-focus composer variants instead of forcing dark surfaces", () => {
    expect(composerStyles).toContain("background: var(--composer-compact-surface, #242424);");
    expect(composerStyles).toContain("background: var(--composer-focus-surface, #292729);");
    expect(composerStyles).toContain(':global([data-theme="light"]) :global(#composer).composer');
    expect(appStyles).toContain("--composer-compact-surface: #ffffff;");
    expect(appStyles).toContain("--composer-focus-surface: #ffffff;");
    expect(appStyles).toMatch(/\[data-theme="light"\] \{[\s\S]*?--user-bubble-bg: var\(--surface-navigation\);/);
  });

  it("keeps adjacent chat surfaces on semantic theme tokens", () => {
    expect(appStyles).toMatch(/\.slash-autocomplete,\s*\.context-chips \{[\s\S]*?background: var\(--surface-raised, var\(--panel-2\)\);/);
    expect(appStyles).toMatch(/\.empty-timeline h2 \{\s*color: var\(--heading\);/);
    expect(planQuestionStyles).toContain("background: var(--surface-overlay, var(--panel));");
    expect(planQuestionStyles).toContain("background: var(--surface-raised, var(--panel-2));");
    expect(planQuestionStyles).not.toContain("background: #191919;");
    expect(planQuestionStyles).not.toContain("background: #151515;");
  });

  it("themes queue and approval overlays in light mode", () => {
    expect(queueStyles).toContain("background: var(--surface-overlay, var(--panel));");
    expect(queueStyles).toContain("color: var(--text-primary, var(--heading));");
    expect(approvalStyles).toContain("background: var(--surface-overlay, var(--panel));");
    expect(approvalStyles).toContain("background: var(--surface-raised, var(--panel-2));");
    expect(confirmStyles).toContain("background: var(--surface-raised, var(--panel-2));");
    expect(confirmStyles).toContain("color: var(--text-primary, var(--heading));");
  });
});
