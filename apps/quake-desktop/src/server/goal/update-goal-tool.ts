/**
 * Runtime tool definition for agent update_goal (registered via session.registerRuntimeTool).
 */

import type { ToolDefinition } from "@mrquake/quakecode-cli";
import { UPDATE_GOAL_TOOL_NAME } from "./scheduler.js";
import { applyUpdateGoal, UPDATE_GOAL_TOOL_DESCRIPTION } from "./update-goal.js";
import type { GoalRuntime } from "./runtime.js";
import type { UpdateGoalStatus } from "./types.js";

export function createUpdateGoalToolDefinition(getRuntime: () => GoalRuntime | undefined): ToolDefinition {
  return {
    name: UPDATE_GOAL_TOOL_NAME,
    label: "update_goal",
    description: UPDATE_GOAL_TOOL_DESCRIPTION,
    promptSnippet: "Mark the active thread goal complete or blocked (Codex update_goal)",
    promptGuidelines: [
      'Call update_goal with status "complete" only after an evidence-backed completion audit of the full objective.',
      'Call update_goal with status "blocked" only after the same blocking condition on ≥3 consecutive goal turns.',
      "Do not use update_goal to pause, resume, or budget-limit a goal.",
    ],
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["complete", "blocked"],
          description:
            'Set to `complete` only when the objective is achieved and no required work remains. Set to `blocked` only after the same blocking condition has recurred for at least three consecutive goal turns and the agent is at an impasse.',
        },
        reason: {
          type: "string",
          description: "Optional blocked reason (impasse description). Ignored for complete.",
        },
      },
      required: ["status"],
      additionalProperties: false,
    } as any,
    async execute(_toolCallId, params) {
      const status = String((params as any)?.status || "").toLowerCase() as UpdateGoalStatus;
      if (status !== "complete" && status !== "blocked") {
        return {
          content: [{
            type: "text" as const,
            text: 'update_goal can only mark the existing goal complete or blocked; pause, resume, budget-limited, and usage-limited status changes are controlled by the user or system',
          }],
          details: { status, ok: false },
          isError: true,
        };
      }

      const runtime = getRuntime();
      if (!runtime) {
        return {
          content: [{ type: "text" as const, text: "cannot update goal because this thread has no goal" }],
          details: { status, ok: false },
          isError: true,
        };
      }

      const result = applyUpdateGoal(runtime, status, {
        reason: typeof (params as any)?.reason === "string" ? (params as any).reason : undefined,
      });

      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: result.error || "update_goal failed" }],
          details: {
            status,
            ok: false,
            blockedStreak: result.blockedStreak,
            blockedThreshold: result.blockedThreshold,
            goal: result.goal,
          },
          isError: true,
        };
      }

      const lines = [
        `Goal marked ${status}.`,
        result.goal ? `Objective: ${result.goal.objective}` : "",
        result.goal ? `Status: ${result.goal.status}` : "",
        result.remainingTokens != null ? `Remaining tokens: ${result.remainingTokens}` : "",
        result.completionBudgetReport || "",
      ].filter(Boolean);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: {
          status,
          ok: true,
          goal: result.goal,
          remainingTokens: result.remainingTokens,
          completionBudgetReport: result.completionBudgetReport,
        },
      };
    },
  } as ToolDefinition;
}
