import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const runtime = readFileSync(join(root, "src/server/runtime.ts"), "utf8");
const protocol = readFileSync(join(root, "src/shared/protocol.ts"), "utf8");
const serverEvents = readFileSync(
  join(root, "src/client/src/app/sse/createServerEventHandlers.ts"),
  "utf8",
);
const clearPlanTool = readFileSync(
  resolve(root, "../../packages/coding-agent/src/core/tools/clear-plan.ts"),
  "utf8",
);
const toolsIndex = readFileSync(
  resolve(root, "../../packages/coding-agent/src/core/tools/index.ts"),
  "utf8",
);

describe("Agent-decided plan dismissal (clear_plan)", () => {
  it("does NOT auto-clear the plan on turn completion (crash-safety)", () => {
    const idx = runtime.indexOf('lifecycleEvent.type === "turn_completed"');
    expect(idx).toBeGreaterThan(-1);
    const branch = runtime.slice(idx, idx + 700);
    // The turn_completed branch must not wipe plan state, because
    // handleRunFailure also emits agent_end -> turn_completed on errors.
    expect(branch).not.toContain("slot.planUpdate = undefined");
    expect(branch).not.toContain("slot.proposedPlan = undefined");
  });

  it("clears plan state only on the explicit plan/cleared event", () => {
    const idx = runtime.indexOf('event.type === "plan/cleared"');
    expect(idx).toBeGreaterThan(-1);
    const branch = runtime.slice(idx, idx + 700);
    expect(branch).toContain("slot.planUpdate = undefined");
    expect(branch).toContain("slot.proposedPlan = undefined");
    expect(branch).toContain("slot.planCleared = true");
    expect(branch).toContain('this.hub.send({ type: "plan_cleared" }');
  });

  it("suppresses the persisted plan-item markdown after a plan-cleared marker", () => {
    expect(runtime).toContain('entry.customType === "plan-cleared"');
    expect(runtime).toContain("persistedCleared");
    expect(runtime).toContain("const markdownCleared = checklistCleared || persistedCleared");
  });

  it("lets a fresh update_plan re-show the checklist after a clear (live flag only)", () => {
    // Live checklist visibility follows only the live slot flag so a new
    // update_plan after clear_plan shows again.
    expect(runtime).toContain("const checklistCleared = Boolean(slot?.planCleared)");
    expect(runtime).toContain("checklistCleared ? [] : slot?.planUpdate?.plan");
    // turn/plan/updated resets the dismissal flag.
    const idx = runtime.indexOf('event.type === "turn/plan/updated"');
    const branch = runtime.slice(idx, idx + 300);
    expect(branch).toContain("slot.planCleared = false");
  });

  it("declares the plan_cleared server message", () => {
    expect(protocol).toContain('type: "plan_cleared"');
  });

  it("closes the plan tab on the client when plan_cleared arrives", () => {
    expect(serverEvents).toContain('event.type === "plan_cleared"');
    expect(serverEvents).toContain("ctx.closePlanTab()");
  });

  it("registers clear_plan as a builtin tool", () => {
    expect(toolsIndex).toContain("clear_plan: clearPlanTool");
    expect(toolsIndex).toContain("createClearPlanToolDefinition()");
  });

  it("instructs the agent to only clear when work is fully finished", () => {
    expect(clearPlanTool).toContain('name: "clear_plan"');
    expect(clearPlanTool).toMatch(/only when work is fully complete/i);
    expect(clearPlanTool).toMatch(/interrupted, blocked, or errored/i);
  });
});
