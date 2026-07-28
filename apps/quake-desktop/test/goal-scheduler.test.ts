import { describe, expect, it } from "vitest";
import {
  decideGoalNextStep,
  findUpdateGoalStatus,
  GOAL_CANDIDATE_COMPLETE,
  UPDATE_GOAL_TOOL_NAME,
  verificationPassed,
} from "../src/server/goal/scheduler";
import { GOAL_BLOCKED_STREAK_THRESHOLD } from "../src/server/goal/prompts";
import { createGoalState, transitionGoal } from "../src/server/goal/state-machine";
import { GoalRuntime } from "../src/server/goal/runtime";
import { applyUpdateGoal } from "../src/server/goal/update-goal";
import { renderGoalContinuation, renderGoalBudgetLimit, renderGoalObjectiveUpdated } from "../src/server/goal/prompts";

function executingGoal(overrides: Record<string, unknown> = {}) {
  const base = transitionGoal(
    createGoalState({ type: "start", objective: "Ship verified feature", id: "goal", now: 1 }),
    { type: "begin_execution", now: 2 },
  );
  return { ...base, ...overrides };
}

class MemorySessionManager {
  entries: any[] = [];
  appendCustomEntry(customType: string, data?: unknown): string {
    const entry = { id: String(this.entries.length + 1), type: "custom", customType, data };
    this.entries.push(entry);
    return entry.id;
  }
  getEntries(): unknown[] {
    return this.entries;
  }
}

describe("Goal scheduler (Codex parity)", () => {
  it("continues incomplete work with Codex continuation contract", () => {
    const decision = decideGoalNextStep(executingGoal(), [], "Implemented the first part");
    expect(decision.type).toBe("continue");
    if (decision.type === "continue") {
      expect(decision.prompt).toContain("GOAL RUNTIME CONTINUATION");
      expect(decision.prompt).toContain("Continue working toward the active thread goal");
      expect(decision.prompt).toContain("Ship verified feature");
      expect(decision.prompt).toContain('update_goal with status "complete"');
      expect(decision.prompt).toContain("three consecutive goal turns");
      expect(decision.prompt).toContain("Do not substitute a narrower");
      expect(decision.prompt).toContain("user-provided data");
    }
  });

  it("attaches a budget wrap-up prompt when turn limit is hit and marks budget_limited", () => {
    const state = executingGoal({ currentTurn: 29 });
    const decision = decideGoalNextStep(state, [], "Still working");
    expect(decision.type).toBe("block");
    if (decision.type === "block") {
      expect(decision.terminal).toBe("budget_limited");
      expect(decision.wrapUpPrompt).toContain("GOAL BUDGET LIMIT");
      expect(decision.wrapUpPrompt).toContain("budget_limited");
      expect(decision.wrapUpPrompt).toContain("Ship verified feature");
      expect(decision.wrapUpPrompt).toContain("Do not call update_goal unless the goal is actually complete");
    }
  });

  it("marks budget_limited when token budget is exhausted", () => {
    const state = executingGoal({
      tokensUsed: 900,
      budget: { maxTurns: 30, maxStagnantTurns: 5, tokenBudget: 1000 },
    });
    const messages = [{
      role: "assistant",
      usage: { input: 80, output: 40, cacheRead: 0, cacheWrite: 0 },
      content: "working",
    }];
    const decision = decideGoalNextStep(state, messages, "working");
    expect(decision.type).toBe("block");
    if (decision.type === "block") {
      expect(decision.terminal).toBe("budget_limited");
      expect(decision.wrapUpPrompt).toContain("GOAL BUDGET LIMIT");
    }
  });

  it("treats GOAL_CANDIDATE_COMPLETE as verification candidate (host reinforcement)", () => {
    const decision = decideGoalNextStep(executingGoal(), [], `Done ${GOAL_CANDIDATE_COMPLETE}`);
    expect(decision.type).toBe("verify");
  });

  it("treats update_goal complete tool result as agent_complete", () => {
    const messages = [{
      role: "toolResult",
      toolName: UPDATE_GOAL_TOOL_NAME,
      details: { status: "complete", ok: true },
      content: "Goal marked complete.",
    }];
    const decision = decideGoalNextStep(executingGoal(), messages, "Done via tool");
    expect(decision.type).toBe("agent_complete");
    expect(findUpdateGoalStatus(messages)).toBe("complete");
  });

  it("blocks work at the turn budget", () => {
    const state = executingGoal({ currentTurn: 29 });
    expect(decideGoalNextStep(state, [], "Still working").type).toBe("block");
  });

  it("requires successful deterministic evidence for verificationPassed", () => {
    const state = executingGoal({
      evidence: [{ id: "1", kind: "typecheck" as const, label: "bash", passed: true, summary: "ok", createdAt: 1 }],
    });
    expect(verificationPassed(state)).toBe(true);
    expect(verificationPassed(executingGoal({ evidence: [] }))).toBe(false);
  });
});

