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
    expect(navRail).toContain('aria-label="Workspace seç"');
    expect(navRailStyles).toContain('.navItemRow:hover .navItemTrailing');
    expect(navRailStyles).toContain('opacity: 0');
    expect(navRailStyles).toContain('pointer-events: none');
    expect(navRailStyles).toContain('pointer-events: auto');
  });
});
