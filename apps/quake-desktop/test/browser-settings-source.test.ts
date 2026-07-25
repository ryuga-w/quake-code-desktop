import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const settings = readFileSync(join(root, "src/client/src/components/settings/SettingsPanels.tsx"), "utf8");

describe("browser settings cleanup", () => {
  it("does not expose browser controls before they have a runtime implementation", () => {
    expect(settings).not.toContain('id: "browser"');
    expect(settings).not.toContain("<BrowserSettings");
    expect(settings).not.toContain("browserPreferences");
  });
});
