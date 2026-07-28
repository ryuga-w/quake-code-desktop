import { describe, expect, it } from "vitest";
import { GoalRuntime } from "../src/server/goal/runtime";
import { GOAL_STORE_ENTRY_TYPE } from "../src/server/goal/types";

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

describe("Goal Runtime v2", () => {
  it("persists a goal and restores it after runtime recreation", () => {
    const session = new MemorySessionManager();
    const runtime = new GoalRuntime(session);
    const started = runtime.start("Ship verified pagination", { maxTurns: 8, tokenBudget: 50_000 });
    runtime.beginExecution();

    const restored = new GoalRuntime(session).snapshot;
    expect(restored?.id).toBe(started.id);
    expect(restored?.objective).toBe("Ship verified pagination");
    expect(restored?.status).toBe("executing");
    expect(restored?.budget.maxTurns).toBe(8);
    expect(restored?.budget.tokenBudget).toBe(50_000);
    expect(restored?.tokensUsed).toBe(0);
    expect(restored?.blockedStreak).toBe(0);
    expect(restored?.policy.autoRecover).toBe(true);
    expect(session.entries.every((entry) => entry.customType === GOAL_STORE_ENTRY_TYPE)).toBe(true);
  });

  it("persists unattended recovery policy with the goal", () => {
    const session = new MemorySessionManager();
    const runtime = new GoalRuntime(session);
    runtime.start("Stay paused after restart", { autoRecover: false });
    runtime.beginExecution();

    expect(new GoalRuntime(session).snapshot?.policy.autoRecover).toBe(false);
  });

  it("supports durable pause, resume, and cancel transitions", () => {
    const session = new MemorySessionManager();
    const runtime = new GoalRuntime(session);
    runtime.start("Create Goal Runtime v2");
    runtime.beginExecution();

    runtime.recordTurn({ fingerprint: "first-change", message: "Implemented first step" });
    expect(runtime.snapshot?.currentTurn).toBe(2);
    expect(runtime.pause().status).toBe("paused");
    expect(new GoalRuntime(session).snapshot?.status).toBe("paused");
    expect(runtime.resume().status).toBe("executing");
    expect(runtime.cancel().status).toBe("cancelled");
    expect(runtime.active).toBe(false);
  });

  it("uses unattended-work defaults and can recover a blocked goal", () => {
    const runtime = new GoalRuntime(new MemorySessionManager());
    const started = runtime.start("Finish while the user is away");
    expect(started.budget).toEqual({ maxTurns: 30, maxStagnantTurns: 5 });
    runtime.beginExecution();
    runtime.block();
    expect(runtime.resume().status).toBe("executing");
  });

  it("supports budget_limited terminal and resume", () => {
    const runtime = new GoalRuntime(new MemorySessionManager());
    runtime.start("Budgeted work", { tokenBudget: 100 });
    runtime.beginExecution();
    expect(runtime.budgetLimit("token budget exhausted").status).toBe("budget_limited");
    expect(runtime.snapshot?.stopReason).toBe("budget_limited");
    expect(runtime.resume().status).toBe("executing");
  });

  it("updates objective mid-run and resets blocked audit", () => {
    const runtime = new GoalRuntime(new MemorySessionManager());
    runtime.start("Old objective");
    runtime.beginExecution();
    runtime.noteBlockedAttempt({ fingerprint: "x", reason: "stuck" });
    expect(runtime.snapshot?.blockedStreak).toBe(1);
    const updated = runtime.updateObjective("New objective supersedes old");
    expect(updated.objective).toBe("New objective supersedes old");
    expect(updated.blockedStreak).toBe(0);
    expect(updated.status).toBe("executing");
  });

  it("agent_complete settles without verification state", () => {
    const runtime = new GoalRuntime(new MemorySessionManager());
    runtime.start("Done by agent");
    runtime.beginExecution();
    expect(runtime.agentComplete().status).toBe("completed");
  });

  it("accumulates tokens on record_turn", () => {
    const runtime = new GoalRuntime(new MemorySessionManager());
    runtime.start("Token track", { tokenBudget: 1000 });
    runtime.beginExecution();
    runtime.recordTurn({ fingerprint: "a", message: "step", tokensDelta: 120 });
    runtime.recordTurn({ fingerprint: "b", message: "step2", tokensDelta: 80 });
    expect(runtime.snapshot?.tokensUsed).toBe(200);
  });

  it("rejects invalid lifecycle transitions", () => {
    const runtime = new GoalRuntime(new MemorySessionManager());
    runtime.start("Do not silently skip verification");
    expect(() => runtime.resume()).toThrow("Invalid goal transition");
  });

  it("does not restore malformed or legacy entries", () => {
    const session = new MemorySessionManager();
    session.entries.push({ type: "custom", customType: GOAL_STORE_ENTRY_TYPE, data: { schemaVersion: 1 } });
    expect(new GoalRuntime(session).snapshot).toBeUndefined();
  });
});
