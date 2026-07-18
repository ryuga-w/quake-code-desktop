/**
 * Agent-facing update_goal control surface (Codex update_goal tool semantics).
 * Only complete | blocked are agent-settable; pause/resume/budget_limited are host/user.
 */

import { createHash } from "node:crypto";
import { GOAL_BLOCKED_STREAK_THRESHOLD } from "./prompts.js";
import type { GoalRuntime } from "./runtime.js";
import type { GoalRuntimeState, UpdateGoalStatus } from "./types.js";

export interface UpdateGoalResult {
  ok: boolean;
  error?: string;
  goal?: GoalRuntimeState;
  remainingTokens?: number | null;
  completionBudgetReport?: string;
  blockedStreak?: number;
  blockedThreshold?: number;
}

export function applyUpdateGoal(
  runtime: GoalRuntime,
  status: UpdateGoalStatus,
  options?: { reason?: string; blockedFingerprint?: string },
): UpdateGoalResult {
  const snapshot = runtime.snapshot;
  if (!snapshot) {
    return { ok: false, error: "cannot update goal because this thread has no goal" };
  }
  if (!["executing", "verifying"].includes(snapshot.status)) {
    return {
      ok: false,
      error: `update_goal can only run while the goal is executing or verifying (current: ${snapshot.status})`,
    };
  }

  if (status === "complete") {
    const goal = runtime.agentComplete();
    return {
      ok: true,
      goal,
      remainingTokens: remainingTokens(goal),
      completionBudgetReport: completionBudgetReport(goal),
    };
  }

  // blocked — enforce Codex ×3 consecutive blocked-audit threshold host-side.
  const fingerprint = options?.blockedFingerprint
    || createHash("sha256").update(options?.reason || "blocked").digest("hex").slice(0, 16);
  const noted = runtime.noteBlockedAttempt({ fingerprint, reason: options?.reason });
  if ((noted.blockedStreak ?? 0) < GOAL_BLOCKED_STREAK_THRESHOLD) {
    return {
      ok: false,
      error:
        `Blocked audit not satisfied (${noted.blockedStreak}/${GOAL_BLOCKED_STREAK_THRESHOLD}). ` +
        "Only call update_goal with status blocked after the same blocking condition repeats for at least three consecutive goal turns. Keep working.",
      goal: noted,
      blockedStreak: noted.blockedStreak,
      blockedThreshold: GOAL_BLOCKED_STREAK_THRESHOLD,
    };
  }

  const goal = runtime.agentBlocked(options?.reason || "Agent reported blocked after blocked×3 audit");
  return {
    ok: true,
    goal,
    remainingTokens: remainingTokens(goal),
    blockedStreak: goal.blockedStreak,
    blockedThreshold: GOAL_BLOCKED_STREAK_THRESHOLD,
  };
}

export function remainingTokens(goal: GoalRuntimeState): number | null {
  const budget = goal.budget.tokenBudget;
  if (typeof budget !== "number" || budget <= 0) return null;
  return Math.max(0, budget - (goal.tokensUsed ?? 0));
}

export function completionBudgetReport(goal: GoalRuntimeState): string | undefined {
  if (goal.status !== "completed") return undefined;
  if (goal.budget.tokenBudget == null && timeUsedSeconds(goal) <= 0) return undefined;
  return (
    "Goal achieved. Report final usage from this tool result's structured goal fields. " +
    "If tokenBudget is present, include token usage from tokensUsed and tokenBudget. " +
    "If elapsed time is greater than 0, summarize it in a concise, human-friendly form."
  );
}

function timeUsedSeconds(goal: GoalRuntimeState): number {
  const end = goal.completedAt || goal.updatedAt || Date.now();
  return Math.max(0, Math.floor((end - goal.createdAt) / 1000));
}

/** Description text aligned with Codex create_update_goal_tool. */
export const UPDATE_GOAL_TOOL_DESCRIPTION = `Update the existing goal.
Use this tool only to mark the goal achieved or genuinely blocked.
Set status to \`complete\` only when the objective has actually been achieved and no required work remains.
Set status to \`blocked\` only when the same blocking condition has repeated for at least three consecutive goal turns, counting the original/user-triggered turn and any automatic continuations, and the agent cannot make meaningful progress without user input or an external-state change.
If the user resumes a goal that was previously marked \`blocked\`, treat the resumed run as a fresh blocked audit. If the same blocking condition then repeats for at least three consecutive resumed goal turns, set status to \`blocked\` again.
Once the blocked threshold is satisfied, do not keep reporting that you are still blocked while leaving the goal active; set status to \`blocked\`.
Do not use \`blocked\` merely because the work is hard, slow, uncertain, incomplete, or would benefit from clarification.
Do not mark a goal complete merely because its budget is nearly exhausted or because you are stopping work.
You cannot use this tool to pause, resume, budget-limit, or usage-limit a goal; those status changes are controlled by the user or system.
When marking a budgeted goal achieved with status \`complete\`, report the final token usage from the tool result to the user.`;
