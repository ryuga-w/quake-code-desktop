export const GOAL_STORE_ENTRY_TYPE = "goal-runtime-v2";
export const GOAL_SCHEMA_VERSION = 2;

/** Quake lifecycle statuses; `budget_limited` mirrors Codex ThreadGoalStatus.budgetLimited. */
export type GoalStatus =
  | "draft"
  | "planning"
  | "executing"
  | "verifying"
  | "paused"
  | "blocked"
  | "budget_limited"
  | "completed"
  | "failed"
  | "cancelled";

export type GoalStopReason = "user_paused" | "user_cancelled" | "session_aborted" | "legacy_import" | "budget_limited";

export interface GoalBudget {
  maxTurns: number;
  maxStagnantTurns: number;
  /** Optional token budget (Codex token_budget). Omitted/undefined = unbounded tokens. */
  tokenBudget?: number;
}

export interface GoalPolicy {
  autoRecover: boolean;
}

export interface GoalCriterion {
  id: string;
  text: string;
  required: boolean;
  status: "pending" | "passed" | "failed" | "unknown";
  evidenceIds: string[];
}

export interface GoalEvidence {
  id: string;
  kind: "tool" | "test" | "build" | "typecheck" | "agent_report";
  label: string;
  passed: boolean;
  summary: string;
  createdAt: number;
}

export interface GoalRuntimeState {
  schemaVersion: typeof GOAL_SCHEMA_VERSION;
  id: string;
  objective: string;
  status: GoalStatus;
  currentTurn: number;
  budget: GoalBudget;
  policy: GoalPolicy;
  criteria: GoalCriterion[];
  evidence: GoalEvidence[];
  stagnantTurns: number;
  /** Cumulative tokens attributed to this goal (Codex tokens_used). */
  tokensUsed: number;
  /**
   * Consecutive goal turns with the same blocking condition fingerprint.
   * Resets on resume and on progress. Used for Codex blocked×3 audit enforcement.
   */
  blockedStreak: number;
  lastBlockedFingerprint?: string;
  lastProgressFingerprint?: string;
  lastMessage?: string;
  createdAt: number;
  updatedAt: number;
  pausedAt?: number;
  completedAt?: number;
  stopReason?: GoalStopReason;
  blockedReason?: string;
  revision: number;
}

export type GoalRuntimeEvent =
  | { type: "start"; objective: string; id?: string; now?: number; budget?: Partial<GoalBudget>; policy?: Partial<GoalPolicy> }
  | { type: "begin_execution"; now?: number }
  | { type: "record_turn"; now?: number; fingerprint: string; message: string; evidence?: GoalEvidence[]; tokensDelta?: number }
  | { type: "pause"; now?: number; reason?: GoalStopReason }
  | { type: "resume"; now?: number }
  | { type: "cancel"; now?: number }
  | { type: "begin_verification"; now?: number }
  | { type: "verification_failed"; now?: number; message: string }
  | { type: "complete"; now?: number }
  | { type: "block"; now?: number; reason?: string }
  | { type: "budget_limit"; now?: number; reason?: string }
  | { type: "agent_complete"; now?: number }
  | { type: "agent_blocked"; now?: number; reason?: string }
  | { type: "note_blocked_attempt"; now?: number; fingerprint: string; reason?: string }
  | { type: "update_objective"; now?: number; objective: string }
  | { type: "record_tokens"; now?: number; tokensDelta: number }
  | { type: "fail"; now?: number };

export interface GoalStoreEntry {
  schemaVersion: typeof GOAL_SCHEMA_VERSION;
  event: GoalRuntimeEvent["type"];
  state: GoalRuntimeState;
}

export interface GoalSessionManager {
  appendCustomEntry(customType: string, data?: unknown): string;
  getEntries(): unknown[];
}

/** Agent-facing update_goal statuses (Codex update_goal tool). */
export type UpdateGoalStatus = "complete" | "blocked";
