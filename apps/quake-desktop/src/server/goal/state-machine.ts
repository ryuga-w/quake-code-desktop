import { randomUUID } from "node:crypto";
import { GOAL_BLOCKED_STREAK_THRESHOLD } from "./prompts.js";
import { GOAL_SCHEMA_VERSION, type GoalRuntimeEvent, type GoalRuntimeState, type GoalStatus } from "./types.js";

const DEFAULT_BUDGET = Object.freeze({ maxTurns: 30, maxStagnantTurns: 5 });

const TRANSITIONS: Readonly<Record<Exclude<GoalRuntimeEvent["type"], "start">, readonly GoalStatus[]>> = {
  begin_execution: ["draft", "planning", "blocked", "budget_limited"],
  record_turn: ["executing"],
  pause: ["planning", "executing", "verifying", "blocked"],
  resume: ["paused", "blocked", "budget_limited"],
  cancel: ["draft", "planning", "executing", "verifying", "paused", "blocked", "budget_limited"],
  begin_verification: ["executing"],
  verification_failed: ["verifying"],
  // Codex agent complete can settle from executing; host verify path uses verifying.
  complete: ["verifying", "executing"],
  block: ["planning", "executing", "verifying"],
  budget_limit: ["planning", "executing", "verifying"],
  agent_complete: ["executing", "verifying"],
  agent_blocked: ["executing", "verifying"],
  note_blocked_attempt: ["executing", "verifying"],
  update_objective: ["planning", "executing", "verifying", "paused", "blocked", "budget_limited"],
  record_tokens: ["planning", "executing", "verifying", "paused", "blocked", "budget_limited"],
  fail: ["planning", "executing", "verifying", "blocked", "budget_limited"],
};

