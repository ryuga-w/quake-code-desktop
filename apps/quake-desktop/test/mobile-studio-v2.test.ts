import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectMobileProjects } from "../src/server/mobile/project-detector.js";
import { loadMobileBuildProfiles, readMobileConfig } from "../src/server/mobile/build-config.js";
import { accessibilityAudit } from "../src/server/mobile/quality-lab.js";
import { MobileApiError, MobileRateLimiter, requireDeviceId, requirePackage } from "../src/server/mobile/validation.js";

const roots: string[] = [];
function root() { const path = mkdtempSync(join(tmpdir(), "quake-mobile-v2-")); roots.push(path); return path; }
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

describe("mobile studio v2 behavior", () => {
  it("discovers only Android application modules in monorepos", () => {
    const workspace = root(); mkdirSync(join(workspace, "apps", "phone", "app"), { recursive: true });
    writeFileSync(join(workspace, "apps", "phone", "settings.gradle"), "include ':app'");
    writeFileSync(join(workspace, "apps", "phone", "app", "build.gradle"), "plugins { id 'com.android.application' }\nandroid { defaultConfig { applicationId 'com.test.phone' } }");
    expect(detectMobileProjects(workspace)).toEqual([expect.objectContaining({ name: "phone:app", targets: ["android"] })]);
  });

  it("keeps automatic profiles alive when custom JSON is malformed", () => {
    const workspace = root(); mkdirSync(join(workspace, ".quake-code")); mkdirSync(join(workspace, "android"));
    writeFileSync(join(workspace, ".quake-code", "mobile.json"), "{");
    writeFileSync(join(workspace, "android", process.platform === "win32" ? "gradlew.bat" : "gradlew"), "");
    expect(readMobileConfig(workspace).diagnostics[0]?.code).toBe("INVALID_JSON");
    expect(loadMobileBuildProfiles(workspace).some((profile) => profile.adapter === "gradle")).toBe(true);
  });

  it("reports accessibility names and touch targets", () => {
    const report = accessibilityAudit({ platform: "android", deviceId: "x", snapshotId: "s", revision: 1, capturedAt: new Date().toISOString(), nodes: [{ index: 0, ref: "m:a.0", fingerprint: "a.0", clickable: true, enabled: true, focused: false, bounds: { left: 0, top: 0, right: 20, bottom: 20 } }] });
    expect(report.passed).toBe(false); expect(report.issues.map((issue) => issue.rule)).toEqual(["clickable-name", "touch-target"]);
  });

  it("validates mobile API ownership and rate limits", () => {
    expect(requireDeviceId("emulator-5554")).toBe("emulator-5554"); expect(requirePackage("com.example.app")).toBe("com.example.app");
    expect(() => requirePackage("bad package")).toThrow(MobileApiError);
    const limiter = new MobileRateLimiter(); limiter.check("test", 1); expect(() => limiter.check("test", 1)).toThrow(/fazla/);
  });
});
