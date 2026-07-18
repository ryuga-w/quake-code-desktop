import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

describe("responsive shell source contract", () => {
  it("turns the narrow sidebar into a toggleable drawer", () => {
    const css = readFileSync(join(root, "src/client/styles-responsive.css"), "utf8");

    expect(css).toContain("#app:not(.browser-layout-focus) > :first-child");
    expect(css).toContain("#app.left-collapsed:not(.browser-layout-focus) > :first-child");
    expect(css).toContain("position: fixed");
    expect(css).toContain("transform: translateX(calc(-100% - 20px))");
    expect(css).toContain("visibility 0s linear var(--duration-panel, 280ms)");
    expect(css).not.toMatch(/#app\s*>\s*:first-child\s*\{\s*display:\s*none\s*!important/);
  });
});
