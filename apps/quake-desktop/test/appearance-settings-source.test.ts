import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const appearance = readFileSync(join(root, "src/client/src/components/settings/AppearanceSettings.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/src/components/settings/AppearanceSettings.module.css"), "utf8");

describe("appearance settings reference contract", () => {
  it("keeps every referenced appearance surface in the skeleton", () => {
    for (const label of [
      "Sistem",
      "Açık",
      "Koyu",
      "Aydınlık tema",
      "Karanlık tema",
      "İçeri aktar",
      "Temayı kopyala",
      "Vurgu",
      "Arka plan",
      "Ön plan",
      "Arayüz yazı tipi",
      "Kod yazı tipi",
      "Yarı saydam kenar çubuğu",
      "Kontrast",
      "Tercihler",
      "İşaretçi imleçleri kullan",
      "Hareketi azalt",
      "Composer peti",
      "Fark işaretleri",
    ]) {
      expect(appearance).toContain(label);
    }
  });

  it("uses semantic, keyboard-accessible controls", () => {
    expect(appearance).toContain('role="radiogroup"');
    expect(appearance).toContain('type="radio"');
    expect(appearance).toContain('role="switch"');
    expect(appearance).toContain('type="range"');
    expect(appearance).toContain('aria-live="polite"');
    expect(styles).toContain(".visuallyHidden:focus-visible + .themeOptionVisual");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
