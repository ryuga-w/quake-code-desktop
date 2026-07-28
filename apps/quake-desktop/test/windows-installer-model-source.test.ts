import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Windows GPT-5.6 SOL bootstrap metadata", () => {
  it("installs the full model context and output limits", () => {
    const installer = readFileSync(join(process.cwd(), "scripts/install-quake-code-windows.bat"), "utf8");
    expect(installer).toContain('id = "gpt-56-sol-deploy"');
    expect(installer).toContain("contextWindow = 1050000");
    expect(installer).toContain("maxTokens = 128000");
    expect(installer).not.toContain("contextWindow = 200000");
  });
});
