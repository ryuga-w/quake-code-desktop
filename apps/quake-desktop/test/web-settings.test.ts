import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WebSettingsService } from "../src/server/web-settings.js";

describe("WebSettingsService model preferences", () => {
  it("migrates workspace model preferences to application-wide storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "quake-web-settings-"));
    const workspaceA = join(root, "workspace-a");
    const workspaceB = join(root, "workspace-b");
    const globalDirectory = join(root, "global");
    await mkdir(join(workspaceA, ".quake-code"), { recursive: true });
    await mkdir(workspaceB, { recursive: true });
    await writeFile(join(workspaceA, ".quake-code", "web-settings.json"), JSON.stringify({
      fileDir: "src",
      selectedModel: "provider/model-a",
      pinnedComposerModels: ["provider/model-a", "provider/model-a", "provider/model-b"],
    }));

    const migrated = await new WebSettingsService(workspaceA, globalDirectory).read();
    const reopenedInAnotherWorkspace = await new WebSettingsService(workspaceB, globalDirectory).read();

    expect(migrated.pinnedComposerModels).toEqual(["provider/model-a", "provider/model-b"]);
    expect(reopenedInAnotherWorkspace.selectedModel).toBe("provider/model-a");
    expect(reopenedInAnotherWorkspace.pinnedComposerModels).toEqual(["provider/model-a", "provider/model-b"]);
    expect(JSON.parse(await readFile(join(globalDirectory, "desktop-settings.json"), "utf8"))).toEqual({
      selectedModel: "provider/model-a",
      pinnedComposerModels: ["provider/model-a", "provider/model-b"],
    });
  });

  it("keeps workspace settings isolated while sharing model picker choices", async () => {
    const root = await mkdtemp(join(tmpdir(), "quake-web-settings-"));
    const workspaceA = join(root, "workspace-a");
    const workspaceB = join(root, "workspace-b");
    const globalDirectory = join(root, "global");
    await mkdir(workspaceA, { recursive: true });
    await mkdir(workspaceB, { recursive: true });

    const serviceA = new WebSettingsService(workspaceA, globalDirectory);
    await serviceA.patch({ fileDir: "src", pinnedComposerModels: ["provider/model-a"] });
    const serviceB = new WebSettingsService(workspaceB, globalDirectory);
    await serviceB.patch({ fileDir: "test" });

    expect(await serviceA.read()).toMatchObject({ fileDir: "src", pinnedComposerModels: ["provider/model-a"] });
    expect(await serviceB.read()).toMatchObject({ fileDir: "test", pinnedComposerModels: ["provider/model-a"] });
  });

  it("persists terminalPolicyMode in application-wide desktop settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "quake-web-settings-"));
    const workspaceA = join(root, "workspace-a");
    const workspaceB = join(root, "workspace-b");
    const globalDirectory = join(root, "global");
    await mkdir(workspaceA, { recursive: true });
    await mkdir(workspaceB, { recursive: true });

    const serviceA = new WebSettingsService(workspaceA, globalDirectory);
    await serviceA.patch({ terminalPolicyMode: "allow-all", fileDir: "src" });

    // Survives "restart" — new service instance + different workspace still sees policy.
    const reloaded = await new WebSettingsService(workspaceB, globalDirectory).read();
    expect(reloaded.terminalPolicyMode).toBe("allow-all");
    expect(reloaded.fileDir).toBeUndefined();
    expect(JSON.parse(await readFile(join(globalDirectory, "desktop-settings.json"), "utf8"))).toMatchObject({
      terminalPolicyMode: "allow-all",
    });

    await serviceA.patch({ terminalPolicyMode: "disabled" });
    expect((await new WebSettingsService(workspaceA, globalDirectory).read()).terminalPolicyMode).toBe("disabled");
  });

  it("ignores invalid terminalPolicyMode values on patch", async () => {
    const root = await mkdtemp(join(tmpdir(), "quake-web-settings-"));
    const workspace = join(root, "workspace");
    const globalDirectory = join(root, "global");
    await mkdir(workspace, { recursive: true });

    const service = new WebSettingsService(workspace, globalDirectory);
    await service.patch({ terminalPolicyMode: "safe" });
    await service.patch({ terminalPolicyMode: "not-a-mode" as any });
    expect((await service.read()).terminalPolicyMode).toBe("safe");
  });

  it("persists agentHttpProxyEnabled and osSandboxExperimental in desktop-settings.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "quake-web-settings-"));
    const workspaceA = join(root, "workspace-a");
    const workspaceB = join(root, "workspace-b");
    const globalDirectory = join(root, "global");
    await mkdir(workspaceA, { recursive: true });
    await mkdir(workspaceB, { recursive: true });

    const serviceA = new WebSettingsService(workspaceA, globalDirectory);
    await serviceA.patch({
      agentHttpProxyEnabled: true,
      osSandboxExperimental: true,
      terminalPolicyMode: "safe",
      fileDir: "src",
    });

    const reloaded = await new WebSettingsService(workspaceB, globalDirectory).read();
    expect(reloaded.agentHttpProxyEnabled).toBe(true);
    expect(reloaded.osSandboxExperimental).toBe(true);
    expect(reloaded.terminalPolicyMode).toBe("safe");
    expect(reloaded.fileDir).toBeUndefined();
    expect(JSON.parse(await readFile(join(globalDirectory, "desktop-settings.json"), "utf8"))).toMatchObject({
      agentHttpProxyEnabled: true,
      osSandboxExperimental: true,
      terminalPolicyMode: "safe",
    });

    await serviceA.patch({ agentHttpProxyEnabled: false, osSandboxExperimental: false });
    const off = await new WebSettingsService(workspaceA, globalDirectory).read();
    expect(off.agentHttpProxyEnabled).toBe(false);
    expect(off.osSandboxExperimental).toBe(false);
  });

  it("ignores non-boolean isolation flags on patch", async () => {
    const root = await mkdtemp(join(tmpdir(), "quake-web-settings-"));
    const workspace = join(root, "workspace");
    const globalDirectory = join(root, "global");
    await mkdir(workspace, { recursive: true });

    const service = new WebSettingsService(workspace, globalDirectory);
    await service.patch({ agentHttpProxyEnabled: true, osSandboxExperimental: false });
    await service.patch({ agentHttpProxyEnabled: "1" as any, osSandboxExperimental: 1 as any });
    const settings = await service.read();
    expect(settings.agentHttpProxyEnabled).toBe(true);
    expect(settings.osSandboxExperimental).toBe(false);
  });

  it("leaves agentHttpProxyEnabled undefined until first boot persists it", async () => {
    // S-NET.2: undefined means "never chosen" so desktop can auto-enable for safe policy.
    // Explicit false must survive read (product keeps proxy off).
    const root = await mkdtemp(join(tmpdir(), "quake-web-settings-"));
    const workspace = join(root, "workspace");
    const globalDirectory = join(root, "global");
    await mkdir(workspace, { recursive: true });

    const fresh = await new WebSettingsService(workspace, globalDirectory).read();
    expect(fresh.agentHttpProxyEnabled).toBeUndefined();

    const service = new WebSettingsService(workspace, globalDirectory);
    await service.patch({ agentHttpProxyEnabled: false, terminalPolicyMode: "safe" });
    const off = await new WebSettingsService(workspace, globalDirectory).read();
    expect(off.agentHttpProxyEnabled).toBe(false);
    expect(off.terminalPolicyMode).toBe("safe");
  });
});
