import { describe, expect, it } from "vitest";
import { toolFileMutations } from "../src/client/src/lib/tool-activity";
import type { ToolCardState } from "../src/client/src/state/app-store";

function tool(overrides: Partial<ToolCardState>): ToolCardState {
  return {
    id: "tool-1",
    toolName: "apply_patch",
    status: "running",
    ...overrides,
  };
}

describe("toolFileMutations", () => {
  it("splits one Codex apply_patch call into one row per file", () => {
    const mutations = toolFileMutations(tool({
      args: `*** Begin Patch
*** Add File: tool-test/test-a.txt
+İlk satır
+İkinci satır
*** Add File: tool-test/test-b.txt
+Geçici dosya
+Silinmeyi bekliyor
*** End Patch`,
    }));

    expect(mutations).toEqual([
      { path: "tool-test/test-a.txt", kind: "create", added: 2, removed: 0 },
      { path: "tool-test/test-b.txt", kind: "create", added: 2, removed: 0 },
    ]);
  });

  it("tracks update, delete, and rename operations", () => {
    const mutations = toolFileMutations(tool({
      args: `*** Begin Patch
*** Update File: src/old-name.ts
*** Move to: src/new-name.ts
@@
-const value = 1;
+const value = 2;
*** Delete File: src/unused.ts
*** End Patch`,
    }));

    expect(mutations).toEqual([
      {
        path: "src/new-name.ts",
        previousPath: "src/old-name.ts",
        kind: "modify",
        added: 1,
        removed: 1,
      },
      { path: "src/unused.ts", kind: "delete", added: 0, removed: 0 },
    ]);
  });

  it("parses standard unified diffs per file", () => {
    const mutations = toolFileMutations(tool({
      details: {
        diff: `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1,2 @@
-const a = 1;
+const a = 2;
+export { a };
diff --git a/src/b.ts b/src/b.ts
new file mode 100644
--- /dev/null
+++ b/src/b.ts
@@ -0,0 +1 @@
+export const b = true;`,
      },
    }));

    expect(mutations).toEqual([
      { path: "src/a.ts", kind: "modify", added: 2, removed: 1 },
      { path: "src/b.ts", kind: "create", added: 1, removed: 0 },
    ]);
  });

  it("falls back to apply_patch result file markers", () => {
    const mutations = toolFileMutations(tool({
      args: undefined,
      output: `Success. Updated the following files:
A tool-test/test-a.txt
M src/client/main.tsx
D src/unused.ts`,
      status: "done",
    }));

    expect(mutations).toEqual([
      { path: "tool-test/test-a.txt", kind: "create", added: 0, removed: 0 },
      { path: "src/client/main.tsx", kind: "modify", added: 0, removed: 0 },
      { path: "src/unused.ts", kind: "delete", added: 0, removed: 0 },
    ]);
  });

  it("increases live line counts as a partial apply_patch payload grows", () => {
    const partials = [
      `*** Begin Patch\n*** Update File: src/example.tsx\n@@\n-old value\n+first line`,
      `*** Begin Patch\n*** Update File: src/example.tsx\n@@\n-old value\n+first line\n+second line`,
      `*** Begin Patch\n*** Update File: src/example.tsx\n@@\n-old value\n+first line\n+second line\n+third line`,
    ];

    expect(partials.map((patch, index) => toolFileMutations(tool({ id: `live-${index}`, args: { patch } }))[0])).toEqual([
      { path: "src/example.tsx", kind: "modify", added: 1, removed: 1 },
      { path: "src/example.tsx", kind: "modify", added: 2, removed: 1 },
      { path: "src/example.tsx", kind: "modify", added: 3, removed: 1 },
    ]);
  });
});
