import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const composer = readFileSync(join(process.cwd(), "src/client/src/components/composer/ChatComposer.tsx"), "utf8");
const composerStyles = readFileSync(join(process.cwd(), "src/client/src/components/composer/ChatComposer.module.css"), "utf8");

describe("composer controls source contract", () => {
  it("keeps the composer surface fixed across hover and focus", () => {
    expect(composerStyles).toMatch(
      /:global\(#composer\)\.composer:hover,\s*:global\(#composer\)\.composer:focus-within \{[\s\S]*?border-color: color-mix\(in srgb, var\(--heading\) 4%, transparent\);[\s\S]*?background: var\(--composer-surface, #2b2b2b\);/,
    );
    expect(composerStyles).not.toContain("var(--composer-surface, #2b2b2b) 92%, #ffffff 8%");
  });

  it("keeps the composer slightly wider than the message column", () => {
    expect(composerStyles).toContain("width: min(var(--composer-max-width, 720px)");
  });

  it("matches the wide reference approval menu", () => {
    expect(composer).toContain("Daha fazla bilgi");
    expect(composer).toContain("styles.approvalHeaderTitle");
    expect(composer).toContain("className={styles.approvalOption}");
    expect(composerStyles).toContain("width: 522px");
    expect(composerStyles).toContain("flex: 0 0 209px");
    expect(composerStyles).toContain("bottom: calc(100% + 1px)");
    expect(composerStyles).not.toContain(".approvalOption.selected");
  });

  it("groups model and effort in the progressive composer picker", () => {
    expect(composer).toContain('aria-label="Composer seçenekleri"');
    expect(composer).toContain("<b>Plan</b>");
    expect(composer).toContain("<b>Agent</b>");
    expect(composer).toContain("<b>Goal</b>");
    expect(composer).toContain("<b>Dosya ve bağlam</b>");
    expect(composer).toContain('className={`${styles.preferencesMenu} composer-menu`}');
    expect(composer).toContain("Model ve çaba ayarları");
    expect(composer).toContain("Gelişmiş");
    expect(composer).toContain("Varsayılana sıfırla");
    expect(composer).toContain('data-level={currentThinking}');
    expect(composer).toContain('setPreferencesSubmenu("model")');
    expect(composer).toContain('setPreferencesSubmenu("effort")');
    expect(composer).not.toContain("styles.thinkingMenu");
    expect(composer).not.toContain("styles.modelMenu");
    expect(composerStyles).toContain(".effortRail");
    expect(composer).toContain("<EffortSlider");
    expect(composer).toContain('type="range"');
    expect(composer).toContain('aria-label="Çaba seviyesi"');
    expect(composer).toContain("onPointerUp");
    expect(composerStyles).toContain(".effortSlider::-webkit-slider-thumb");
    expect(composerStyles).toContain(".effortThumb");
    expect(composer).toContain("data-level={visibleOption?.value}");
    expect(composerStyles).toContain('.effortRail[data-level="max"]');
    expect(composerStyles).toContain("@keyframes maxEffortAura");
    expect(composer).not.toContain("styles.maxEffortFlames");
    expect(composerStyles).not.toContain(".maxEffortFlames");
    expect(composerStyles).not.toContain("@keyframes maxEffortFlame");
    expect(composerStyles).toContain(".advancedPreferencesPanel");
    expect(composerStyles).toContain(".preferencesSubmenu");
    expect(composerStyles).toMatch(/\.preferencesMenu\.preferencesMenu > summary \{[\s\S]*?background: transparent;/);
    expect(composerStyles).toContain('.preferenceEffort[data-level="max"]');
    expect(composerStyles).not.toContain(".preferencesMenu.preferencesMenu[open] > summary,");
    expect(composerStyles).toContain(".addMenu > summary::after");
  });
});
