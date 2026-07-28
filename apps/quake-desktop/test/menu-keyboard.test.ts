import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  getMenuItems,
  handleMenuKeyDown,
  resolveMenuNavigationIndex,
} from "../src/client/src/lib/menu-keyboard";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("shared menu keyboard navigation", () => {
  it("wraps ArrowUp and ArrowDown across menu boundaries", () => {
    expect(resolveMenuNavigationIndex("ArrowDown", -1, 4)).toBe(0);
    expect(resolveMenuNavigationIndex("ArrowDown", 3, 4)).toBe(0);
    expect(resolveMenuNavigationIndex("ArrowUp", -1, 4)).toBe(3);
    expect(resolveMenuNavigationIndex("ArrowUp", 0, 4)).toBe(3);
  });

  it("moves Home and End to deterministic endpoints", () => {
    expect(resolveMenuNavigationIndex("Home", 2, 4)).toBe(0);
    expect(resolveMenuNavigationIndex("End", 1, 4)).toBe(3);
    expect(resolveMenuNavigationIndex("ArrowDown", -1, 0)).toBeNull();
  });

  it("skips disabled and nested items while moving real focus", () => {
    const menu = { querySelectorAll: vi.fn() } as unknown as HTMLElement;
    const nestedMenu = {} as HTMLElement;
    const makeItem = (owner: HTMLElement, disabled = false) => {
      const value = {
        disabled,
        getAttribute: (name: string) => name === "aria-disabled" && disabled ? "true" : null,
        closest: () => owner,
        contains: (target: unknown) => target === value,
        focus: vi.fn(),
      };
      return value;
    };
    const first = makeItem(menu);
    const item = makeItem(menu, true);
    const nested = makeItem(nestedMenu);
    const last = makeItem(menu);
    vi.mocked(menu.querySelectorAll).mockReturnValue([first, item, nested, last] as unknown as NodeListOf<HTMLElement>);

    expect(getMenuItems(menu)).toEqual([first, last]);

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    expect(handleMenuKeyDown({
      key: "ArrowDown",
      currentTarget: menu,
      target: first as unknown as EventTarget,
      preventDefault,
      stopPropagation,
    })).toBe(true);
    expect(last.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("wires every owned popup menu to the shared keyboard contract", () => {
    const sources = [
      "src/client/src/components/composer/ChatComposer.tsx",
      "src/client/src/components/security/ComposerApproval.tsx",
      "src/client/src/components/chrome/QuickLauncher.tsx",
      "src/client/src/components/shell/RightPanelTabs.tsx",
      "src/client/src/components/chrome/ProjectPicker.tsx",
      "src/client/src/components/chrome/Titlebar.tsx",
    ].map(read);

    for (const source of sources) {
      expect(source).toContain('from "../../lib/menu-keyboard"');
      expect(source).toContain("handleMenuKeyDown");
    }

    expect(sources[0]).toContain("focusFirstMenuItem");
    expect(sources[0]).toContain("closeDetailsElement");
    expect(sources[1]).toContain("closeMenuAndRestoreFocus");
    expect(sources[2]).toContain("restoreMenuTriggerFocus(triggerRef.current)");
    expect(sources[3]).toContain("restoreMenuTriggerFocus(addTriggerRef.current)");
    expect(sources[4]).toContain("closeAndRestoreFocus");
    expect(sources[5]).toContain("closeOpenMenu(true)");
  });
});
