import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const runtime = readFileSync(join(root, "src/server/runtime.ts"), "utf8");
const protocol = readFileSync(join(root, "src/shared/protocol.ts"), "utf8");
const electronMain = readFileSync(join(root, "electron/main.ts"), "utf8");
const prompts = readFileSync(join(root, "src/server/goal/prompts.ts"), "utf8");
const scheduler = readFileSync(join(root, "src/server/goal/scheduler.ts"), "utf8");
const types = readFileSync(join(root, "src/server/goal/types.ts"), "utf8");
const updateGoal = readFileSync(join(root, "src/server/goal/update-goal.ts"), "utf8");
const updateGoalTool = readFileSync(join(root, "src/server/goal/update-goal-tool.ts"), "utf8");

describe("Goal Runtime v2 integration contracts", () => {
  it("removes self-attested completion and message-end continuation", () => {
    expect(runtime).not.toContain("GOAL_COMPLETE");
    expect(runtime).not.toContain("maybeRunGoalIteration");
    expect(runtime).not.toContain("goalState");
  });

  it("supports unattended recovery and prevents app suspension", () => {
    expect(runtime).toContain("scheduleGoalRecovery");
    expect(runtime).toContain("GOAL RUNTIME RECOVERY");
    expect(electronMain).toContain('powerSaveBlocker.start("prevent-app-suspension")');
  });

  it("exposes durable lifecycle commands", () => {
    expect(protocol).toContain('type: "goal_pause"');
    expect(protocol).toContain('type: "goal_resume"');
    expect(protocol).toContain('type: "goal_cancel"');
    expect(runtime).toContain("new GoalRuntime(host.session.sessionManager)");
  });

  it("ships Codex parity surfaces: update_goal, budget_limited, objective_updated", () => {
    expect(types).toContain("budget_limited");
    expect(types).toContain("tokensUsed");
    expect(types).toContain("blockedStreak");
    expect(prompts).toContain("GOAL RUNTIME CONTINUATION");
    expect(prompts).toContain("GOAL BUDGET LIMIT");
    expect(prompts).toContain("GOAL OBJECTIVE UPDATED");
    expect(prompts).toContain("three consecutive goal turns");
    expect(prompts).toContain('update_goal with status "complete"');
    expect(scheduler).toContain("agent_complete");
    expect(scheduler).toContain("budget_limited");
    expect(updateGoal).toContain('status: UpdateGoalStatus');
    expect(updateGoalTool).toContain('name: UPDATE_GOAL_TOOL_NAME');
    expect(runtime).toContain("createUpdateGoalToolDefinition");
    expect(runtime).toContain("renderGoalObjectiveUpdated");
    expect(runtime).toContain("budgetLimit");
    expect(protocol).toContain("budget_limited");
    expect(protocol).toContain("tokenBudget");
    expect(protocol).toContain("tokensUsed");
  });
});

