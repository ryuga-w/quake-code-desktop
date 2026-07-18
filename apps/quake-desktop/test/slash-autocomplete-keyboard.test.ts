import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nextSlashAutocompleteIndex } from "../src/client/src/components/composer/ComposerHelpers";

const helpersSource = readFileSync(
  join(process.cwd(), "src/client/src/components/composer/ComposerHelpers.tsx"),
  "utf8",
);
const appShellSource = readFileSync(join(process.cwd(), "src/client/src/app/AppShell.tsx"), "utf8");

describe("slash autocomplete keyboard navigation", () => {
  it("wraps keyboard selection in both directions", () => {
    expect(nextSlashAutocompleteIndex(0, 3, 1)).toBe(1);
    expect(nextSlashAutocompleteIndex(2, 3, 1)).toBe(0);
    expect(nextSlashAutocompleteIndex(0, 3, -1)).toBe(2);
    expect(nextSlashAutocompleteIndex(2, 0, -1)).toBe(0);
  });

  it("handles slash keys before prompt history navigation", () => {
    const slashHandler = appShellSource.indexOf("slashAutocompleteRef.current?.handleKeyDown(event)");
    const historyHandler = appShellSource.indexOf('event.key === "ArrowUp" && !prompt.trim()');

    expect(slashHandler).toBeGreaterThan(-1);
    expect(historyHandler).toBeGreaterThan(slashHandler);
    expect(appShellSource).toContain("if (slashAutocompleteRef.current?.handleKeyDown(event)) return;");
  });

  it("exposes a listbox with active-descendant semantics", () => {
    expect(helpersSource).toContain('input.setAttribute("role", "combobox")');
    expect(helpersSource).toContain('input.setAttribute("aria-activedescendant", activeOptionId)');
    expect(helpersSource).toContain('role="listbox"');
    expect(helpersSource).toContain('role="option"');
    expect(helpersSource).toContain("aria-selected={active}");
  });

  it("supports Tab selection, arrow navigation, and Escape dismissal", () => {
    expect(helpersSource).toContain('event.key === "ArrowDown" || event.key === "ArrowUp"');
    expect(helpersSource).toContain('event.key === "Tab"');
    expect(helpersSource).toContain('event.key === "Escape"');
    expect(helpersSource).toContain("setDismissed(true)");
    expect(helpersSource).toContain("event.stopPropagation()");
  });
});
