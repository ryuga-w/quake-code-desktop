import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSessionTree,
  isSessionTreeNodeExpanded,
  measureSessionTreeDepth,
  shouldDefaultExpandSessionNode,
} from "../src/client/src/components/sessions/session-tree";

const panel = readFileSync(join(process.cwd(), "src/client/src/components/sessions/SessionsPanel.tsx"), "utf8");
const styles = readFileSync(join(process.cwd(), "src/client/styles.css"), "utf8");
const main = readFileSync(join(process.cwd(), "src/client/src/app/App.tsx"), "utf8");
const sessionWorkspace = readFileSync(join(process.cwd(), "src/client/src/app/hooks/useSessionWorkspace.ts"), "utf8");
const shell = readFileSync(join(process.cwd(), "src/client/src/app/AppShell.tsx"), "utf8");
const sessionProjects = readFileSync(join(process.cwd(), "src/client/src/lib/session-projects.ts"), "utf8");

describe("session tree pure helpers", () => {
  it("builds parent/child tree from parentSessionPath", () => {
    const tree = buildSessionTree([
      { path: "a", modified: 1 },
      { path: "b", parentSessionPath: "a", modified: 2 },
      { path: "c", parentSessionPath: "b", modified: 3 },
      { path: "d", modified: 4 },
    ]);
    expect(tree.roots.map((node) => node.session.path)).toEqual(["a", "d"]);
    expect(tree.roots[0].children[0].session.path).toBe("b");
    expect(tree.roots[0].children[0].children[0].session.path).toBe("c");
    expect(measureSessionTreeDepth(tree.roots)).toBe(2);
  });

  it("defaults expand for shallow trees and root-only for deeper ones", () => {
    expect(shouldDefaultExpandSessionNode(0, 1)).toBe(true);
    expect(shouldDefaultExpandSessionNode(1, 1)).toBe(true);
    expect(shouldDefaultExpandSessionNode(0, 2)).toBe(true);
    expect(shouldDefaultExpandSessionNode(1, 2)).toBe(false);
  });

  it("honors remembered expand state and hide-branches toggle", () => {
    expect(
      isSessionTreeNodeExpanded("a", true, {}, true, 0, 1),
    ).toBe(false);
    expect(
      isSessionTreeNodeExpanded("a", true, { a: false }, false, 0, 1),
    ).toBe(false);
    expect(
      isSessionTreeNodeExpanded("a", true, { a: true }, false, 1, 3),
    ).toBe(true);
    expect(
      isSessionTreeNodeExpanded("a", false, {}, false, 0, 1),
    ).toBe(false);
  });
});

describe("session tree UX source contract", () => {
  it("supports expand/collapse chrome and Turkish branch labels", () => {
    expect(panel).toContain("aria-expanded");
    expect(panel).toContain("session-expand");
    expect(panel).toContain("session-branch-count");
    expect(panel).toContain("dal");
    expect(panel).toContain("Dalları göster");
    expect(panel).toContain("Dalları gizle");
    expect(panel).toContain("Ana sohbet");
    expect(panel).toContain("Yan sohbet");
    expect(panel).toContain("ArrowRight");
    expect(panel).toContain("ArrowLeft");
    expect(panel).toContain("quake-web:sessionTreeExpanded");
    expect(styles).toContain(".session-node");
    expect(styles).toContain("calc(var(--depth)");
    expect(styles).toContain(".session-expand");
    expect(styles).toContain(".session-branch-count");
  });

  it("keeps multiple workspace roots open and restores the last session per cwd", () => {
    expect(sessionProjects).toContain("quake-web:lastSessionByWorkspace");
    expect(main).toContain("useSessionWorkspace");
    expect(sessionWorkspace).toContain('type: "open_workspaces"');
    expect(sessionWorkspace).not.toContain("Çalışma alanı değiştirilsin mi?");
    expect(sessionWorkspace).toContain("Bu projedeki son sohbet açılsın mı?");
    expect(sessionWorkspace).toContain("Son sohbeti aç");
    expect(sessionWorkspace).toContain("persistLastSessionForWorkspace");
    expect(sessionWorkspace).toContain("maybeRestoreLastSession");
    expect(sessionWorkspace).toContain("rememberWorkspaceRoots");
    expect(shell).toContain("lastSessionByWorkspace");
  });
});
