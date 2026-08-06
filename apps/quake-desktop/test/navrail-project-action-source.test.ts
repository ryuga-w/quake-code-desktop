import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const navRail = readFileSync(join(process.cwd(), "src/client/src/components/chrome/NavRail.tsx"), "utf8");
const navRailStyles = readFileSync(join(process.cwd(), "src/client/src/components/chrome/NavRail.module.css"), "utf8");

describe("NavRail project workspace action", () => {
  it("reveals a dedicated workspace picker on project hover", () => {
    expect(navRail).toContain('className={styles.navItemRow}');
    expect(navRail).toContain('className={styles.navItemTrailing}');
    expect(navRail).toContain('onClick={onOpenWorkspace}');
    expect(navRail).toContain('aria-label={t("navRail.selectWorkspace")}');
    expect(navRailStyles).toContain('.navItemRow:hover .navItemTrailing');
    expect(navRailStyles).toContain('opacity: 0');
    expect(navRailStyles).toContain('pointer-events: none');
    expect(navRailStyles).toContain('pointer-events: auto');
  });

  it("uses a restrained Codex-like navigation hierarchy", () => {
    expect(navRail).toContain("<b>Quake Code</b>");
    expect(navRailStyles).toContain("--nav-row-height: 29px");
    expect(navRailStyles).toContain("--nav-thread-label-max-width: 340px");
    expect(navRailStyles).toContain("font-size: var(--font-navigation, 13px)");
    expect(navRailStyles).toContain("border-right: 0");
    expect(navRailStyles).toContain("background: var(--surface-navigation-active, #363336)");
    expect(navRailStyles).toContain("max-width: min(100%, var(--nav-thread-label-max-width))");
    expect(navRailStyles).toContain("text-overflow: ellipsis");
    expect(navRailStyles).not.toContain("#b06cf5");
  });
});
