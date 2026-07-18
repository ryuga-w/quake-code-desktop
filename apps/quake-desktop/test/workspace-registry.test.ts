import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkspaceRootsJson, WorkspaceRegistry } from "../src/server/workspace-registry.js";

describe("WorkspaceRegistry", () => {
  it("keeps multiple roots while changing only the active root", () => {
    const first = resolve(join("fixtures", "workspace-a"));
    const second = resolve(join("fixtures", "workspace-b"));
    const third = resolve(join("fixtures", "workspace-c"));
    const registry = new WorkspaceRegistry(first, [second]);

    registry.activate(third);

    expect(registry.active).toBe(third);
    expect(registry.list()).toEqual([second, first, third]);
    expect(registry.has(first)).toBe(true);
    expect(registry.has(second)).toBe(true);
  });

  it("deduplicates roots and refuses to remove the active root", () => {
    const first = resolve(join("fixtures", "workspace-a"));
    const second = resolve(join("fixtures", "workspace-b"));
    const registry = new WorkspaceRegistry(first, [first, first]);

    registry.addMany([second, second]);

    expect(registry.list()).toEqual([first, second]);
    expect(registry.remove(first)).toBe(false);
    expect(registry.remove(second)).toBe(true);
    expect(registry.list()).toEqual([first]);
  });

  it("parses only valid string roots from desktop state JSON", () => {
    expect(parseWorkspaceRootsJson('["C:/one", 42, "", "C:/two"]')).toEqual(["C:/one", "C:/two"]);
    expect(parseWorkspaceRootsJson("not-json")).toEqual([]);
    expect(parseWorkspaceRootsJson(undefined)).toEqual([]);
  });
});
