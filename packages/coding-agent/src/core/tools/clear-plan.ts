/**
 * `clear_plan` — agent-decided dismissal of the plan panel.
 *
 * The agent calls this only when a task is fully finished and the plan panel
 * (update_plan checklist and/or the Plan-mode proposed markdown) should be
 * dismissed. It is intentionally agent-driven rather than automatic: on a
 * crash, network drop, or interruption the agent never reaches this call, so
 * the user's plan stays visible and resumable.
 */

import type { AgentTool } from "@mrquake/quakecode-agent-core";
import { Text } from "@mrquake/quakecode-tui";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "../extensions/types.js";
import { publishPlanClear } from "../plan-update-bus.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";

const schema = Type.Object(
	{
		reason: Type.Optional(
			Type.String({ description: "Optional short note on why the plan is being dismissed." }),
		),
	},
	{ additionalProperties: false },
);

export const CLEAR_PLAN_TOOL_DESCRIPTION = `Dismisses the plan panel once the whole task is finished.
Call this only when work is fully complete and you want the plan checklist and any proposed-plan markdown cleared from the UI.
Do NOT call it when work is incomplete, interrupted, blocked, or errored — leave the plan visible so the user can resume.`;

export const CLEAR_PLAN_PROMPT_GUIDELINES: string[] = [
	"Call clear_plan only after the whole task is genuinely finished, to dismiss the plan panel.",
	"Never call clear_plan on partial progress, interruption, or error — the visible plan lets the user resume.",
	"Prefer marking all update_plan steps completed first, then call clear_plan to close the panel.",
];

export function createClearPlanToolDefinition(): ToolDefinition<typeof schema> {
	return {
		name: "clear_plan",
		label: "clear_plan",
		description: CLEAR_PLAN_TOOL_DESCRIPTION,
		parameters: schema,
		promptSnippet: "Dismiss the plan panel when the task is fully finished",
		promptGuidelines: CLEAR_PLAN_PROMPT_GUIDELINES,
		renderCall(_args, theme) {
			return new Text(`${theme.bold("clear_plan")}`, 0, 0);
		},
		async execute(_id, params, _signal, _onUpdate, ctx) {
			// Core path (always): process-global bus reaches every AgentSession the
			// same way update_plan does, because builtin tools run without ctx.
			publishPlanClear();
			// Extension context path when available (parity with update_plan).
			try {
				ctx?.clearPlan?.();
			} catch {
				/* non-fatal */
			}
			return {
				content: [{ type: "text", text: "Plan panel cleared" }],
				details: { ok: true, reason: params.reason },
			};
		},
	};
}

export const clearPlanToolDefinition = createClearPlanToolDefinition();
export const clearPlanTool = wrapToolDefinition(clearPlanToolDefinition) as AgentTool<any>;
