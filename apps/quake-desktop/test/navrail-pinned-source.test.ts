import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const navRail = readFileSync(join(root, "src/client/src/components/chrome/NavRail.tsx"), "utf8");
const navigation = readFileSync(join(root, "src/client/src/app/hooks/useConversationNavigation.ts"), "utf8");
const styles = readFileSync(join(root, "src/client/src/components/chrome/NavRail.module.css"), "utf8");

describe("pinned tasks in the navigation rail", () => {
  it("renders pinned tasks in their own section before the normal task list", () => {
    expect(navRail).toContain('t("navRail.pinnedTasks")');
    expect(navRail).toContain("sortedPinned.map");
    expect(navRail).not.toContain('<Pin size={12}');
    expect(navRail.indexOf("sortedPinned.map")).toBeLessThan(navRail.indexOf("displayedSessions.map"));
    expect(styles).toContain(".pinnedSection");
    expect(styles).toContain(".pinnedSectionHead");
    expect(styles).toContain("color: var(--text-navigation-muted, #777c83)");
  });

  it("keeps the full session identity so pinned rows remain actionable and active-aware", () => {
    expect(navigation).toContain("...session");
    expect(navigation).toContain("visibleSessions.map");
    expect(navRail).toContain("export type NavPinned = NavSession");
  });
});
