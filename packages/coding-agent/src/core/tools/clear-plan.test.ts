import { describe, expect, it, vi } from "vitest";
import { createClearPlanToolDefinition } from "./clear-plan.js";
import { ALL_BUILTIN_TOOL_NAMES, allTools } from "./index.js";
import { addPlanClearListener } from "../plan-update-bus.js";

describe("clear_plan core tool", () => {
  it("is a builtin always-on tool name", () => {
    expect("clear_plan" in allTools).toBe(true);
    expect(ALL_BUILTIN_TOOL_NAMES).toContain("clear_plan");
  });

  it("broadcasts via the process-global bus (builtin tools run without ctx)", async () => {
    const seen: number[] = [];
    const off = addPlanClearListener(() => seen.push(1));
    const def = createClearPlanToolDefinition();
    const result = await def.execute("c1", { reason: "task done" }, undefined, undefined, undefined as any);
    off();
    expect(seen.length).toBe(1);
    expect(result.content?.[0]).toMatchObject({ type: "text", text: "Plan panel cleared" });
    expect(result.details).toMatchObject({ ok: true, reason: "task done" });
  });

  it("also calls ctx.clearPlan when a context is available", async () => {
    const clearPlan = vi.fn();
    const def = createClearPlanToolDefinition();
    await def.execute("c2", {}, undefined, undefined, { clearPlan } as any);
    expect(clearPlan).toHaveBeenCalledOnce();
  });
});
