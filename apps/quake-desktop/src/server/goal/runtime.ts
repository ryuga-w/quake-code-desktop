import { GoalStore } from "./store.js";
import { createGoalState, isGoalActive, transitionGoal } from "./state-machine.js";
import type { GoalEvidence, GoalRuntimeEvent, GoalRuntimeState, GoalSessionManager } from "./types.js";

export class GoalRuntime {
  private readonly store: GoalStore;
  private state: GoalRuntimeState | undefined;

  constructor(sessionManager: GoalSessionManager) {
    this.store = new GoalStore(sessionManager);
    this.state = this.store.load();
  }

  get snapshot(): GoalRuntimeState | undefined {
    return this.state ? structuredClone(this.state) : undefined;
  }

  get active(): boolean {
    return isGoalActive(this.state);
  }

  start(objective: string, options?: {
    maxTurns?: number;
    maxStagnantTurns?: number;
    tokenBudget?: number;
    autoRecover?: boolean;
  }): GoalRuntimeState {
    const event: Extract<GoalRuntimeEvent, { type: "start" }> = {
      type: "start",
      objective,
      budget: options,
      policy: { autoRecover: options?.autoRecover !== false },
    };
    this.state = this.store.save(event.type, createGoalState(event));
    return this.snapshot!;
  }

  beginExecution(): GoalRuntimeState {
    return this.apply({ type: "begin_execution" });
  }

  recordTurn(input: {
    fingerprint: string;
    message: string;
    evidence?: GoalEvidence[];
    tokensDelta?: number;
  }): GoalRuntimeState {
    return this.apply({ type: "record_turn", ...input });
  }

  beginVerification(): GoalRuntimeState {
    return this.apply({ type: "begin_verification" });
  }

  verificationFailed(message: string): GoalRuntimeState {
    return this.apply({ type: "verification_failed", message });
  }

  complete(): GoalRuntimeState {
    return this.apply({ type: "complete" });
  }

  /** Codex update_goal complete — terminal complete from executing/verifying. */
  agentComplete(): GoalRuntimeState {
    return this.apply({ type: "agent_complete" });
  }

  block(reason?: string): GoalRuntimeState {
    return this.apply({ type: "block", reason });
  }

  /** Codex update_goal blocked. */
  agentBlocked(reason?: string): GoalRuntimeState {
    return this.apply({ type: "agent_blocked", reason });
  }

  /** Codex budgetLimited terminal status. */
  budgetLimit(reason?: string): GoalRuntimeState {
    return this.apply({ type: "budget_limit", reason });
  }

  noteBlockedAttempt(input: { fingerprint: string; reason?: string }): GoalRuntimeState {
    return this.apply({ type: "note_blocked_attempt", ...input });
  }

  updateObjective(objective: string): GoalRuntimeState {
    return this.apply({ type: "update_objective", objective });
  }

  recordTokens(tokensDelta: number): GoalRuntimeState {
    return this.apply({ type: "record_tokens", tokensDelta });
  }

  fail(): GoalRuntimeState {
    return this.apply({ type: "fail" });
  }

  pause(reason: "user_paused" | "session_aborted" = "user_paused"): GoalRuntimeState {
    return this.apply({ type: "pause", reason });
  }

  resume(): GoalRuntimeState {
    return this.apply({ type: "resume" });
  }

  cancel(): GoalRuntimeState {
    return this.apply({ type: "cancel" });
  }

  private apply(event: Exclude<GoalRuntimeEvent, { type: "start" }>): GoalRuntimeState {
    if (!this.state) throw new Error("No goal exists for this session");
    this.state = this.store.save(event.type, transitionGoal(this.state, event));
    return this.snapshot!;
  }
}
