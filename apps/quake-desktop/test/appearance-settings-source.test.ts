import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const appearance = readFileSync(join(root, "src/client/src/components/settings/AppearanceSettings.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/src/components/settings/AppearanceSettings.module.css"), "utf8");

describe("appearance settings live-controls contract", () => {
  it("keeps only appearance preferences that are applied at runtime", () => {
    for (const label of [
      "Sistem",
      "Açık",
      "Koyu",
      "Hareketi azalt",
      "Composer peti",
      "Arayüz yoğunluğu",
    ]) {
      expect(appearance).toContain(label);
    }

    for (const removedLabel of [
      "Aydınlık tema",
      "Karanlık tema",
      "Temayı kopyala",
      "Vurgu",
      "Arka plan",
      "Ön plan",
      "İşaretçi imleçleri kullan",
      "Fark işaretleri",
    ]) {
      expect(appearance).not.toContain(removedLabel);
    }
  });

  it("uses semantic, keyboard-accessible controls", () => {
    expect(appearance).toContain('role="radiogroup"');
    expect(appearance).toContain('type="radio"');
    expect(appearance).toContain('role="switch"');
    expect(appearance).toContain('role="group"');
    expect(appearance).toContain("applyAppearanceRuntimeAttributes(preferences)");
    expect(styles).toContain(".visuallyHidden:focus-visible + .themeOptionVisual");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
