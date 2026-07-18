import { describe, expect, it } from "vitest";
import {
  ancestorDirs,
  isValidEntryName,
  joinWorkspacePath,
  normalizeEntries,
  parentDir,
  selectVisibleTreeRows,
  type WorkspaceEntry,
} from "../src/client/src/components/files/file-tree";

const root: WorkspaceEntry[] = [
  { name: "src", path: "src", type: "directory" },
  { name: "README.md", path: "README.md", type: "file", size: 10 },
];

const children = {
  ".": root,
  src: [{ name: "index.ts", path: "src/index.ts", type: "file", size: 20 }],
};

describe("file tree helpers", () => {
  it("flattens expanded trees while applying the window before materializing", () => {
    const result = selectVisibleTreeRows(children, root, new Set(["src"]), false, false, 2);
    expect(result.total).toBe(3);
    expect(result.rows.map((row) => row.entry.path)).toEqual(["src", "src/index.ts"]);
  });

  it("normalizes untrusted API entries", () => {
    expect(normalizeEntries([{ name: "x", path: ".\\x", type: "file", size: 3 }, null])).toEqual([
      { name: "x", path: "x", type: "file", size: 3, modified: undefined },
    ]);
  });

  it("builds safe workspace-relative paths", () => {
    expect(parentDir("src/components/Button.tsx")).toBe("src/components");
    expect(ancestorDirs("src/components")).toEqual(["src", "src/components"]);
    expect(joinWorkspacePath("src", "new.ts")).toBe("src/new.ts");
  });

  it("rejects invalid Windows and traversal names", () => {
    expect(isValidEntryName("valid-name.ts")).toBe(true);
    expect(isValidEntryName("../secret")).toBe(false);
    expect(isValidEntryName("bad:name")).toBe(false);
  });
});
