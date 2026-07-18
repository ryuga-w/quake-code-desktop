import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_COMPUTER_USE_POLICY,
  loadComputerUsePolicy,
  saveComputerUsePolicy,
} from "../src/server/computer-use";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "quake-desktop-computer-use-"));
}

describe("computer-use policy", () => {
  let cwd = "";

  afterEach(() => {
    if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
    cwd = "";
  });

  it("returns defaults when policy file is missing", () => {
    cwd = tempDir();
    expect(loadComputerUsePolicy(cwd)).toEqual(DEFAULT_COMPUTER_USE_POLICY);
  });

  it("persists actuate and toolMode settings", () => {
    cwd = tempDir();
    const saved = saveComputerUsePolicy(cwd, {
      actuateEnabled: true,
      stepLimit: 25,
      toolMode: "claude_native",
    });
    expect(saved.actuateEnabled).toBe(true);
    expect(saved.stepLimit).toBe(25);
    expect(saved.toolMode).toBe("claude_native");
    expect(loadComputerUsePolicy(cwd).toolMode).toBe("claude_native");
  });
});