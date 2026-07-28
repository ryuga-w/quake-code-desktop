import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Desktop development agent directory", () => {
  it("uses the Desktop-owned config instead of an inherited CLI directory", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const launcher = readFileSync(join(process.cwd(), "scripts/run-desktop-server.mjs"), "utf8");

    expect(packageJson.scripts?.["desktop:dev"]).toContain("tsx scripts/run-desktop-server.mjs");
    expect(launcher).toContain("QUAKE_DESKTOP_CONFIG_ROOT");
    expect(launcher).toContain("process.env.APPDATA");
    expect(launcher).toContain("process.env.QUAKE_CODE_CODING_AGENT_DIR = join(resolveDesktopConfigRoot(), \"agent\")");
    expect(launcher).toContain('await import("../src/server/index.ts")');
  });
});