describe("update_goal control surface", () => {
  it("completes via update_goal complete", () => {
    const runtime = new GoalRuntime(new MemorySessionManager());
    runtime.start("Finish the job");
    runtime.beginExecution();
    const result = applyUpdateGoal(runtime, "complete");
    expect(result.ok).toBe(true);
    expect(result.goal?.status).toBe("completed");
  });

  it("enforces blocked×3 before accepting update_goal blocked", () => {
    const runtime = new GoalRuntime(new MemorySessionManager());
    runtime.start("Unblockable without user");
    runtime.beginExecution();

    const first = applyUpdateGoal(runtime, "blocked", { reason: "missing API key" });
    expect(first.ok).toBe(false);
    expect(first.blockedStreak).toBe(1);
    expect(first.blockedThreshold).toBe(GOAL_BLOCKED_STREAK_THRESHOLD);

    const second = applyUpdateGoal(runtime, "blocked", { reason: "missing API key" });
    expect(second.ok).toBe(false);
    expect(second.blockedStreak).toBe(2);

    const third = applyUpdateGoal(runtime, "blocked", { reason: "missing API key" });
    expect(third.ok).toBe(true);
    expect(third.goal?.status).toBe("blocked");
    expect(third.blockedStreak).toBeGreaterThanOrEqual(GOAL_BLOCKED_STREAK_THRESHOLD);
  });

  /**
   * Real agent_end path: update_goal(blocked) → decideGoalNextStep → recordTurn.
   * Streak must survive across turns even when toolResult text differs (1/3 vs 2/3)
   * and would change a naive progress fingerprint that includes update_goal.
   */
  it("preserves blocked×3 streak across goal turns with recordTurn (shipped agent_end path)", () => {
    const runtime = new GoalRuntime(new MemorySessionManager());
    runtime.start("Need user credentials");
    runtime.beginExecution();
    const reason = "missing API key for deploy";

    // --- Turn 1: rejected blocked + agent_end recordTurn ---
    const t1 = applyUpdateGoal(runtime, "blocked", { reason });
    expect(t1.ok).toBe(false);
    expect(t1.blockedStreak).toBe(1);
    const messages1 = [
      {
        role: "toolResult",
        toolName: UPDATE_GOAL_TOOL_NAME,
        isError: true,
        details: { status: "blocked", ok: false, blockedStreak: 1, blockedThreshold: 3 },
        content: "Blocked audit not satisfied (1/3). Keep working.",
      },
    ];
    const d1 = decideGoalNextStep(runtime.snapshot!, messages1, "Still blocked missing API key turn1");
    expect(d1.type).toBe("continue"); // failed blocked must NOT terminalize
    expect(findUpdateGoalStatus(messages1)).toBeUndefined();
    runtime.recordTurn({
      fingerprint: d1.fingerprint,
      message: "Still blocked missing API key turn1",
      evidence: d1.evidence,
      tokensDelta: d1.tokensDelta,
    });
    expect(runtime.snapshot?.status).toBe("executing");
    expect(runtime.snapshot?.blockedStreak).toBe(1);

    // --- Turn 2: same blocker, different tool text 2/3 ---
    const t2 = applyUpdateGoal(runtime, "blocked", { reason });
    expect(t2.ok).toBe(false);
    expect(t2.blockedStreak).toBe(2);
    const messages2 = [
      {
        role: "toolResult",
        toolName: UPDATE_GOAL_TOOL_NAME,
        isError: true,
        details: { status: "blocked", ok: false, blockedStreak: 2, blockedThreshold: 3 },
        content: "Blocked audit not satisfied (2/3). Keep working.",
      },
    ];
    const d2 = decideGoalNextStep(runtime.snapshot!, messages2, "Still blocked missing API key turn2");
    expect(d2.type).toBe("continue");
    runtime.recordTurn({
      fingerprint: d2.fingerprint,
      message: "Still blocked missing API key turn2",
      evidence: d2.evidence,
      tokensDelta: d2.tokensDelta,
    });
    expect(runtime.snapshot?.blockedStreak).toBe(2);

    // --- Turn 3: threshold met → blocked accepted ---
    const t3 = applyUpdateGoal(runtime, "blocked", { reason });
    expect(t3.ok).toBe(true);
    expect(t3.goal?.status).toBe("blocked");
    expect(t3.blockedStreak).toBeGreaterThanOrEqual(GOAL_BLOCKED_STREAK_THRESHOLD);
  });

  it("does not treat failed update_goal(complete) as agent_complete", () => {
    const messages = [{
      role: "toolResult",
      toolName: UPDATE_GOAL_TOOL_NAME,
      isError: true,
      details: { status: "complete", ok: false },
      content: "cannot update goal because this thread has no goal",
    }];
    expect(findUpdateGoalStatus(messages)).toBeUndefined();
    const decision = decideGoalNextStep(executingGoal(), messages, "Trying complete");
    expect(decision.type).not.toBe("agent_complete");
  });

  it("only treats update_goal complete with ok:true as agent_complete", () => {
    const messages = [{
      role: "toolResult",
      toolName: UPDATE_GOAL_TOOL_NAME,
      isError: false,
      details: { status: "complete", ok: true },
      content: "Goal marked complete.",
    }];
    expect(findUpdateGoalStatus(messages)).toBe("complete");
    expect(decideGoalNextStep(executingGoal(), messages, "Done").type).toBe("agent_complete");
  });

  it("resets blocked audit streak on resume (Codex fresh audit)", () => {
    const runtime = new GoalRuntime(new MemorySessionManager());
    runtime.start("Retry after blocked");
    runtime.beginExecution();
    applyUpdateGoal(runtime, "blocked", { reason: "wait" });
    applyUpdateGoal(runtime, "blocked", { reason: "wait" });
    applyUpdateGoal(runtime, "blocked", { reason: "wait" });
    expect(runtime.snapshot?.status).toBe("blocked");
    runtime.resume();
    expect(runtime.snapshot?.blockedStreak).toBe(0);
    const again = applyUpdateGoal(runtime, "blocked", { reason: "wait" });
    expect(again.ok).toBe(false);
    expect(again.blockedStreak).toBe(1);
  });
});

describe("Codex prompt builders", () => {
  it("renders objective_updated with untrusted_objective and budget fields", () => {
    const text = renderGoalObjectiveUpdated({
      objective: "New objective <script>",
      tokensUsed: 10,
      tokenBudget: 100,
    });
    expect(text).toContain("GOAL OBJECTIVE UPDATED");
    expect(text).toContain("untrusted_objective");
    expect(text).toContain("New objective &lt;script&gt;");
    expect(text).toContain("Tokens remaining: 90");
    expect(text).toContain("Do not call update_goal unless the updated goal is actually complete");
  });

  it("renders continuation budget as none/unbounded when no token budget", () => {
    const text = renderGoalContinuation({ objective: "Ship it", tokensUsed: 0 });
    expect(text).toContain("Token budget: none");
    expect(text).toContain("Tokens remaining: unbounded");
  });

  it("renders budget_limit with budget_limited marker", () => {
    const text = renderGoalBudgetLimit({
      objective: "Ship it",
      maxTurns: 30,
      tokensUsed: 500,
      tokenBudget: 500,
      timeUsedSeconds: 12,
    });
    expect(text).toContain("budget_limited");
    expect(text).toContain("Tokens used: 500");
  });
});
