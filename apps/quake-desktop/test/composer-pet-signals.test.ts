import { describe, expect, it } from "vitest";
import {
  composerPetContextUsage,
  composerPetFileKind,
  composerPetToolKind,
  deriveComposerPetRuntimeSignals,
} from "../src/client/src/components/composer/composer-pet-signals";
import type { ToolCardState } from "../src/client/src/state/app-store";

function tool(
  id: string,
  toolName: string,
  status: string,
  updatedAt: number,
  args?: unknown,
): ToolCardState {
  return { id, toolName, status, updatedAt, args };
}

describe("composer pet runtime signals", () => {
  it("maps real tool names to physical prop families", () => {
    expect(composerPetToolKind("functions.read")).toBe("read");
    expect(composerPetToolKind("grep")).toBe("search");
    expect(composerPetToolKind("web_search")).toBe("search");
    expect(composerPetToolKind("bash")).toBe("shell");
    expect(composerPetToolKind("apply_patch")).toBe("write");
    expect(composerPetToolKind("browser_navigate")).toBe("browser");
    expect(composerPetToolKind("spawn_agent")).toBe("subagent");
  });

  it("classifies attachment props and context load without fake state", () => {
    expect(composerPetFileKind([{ name: "shot.png", type: "image/png" }])).toBe("image");
    expect(composerPetFileKind([{ name: "guide.pdf", type: "application/pdf" }])).toBe("pdf");
    expect(composerPetFileKind([{ name: "App.tsx", type: "text/plain" }])).toBe("code");
    expect(composerPetFileKind([{ name: "notes.txt", type: "text/plain" }])).toBe("text");
    expect(composerPetFileKind([
      { name: "shot.png", type: "image/png" },
      { name: "App.tsx", type: "text/plain" },
    ])).toBe("mixed");

    expect(composerPetContextUsage({ tokens: 50, contextWindow: 100, percent: 50 }).load).toBe("carrying");
    expect(composerPetContextUsage({ tokens: 76, contextWindow: 100, percent: 76 }).load).toBe("heavy");
    expect(composerPetContextUsage({ tokens: 95, contextWindow: 100, percent: 95 }).load).toBe("critical");
    expect(composerPetContextUsage({ tokens: 10, contextWindow: 100, percent: 10 }).load).toBeUndefined();
    expect(composerPetContextUsage({ tokens: null, contextWindow: 100, percent: null })).toEqual({});
  });

  it("selects the newest active tool and latest settled outcome", () => {
    const signals = deriveComposerPetRuntimeSignals({
      oldRead: tool("oldRead", "read", "running", 10),
      activeShell: tool("activeShell", "bash", "streaming", 30),
      success: tool("success", "edit", "done", 15),
      failure: tool("failure", "grep", "error", 25),
    }, []);

    expect(signals.activeToolKind).toBe("shell");
    expect(signals.toolOutcome).toEqual({ key: "failure:error", status: "error" });
  });

  it("emits launch and return phases from real subagent records", () => {
    const spawn = tool("spawn-1", "spawn_agent", "running", 10, { name: "Hilbert" });
    const active = deriveComposerPetRuntimeSignals({ "spawn-1": spawn }, []);
    expect(active.subagent).toEqual({ key: "Hilbert:active", phase: "active" });
    expect(active.subagentActive).toBe(true);
    expect(active.activeToolKind).toBeUndefined();

    const completed = deriveComposerPetRuntimeSignals({
      "spawn-1": { ...spawn, status: "done", updatedAt: 12 },
    }, [{
      customType: "subagent-notification",
      timestamp: 20,
      details: { id: "Hilbert", name: "Hilbert", status: "completed" },
    }]);
    expect(completed.subagent).toEqual({ key: "Hilbert:completed", phase: "completed" });
    expect(completed.subagentActive).toBe(false);
  });
});
