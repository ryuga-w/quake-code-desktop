import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const composer = readFileSync(join(process.cwd(), "src/client/src/components/composer/ChatComposer.tsx"), "utf8");
const composerStyles = readFileSync(join(process.cwd(), "src/client/src/components/composer/ChatComposer.module.css"), "utf8");
const appStyles = readFileSync(join(process.cwd(), "src/client/styles.css"), "utf8") + readFileSync(join(process.cwd(), "src/client/styles/themes.css"), "utf8");

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

  it("uses the reference charcoal hierarchy in dark mode", () => {
    expect(appStyles).toContain("--composer-surface: #242426");
    expect(appStyles).toContain("--composer-project-surface: #18191b");
    expect(appStyles).toContain("background: var(--composer-surface, #242426)");
    expect(appStyles).toContain("--composer-focus-surface: #242426");
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

  it("matches the full-width reference add panel", () => {
    expect(composer).toContain('aria-label="Ekle"');
    expect(composer).toContain("className={styles.addPanelTitle}>Ekle");
    expect(composer).toContain("<b>Dosyalar ve klasörler</b>");
    expect(composer).toContain("<b>Proje</b><small>Yeni görevler için proje seç</small>");
    expect(composer).toContain("<b>Hedef</b><small>Üzerinde çalışmak için bir hedef belirle</small>");
    expect(composer).toContain("<b>Plan modu</b><small>Plan modunu aç</small>");
    expect(composer).toContain('apiGet<{ skills?: WebSkillInfo[] }>("/api/skills")');
    expect(composer).toContain("addMenuExtensions.map");
    expect(composer).toContain("ComposerAddMenuExtensionIcon");
    expect(composer).toContain("Dosyalar ve görevler");
    expect(composer).toContain("Dosya veya görev aramak için yaz");
    expect(composer).toContain("className={styles.addPopover}");
    expect(composerStyles).toContain("bottom: calc(100% + 4px)");
    expect(composerStyles).toContain("width: 100%");
    expect(composerStyles).toContain("max-height: min(316px");
    expect(composerStyles).toContain("overflow-y: auto");
    expect(composerStyles).toContain(".addPanelTitle");
    expect(composerStyles).toContain(".addActionText");
    expect(composerStyles).toContain(".addExtensionIcon");
    expect(composerStyles).toContain("@media (max-width: 400px)");
    expect(composerStyles).toContain("grid-template-columns: 30px minmax(0, 1fr) 32px");
    expect(composerStyles).toContain(".secondaryControls:not(:has(.contextUsageMeter)) .preferencesMenu");
    expect(composerStyles).toContain("bottom: min(calc(184px + env(safe-area-inset-bottom)), 48dvh)");
  });

  it("uses the responsive direct model and effort picker", () => {
    expect(composer).toContain('className={`${styles.preferencesMenu} composer-menu`}');
    expect(composer).toContain("Model ve çaba ayarları");
    expect(composer).toContain("Gelişmiş");
    expect(composer).toContain("Varsayılana sıfırla");
    expect(composer).toContain('data-level={currentThinking}');
    expect(composer).toContain('setPreferencesSubmenu("model")');
    expect(composer).toContain('setPreferencesSubmenu("effort")');
    expect(composer).not.toContain("styles.thinkingMenu");
    expect(composer).not.toContain("styles.modelMenu");
    expect(composer).toContain("availableThinkingOptions.map");
    expect(composer).toContain('role="menuitemradio"');
    expect(composer).not.toContain("<EffortSlider");
    expect(composer).not.toContain('type="range"');
    expect(composerStyles).toContain(".advancedPreferencesPanel");
    expect(composerStyles).toContain(".preferencesSubmenu");
    expect(composerStyles).toContain('.preferencesPopover[data-submenu-placement="left"]');
    expect(composerStyles).toContain('.preferencesPopover[data-submenu-placement="stacked"]');
    expect(composerStyles).toMatch(/\.preferencesMenu\.preferencesMenu > summary \{[\s\S]*?background: transparent;/);
    expect(composerStyles).toContain('.preferenceEffort[data-level="max"]');
    expect(composerStyles).not.toContain(".preferencesMenu.preferencesMenu[open] > summary,");
    expect(composerStyles).toContain(".addMenu > summary::after");
  });
});
