import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const main = readFileSync(resolve(root, "src/client/src/app/App.tsx"), "utf8");
const shell = readFileSync(resolve(root, "src/client/src/app/AppShell.tsx"), "utf8");
const types = readFileSync(resolve(root, "src/client/src/types.ts"), "utf8");
const launcher = readFileSync(resolve(root, "src/client/src/components/chrome/QuickLauncher.tsx"), "utf8");
const server = readFileSync(resolve(root, "src/server/index.ts"), "utf8");
const mobilePanel = readFileSync(resolve(root, "src/client/src/components/dock/MobileStudioPanel.tsx"), "utf8");
const mobileTools = readFileSync(resolve(root, "../../packages/coding-agent/src/bundled/extensions/quake-mobile-tools/index.ts"), "utf8");

describe("Mobile Studio integration contract", () => {
  it("is a session-owned dock surface", () => {
    expect(types).toContain('"files" | "browser" | "mobile" | "plan"');
    expect(shell).toContain('rightTab === "mobile"');
    expect(shell).toContain("<MobileStudioPanel");
    expect(main).toContain("useRightDock");
    expect(launcher).toContain('panel: "mobile"');
  });

  it("exposes status, screenshot, and action APIs", () => {
    expect(server).toContain('url.pathname === "/api/mobile/status"');
    expect(server).toContain('url.pathname === "/api/mobile/build"');
    expect(server).toContain('url.pathname === "/api/mobile/emulator/start"');
    expect(server).toContain('url.pathname === "/api/mobile/emulator/stop"');
    expect(server).toContain('url.pathname === "/api/mobile/emulator/restart"');
    expect(server).toContain('url.pathname === "/api/mobile/logs"');
    expect(server).toContain('url.pathname === "/api/mobile/screenshot"');
    expect(server).toContain('url.pathname === "/api/mobile/snapshot"');
    expect(server).toContain('url.pathname === "/api/mobile/action"');
  });

  it("only streams screenshots for ready devices with header authentication", () => {
    expect(mobilePanel).toContain('"X-Quake-Web-Token": authToken');
    expect(mobilePanel).not.toContain("&token=${encodeURIComponent(authToken)}");
    expect(mobilePanel).toContain('item.status === "ready"');
    expect(mobilePanel).toContain("/api/mobile/emulator/restart");
  });

  it("registers semantic mobile tools for the agent", () => {
    for (const tool of ["mobile_status", "mobile_start_device", "mobile_snapshot", "mobile_screenshot", "mobile_tap", "mobile_type", "mobile_swipe", "mobile_press", "mobile_logs", "mobile_build", "mobile_build_parallel"]) {
      expect(mobileTools).toContain(`name: "${tool}"`);
    }
    expect(mobileTools).toContain("Always call mobile_snapshot first");
    expect(mobileTools).toContain('type: "image" as const');
  });
});
