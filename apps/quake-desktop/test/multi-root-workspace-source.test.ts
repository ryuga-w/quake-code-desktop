import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const runtime = readFileSync(join(root, "src/server/runtime.ts"), "utf8");
const server = readFileSync(join(root, "src/server/index.ts"), "utf8");
const workspaceHook = readFileSync(join(root, "src/client/src/app/hooks/useSessionWorkspace.ts"), "utf8");
const electronWorkspace = readFileSync(join(root, "electron/workspace.ts"), "utf8");

describe("multi-root workspace contract", () => {
  it("parks cross-root runtime sessions instead of disposing them", () => {
    const openWorkspace = runtime.slice(
      runtime.indexOf("async openWorkspace(cwd: string)"),
      runtime.indexOf("listExtensions()"),
    );
    expect(openWorkspace).toContain("workspaceContextHooks.prepare");
    expect(openWorkspace).toContain("pruneSlots");
    expect(openWorkspace).not.toContain("disposeAllSlots");
    expect(runtime).toContain("getMcpManager?.(slotCwd)");
  });

  it("exposes atomic multi-folder activation and root-scoped services", () => {
    expect(server).toContain('case "open_workspaces"');
    expect(server).toContain("workspaceRegistry.addMany(validatedRoots)");
    expect(server).toContain("ensureWorkspaceServices(validatedCwd)");
    expect(server).toContain("serverConfig.workspaceRoots = workspaceRegistry.list()");
  });

  it("uses a native multi-folder picker without the destructive warning", () => {
    expect(workspaceHook).toContain('type: "open_workspaces"');
    expect(workspaceHook).toContain("pickFoldersNative");
    const resetFileSurface = workspaceHook.slice(
      workspaceHook.indexOf("function resetWorkspaceFileSurface()"),
      workspaceHook.indexOf("function resetSessionOwnedUi"),
    );
    expect(resetFileSurface).toContain('writeStorageValue("quake-web:fileDir", ".")');
    expect(resetFileSurface).not.toContain("resetWorkspaceFileSurface();");
    expect(workspaceHook).not.toContain("Çoklu kök (multi-root) desteklenmez");
    expect(electronWorkspace).toContain('["openDirectory", "multiSelections"]');
    expect(electronWorkspace).toContain("rememberWorkspaceRoots");
  });
});
