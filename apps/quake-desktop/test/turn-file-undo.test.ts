import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileHistoryService } from "../src/server/file-history.js";
import { FileMutationService } from "../src/server/file-mutations.js";
import {
  reverseFileDiff,
  TurnFileUndoError,
  undoTurnFileChanges,
} from "../src/server/turn-file-undo.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createWorkspace(): Promise<{ root: string; mutations: FileMutationService }> {
  const root = await mkdtemp(join(tmpdir(), "quake-turn-undo-"));
  tempRoots.push(root);
  const history = new FileHistoryService(root);
  await history.init();
  return { root, mutations: new FileMutationService(root, history) };
}

describe("turn file undo", () => {
  it("reverses a Codex apply_patch update", () => {
    const diff = [
      "diff --git a/example.ts b/example.ts",
      "--- a/example.ts",
      "+++ b/example.ts",
      "@@",
      " export const stable = true;",
      "-export const value = 1;",
      "+export const value = 2;",
      " export const tail = true;",
      "",
    ].join("\n");

    expect(reverseFileDiff(
      "export const stable = true;\nexport const value = 2;\nexport const tail = true;\n",
      diff,
      "example.ts",
    )).toBe("export const stable = true;\nexport const value = 1;\nexport const tail = true;\n");
  });

  it("restores deletion-only hunks using exact context", () => {
    const diff = "@@\n alpha\n-beta\n omega\n";
    expect(reverseFileDiff("alpha\nomega\n", diff, "example.txt")).toBe("alpha\nbeta\nomega\n");
  });

  it("reverses Quake numbered edit diffs", () => {
    const diff = " 1 alpha\n-2 before\n+2 after\n 3 omega";
    expect(reverseFileDiff("alpha\nafter\nomega\n", diff, "numbered.txt")).toBe("alpha\nbefore\nomega\n");
  });

  it("does not mistake a changed ellipsis line for an omitted range", () => {
    const diff = " 1 alpha\n-2 before\n+2 ...\n 3 omega";
    expect(reverseFileDiff("alpha\n...\nomega\n", diff, "ellipsis.txt")).toBe("alpha\nbefore\nomega\n");
  });

  it("reverses repeated mutations of one file newest-first", () => {
    const diff = [
      "diff --git a/value.txt b/value.txt",
      "--- a/value.txt",
      "+++ b/value.txt",
      "@@",
      "-first",
      "+second",
      "diff --git a/value.txt b/value.txt",
      "--- a/value.txt",
      "+++ b/value.txt",
      "@@",
      "-second",
      "+third",
    ].join("\n");
    expect(reverseFileDiff("third\n", diff, "value.txt")).toBe("first\n");
  });

  it("fails closed when the changed block drifted after the turn", () => {
    const diff = "@@\n-before\n+after\n";
    expect(() => reverseFileDiff("user edit\n", diff, "drift.txt")).toThrow(TurnFileUndoError);
  });

  it("preflights the full turn before mutating any file", async () => {
    const { root, mutations } = await createWorkspace();
    await writeFile(join(root, "safe.txt"), "after\n", "utf8");
    await writeFile(join(root, "drift.txt"), "user edit\n", "utf8");

    await expect(undoTurnFileChanges(root, mutations, [
      { path: "safe.txt", kind: "modify", diff: "@@\n-before\n+after\n" },
      { path: "drift.txt", kind: "modify", diff: "@@\n-before\n+after\n" },
    ])).rejects.toThrow(/drift\.txt/);

    expect(await readFile(join(root, "safe.txt"), "utf8")).toBe("after\n");
    expect(await readFile(join(root, "drift.txt"), "utf8")).toBe("user edit\n");
  });

  it("rolls back completed files if another file changes during execution", async () => {
    const { root, mutations } = await createWorkspace();
    await writeFile(join(root, "first.txt"), "after\n", "utf8");
    await writeFile(join(root, "second.txt"), "after\n", "utf8");
    const racingMutations = {
      writeFile: async (...args: Parameters<FileMutationService["writeFile"]>) => {
        const result = await mutations.writeFile(...args);
        if (args[0] === "first.txt") await writeFile(join(root, "second.txt"), "external edit\n", "utf8");
        return result;
      },
      deleteFile: (...args: Parameters<FileMutationService["deleteFile"]>) => mutations.deleteFile(...args),
    } as unknown as FileMutationService;

    await expect(undoTurnFileChanges(root, racingMutations, [
      { path: "first.txt", kind: "modify", diff: "@@\n-before\n+after\n" },
      { path: "second.txt", kind: "modify", diff: "@@\n-before\n+after\n" },
    ])).rejects.toMatchObject({ statusCode: 409 });

    expect(await readFile(join(root, "first.txt"), "utf8")).toBe("after\n");
    expect(await readFile(join(root, "second.txt"), "utf8")).toBe("external edit\n");
  });

  it("restores modifications and removes files created by the turn", async () => {
    const { root, mutations } = await createWorkspace();
    await writeFile(join(root, "edited.txt"), "after\n", "utf8");
    await writeFile(join(root, "created.txt"), "created\n", "utf8");

    const result = await undoTurnFileChanges(root, mutations, [
      { path: "edited.txt", kind: "modify", diff: "@@\n-before\n+after\n" },
      {
        path: "created.txt",
        kind: "create",
        diff: "diff --git a/created.txt b/created.txt\n--- /dev/null\n+++ b/created.txt\n@@\n+created\n",
      },
    ]);

    expect(result).toEqual({ reverted: 2, paths: ["edited.txt", "created.txt"] });
    expect(await readFile(join(root, "edited.txt"), "utf8")).toBe("before\n");
    expect(existsSync(join(root, "created.txt"))).toBe(false);
  });

  it("restores a deleted file when its diff contains the removed content", async () => {
    const { root, mutations } = await createWorkspace();
    const result = await undoTurnFileChanges(root, mutations, [
      { path: "deleted.txt", kind: "delete", diff: "-1 restored content" },
    ]);

    expect(result.reverted).toBe(1);
    expect(await readFile(join(root, "deleted.txt"), "utf8")).toBe("restored content\n");
  });

  it("rejects paths outside the workspace", async () => {
    const { root, mutations } = await createWorkspace();
    await expect(undoTurnFileChanges(root, mutations, [
      { path: "../outside.txt", kind: "modify", diff: "@@\n-before\n+after\n" },
    ])).rejects.toMatchObject({ statusCode: 403 });
  });
});