export function createGoalState(event: Extract<GoalRuntimeEvent, { type: "start" }>): GoalRuntimeState {
  const objective = event.objective.trim();
  if (!objective) throw new Error("Goal objective cannot be empty");
  const now = event.now ?? Date.now();
  const tokenBudget = event.budget?.tokenBudget;
  return {
    schemaVersion: GOAL_SCHEMA_VERSION,
    id: event.id || randomUUID(),
    objective,
    status: "planning",
    currentTurn: 0,
    budget: {
      maxTurns: positiveInteger(event.budget?.maxTurns, DEFAULT_BUDGET.maxTurns),
      maxStagnantTurns: positiveInteger(event.budget?.maxStagnantTurns, DEFAULT_BUDGET.maxStagnantTurns),
      ...(typeof tokenBudget === "number" && tokenBudget > 0 ? { tokenBudget } : {}),
    },
    policy: {
      autoRecover: event.policy?.autoRecover !== false,
    },
    criteria: deriveCriteria(objective),
    evidence: [],
    stagnantTurns: 0,
    tokensUsed: 0,
    blockedStreak: 0,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
}

export function transitionGoal(state: GoalRuntimeState, event: Exclude<GoalRuntimeEvent, { type: "start" }>): GoalRuntimeState {
  const allowed = TRANSITIONS[event.type];
  if (!allowed.includes(state.status)) {
    throw new Error(`Invalid goal transition: ${state.status} -> ${event.type}`);
  }
  const now = event.now ?? Date.now();
  const next: GoalRuntimeState = {
    ...state,
    tokensUsed: state.tokensUsed ?? 0,
    blockedStreak: state.blockedStreak ?? 0,
    updatedAt: now,
    revision: state.revision + 1,
  };

  switch (event.type) {
    case "begin_execution":
      return {
        ...next,
        status: "executing",
        currentTurn: Math.max(1, state.currentTurn),
        stopReason: undefined,
        blockedReason: undefined,
        pausedAt: undefined,
        blockedStreak: 0,
        lastBlockedFingerprint: undefined,
      };
    case "record_turn": {
      const progressed = event.fingerprint !== state.lastProgressFingerprint;
      const tokensDelta = Math.max(0, event.tokensDelta ?? 0);
      return {
        ...next,
        currentTurn: state.currentTurn + 1,
        stagnantTurns: progressed ? 0 : state.stagnantTurns + 1,
        lastProgressFingerprint: event.fingerprint,
        lastMessage: event.message,
        evidence: [...state.evidence, ...(event.evidence || [])].slice(-50),
        tokensUsed: (state.tokensUsed ?? 0) + tokensDelta,
        // Blocked×3 audit is NOT tied to progressFingerprint. update_goal tool
        // results (1/3 vs 2/3 text) would otherwise wipe streak every turn on the
        // real agent_end path. Streak is only managed by note_blocked_attempt,
        // resume, begin_execution, and update_objective.
        blockedStreak: state.blockedStreak ?? 0,
        lastBlockedFingerprint: state.lastBlockedFingerprint,
      };
    }
    case "pause":
      return { ...next, status: "paused", pausedAt: now, stopReason: event.reason || "user_paused" };
    case "resume":
      // Codex: resumed run starts a fresh blocked audit.
      return {
        ...next,
        status: "executing",
        pausedAt: undefined,
        stopReason: undefined,
        blockedReason: undefined,
        blockedStreak: 0,
        lastBlockedFingerprint: undefined,
      };
    case "cancel":
      return { ...next, status: "cancelled", stopReason: "user_cancelled" };
    case "begin_verification":
      return { ...next, status: "verifying" };
    case "verification_failed":
      return { ...next, status: "executing", lastMessage: event.message };
    case "complete":
    case "agent_complete": {
      const passedEvidence = state.evidence.filter((item) => item.passed).map((item) => item.id);
      return {
        ...next,
        status: "completed",
        completedAt: now,
        criteria: state.criteria.map((criterion) => ({ ...criterion, status: "passed", evidenceIds: passedEvidence })),
      };
    }
    case "block":
    case "agent_blocked":
      return { ...next, status: "blocked", blockedReason: event.reason };
    case "budget_limit":
      return {
        ...next,
        status: "budget_limited",
        stopReason: "budget_limited",
        blockedReason: event.reason,
      };
    case "note_blocked_attempt": {
      const same = event.fingerprint === state.lastBlockedFingerprint;
      const blockedStreak = same ? (state.blockedStreak ?? 0) + 1 : 1;
      return {
        ...next,
        blockedStreak,
        lastBlockedFingerprint: event.fingerprint,
        blockedReason: event.reason ?? state.blockedReason,
      };
    }
    case "update_objective": {
      const objective = event.objective.trim();
      if (!objective) throw new Error("Goal objective cannot be empty");
      return {
        ...next,
        objective,
        criteria: deriveCriteria(objective),
        stagnantTurns: 0,
        blockedStreak: 0,
        lastBlockedFingerprint: undefined,
        lastProgressFingerprint: undefined,
        status: state.status === "paused" || state.status === "blocked" || state.status === "budget_limited"
          ? "executing"
          : state.status === "planning"
            ? "planning"
            : "executing",
        blockedReason: undefined,
        stopReason: undefined,
        pausedAt: undefined,
      };
    }
    case "record_tokens":
      return { ...next, tokensUsed: (state.tokensUsed ?? 0) + Math.max(0, event.tokensDelta) };
    case "fail":
      return { ...next, status: "failed" };
  }
}

/** Active for auto-continuation / recovery (not terminal). */
export function isGoalActive(state: GoalRuntimeState | undefined): boolean {
  return Boolean(state && ["planning", "executing", "verifying", "blocked"].includes(state.status));
}

/** Running statuses that should receive agent update_goal / auto-continue. */
export function isGoalExecuting(state: GoalRuntimeState | undefined): boolean {
  return Boolean(state && state.status === "executing");
}

export function canAgentBlock(state: GoalRuntimeState): boolean {
  return (state.blockedStreak ?? 0) >= GOAL_BLOCKED_STREAK_THRESHOLD;
}

export function isTokenBudgetExceeded(state: GoalRuntimeState): boolean {
  const budget = state.budget.tokenBudget;
  if (typeof budget !== "number" || budget <= 0) return false;
  return (state.tokensUsed ?? 0) >= budget;
}

function deriveCriteria(objective: string): GoalRuntimeState["criteria"] {
  const explicit = objective.split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]\])\s*/, "").trim())
    .filter((line) => line.length >= 4);
  const values = explicit.length > 1 ? explicit : [objective];
  return values.slice(0, 20).map((text, index) => ({
    id: `criterion-${index + 1}`,
    text,
    required: true,
    status: "pending" as const,
    evidenceIds: [],
  }));
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}
