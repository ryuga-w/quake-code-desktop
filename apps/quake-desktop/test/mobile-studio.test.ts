import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectMobileProjects } from "../src/server/mobile/project-detector.js";
import { MobileRuntime } from "../src/server/mobile/runtime.js";
import { AndroidDeviceDriver, getAndroidEmulatorLaunchArgs } from "../src/server/mobile/android-driver.js";
import { loadMobileBuildProfiles } from "../src/server/mobile/build-config.js";

const temporaryDirectories: string[] = [];
function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "quake-mobile-studio-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
});

describe("mobile project detection", () => {
  it("detects cross-platform projects without binding runtime to a language", () => {
    const root = workspace();
    writeFileSync(join(root, "pubspec.yaml"), "name: universal_app\n");
    mkdirSync(join(root, ".quake-code"));
    writeFileSync(join(root, ".quake-code", "mobile.json"), "{}");
    const projects = detectMobileProjects(root);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.targets).toEqual(["android", "ios"]);
    expect(projects[0]?.frameworks).toContain("Flutter");
    expect(projects[0]?.configurable).toBe(true);
  });

  it("loads language-independent custom build contracts", () => {
    const root = workspace();
    mkdirSync(join(root, ".quake-code"));
    writeFileSync(join(root, ".quake-code", "mobile.json"), JSON.stringify({
      version: 1,
      applications: [{ id: "custom", android: { build: "custom-compiler --android", artifact: "out/app.apk", appId: "com.example.custom" }, ios: { build: "custom-compiler --ios" } }],
    }));
    const profiles = loadMobileBuildProfiles(root);
    expect(profiles.map((profile) => profile.platform)).toEqual(["android", "ios"]);
    expect(profiles[0]).toMatchObject({ source: "custom", appId: "com.example.custom" });
  });

  it("rejects custom artifacts outside the workspace", () => {
    const root = workspace();
    mkdirSync(join(root, ".quake-code"));
    writeFileSync(join(root, ".quake-code", "mobile.json"), JSON.stringify({ version: 1, applications: [{ android: { build: "echo test", artifact: "../../escape.apk" } }] }));
    expect(() => loadMobileBuildProfiles(root)).toThrow(/çalışma alanı dışına/);
  });

  it("detects React Native from package dependencies", () => {
    const root = workspace();
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { "react-native": "latest" } }));
    expect(detectMobileProjects(root)[0]).toMatchObject({
      frameworks: ["React Native"],
      languages: ["JavaScript/TypeScript"],
      targets: ["android", "ios"],
    });
  });
});

describe("mobile runtime", () => {
  it("starts Android emulators headlessly for the embedded panel", () => {
    expect(getAndroidEmulatorLaunchArgs("medium_phone")).toEqual([
      "-avd",
      "medium_phone",
      "-no-window",
      "-no-audio",
      "-no-snapshot-load",
      "-no-boot-anim",
    ]);
  });

  it("always exposes independent Android and iOS parallel targets", async () => {
    const android = {
      devices: async () => [],
      capability: async () => ({ platform: "android", available: false, mode: "local" }),
      virtualDevices: async () => [],
    } as unknown as AndroidDeviceDriver;
    const status = await new MobileRuntime(workspace(), { android, startRegistry: false }).getStatus();
    expect(status.version).toBe(1);
    expect(status.targets.map((target) => target.platform)).toEqual(["android", "ios"]);
    expect(Array.isArray(status.buildProfiles)).toBe(true);
    expect(Array.isArray(status.androidVirtualDevices)).toBe(true);
    expect(status.foregroundApps).toBeTypeOf("object");
    expect(status.capabilities.find((item) => item.platform === "ios")?.mode).toMatch(/local|remote-required/);
  });
});
