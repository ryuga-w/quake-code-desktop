import { describe, expect, it } from "vitest";
import { dedupeModels } from "../src/client/src/lib/models";

describe("dedupeModels", () => {
  it("keeps one entry per provider/id", () => {
    const input = [
      { provider: "nvidia-direct", id: "z-ai/glm-5.1", configured: true },
      { provider: "nvidia-direct", id: "z-ai/glm-5.1", configured: false },
      { provider: "nvidia-direct", id: "qwen/qwen3.5-397b-a17b", configured: true },
      { provider: "nvidia-direct", id: "qwen/qwen3.5-397b-a17b", configured: true },
    ];
    const out = dedupeModels(input);
    expect(out).toHaveLength(2);
    expect(out.map((m) => `${m.provider}/${m.id}`).sort()).toEqual([
      "nvidia-direct/qwen/qwen3.5-397b-a17b",
      "nvidia-direct/z-ai/glm-5.1",
    ]);
    expect(out.find((m) => m.id === "z-ai/glm-5.1")?.configured).toBe(true);
  });

  it("prefers the current model when duplicates exist", () => {
    const out = dedupeModels([
      { provider: "p", id: "a", current: false },
      { provider: "p", id: "a", current: true },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.current).toBe(true);
  });
});