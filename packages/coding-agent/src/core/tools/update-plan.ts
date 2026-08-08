/**
 * Codex `update_plan` — continuous TODO/checklist tool (not Plan mode).
 * Mirror of codex-rs/core/src/tools/handlers/plan.rs + plan_spec.rs.
 */

import type { AgentTool } from "@mrquake/quakecode-agent-core";
import { Text } from "@mrquake/quakecode-tui";
import { type Static, Type } from "@sinclair/typebox";
import type { ToolDefinition } from "../extensions/types.js";
import { publishPlanUpdate } from "../plan-update-bus.js";
import type { PlanStepStatus } from "../plan-protocol.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";

const planItemSchema = Type.Object(
	{
		step: Type.String({ description: "Task step text (short, verifiable)." }),
		status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")], {
			description: "Step status.",
		}),
	},
	{ additionalProperties: false },
);

const schema = Type.Object(
	{
		explanation: Type.Optional(Type.String({ description: "Optional explanation for this plan update." })),
		plan: Type.Array(planItemSchema, { description: "The list of steps" }),
	},
	{ additionalProperties: false },
);

export type UpdatePlanToolInput = Static<typeof schema>;

export const UPDATE_PLAN_TOOL_DESCRIPTION = `Updates the task plan.
Provide an optional explanation and a list of plan items, each with a step and status.
At most one step can be in_progress at a time.
When every step is done, send one final update marking all steps completed. When the whole task is finished and you want the plan panel dismissed, call clear_plan.
`;

export const UPDATE_PLAN_PROMPT_GUIDELINES: string[] = [
	"Use update_plan for non-trivial multi-step work; skip for the easiest ~25% of tasks and never make single-step plans.",
	"When you made a plan, call update_plan again after each completed sub-task (mark completed, set next in_progress).",
	"Keep at most one step in_progress until everything is done; mark all completed when finished.",
	"When the whole task is fully finished, call clear_plan to dismiss the plan panel. Do not call it if work is incomplete, interrupted, or errored — leave the plan visible so the user can resume.",
	"Do not dump the full plan in chat after update_plan — the product UI shows the checklist.",
];

function normalizePlan(plan: UpdatePlanToolInput["plan"]) {
	let inProgress = 0;
	const out = plan.map((item) => {
		let status: PlanStepStatus =
			item.status === "completed" || item.status === "in_progress" ? item.status : "pending";
		if (status === "in_progress") {
			inProgress += 1;
			if (inProgress > 1) status = "pending";
		}
		return { step: String(item.step || "").trim(), status };
	}).filter((item) => item.step.length > 0);
	// Ensure at least one in_progress when there are incomplete steps
	if (out.length && !out.some((s) => s.status === "in_progress") && out.some((s) => s.status !== "completed")) {
		const next = out.find((s) => s.status === "pending");
		if (next) next.status = "in_progress";
	}
	return out;
}

export function createUpdatePlanToolDefinition(): ToolDefinition<typeof schema> {
	return {
		name: "update_plan",
		label: "update_plan",
		description: UPDATE_PLAN_TOOL_DESCRIPTION,
		parameters: schema,
		promptSnippet: "Track a concise multi-step task plan (TODO checklist)",
		promptGuidelines: UPDATE_PLAN_PROMPT_GUIDELINES,
		renderCall(args, theme) {
			const n = Array.isArray(args.plan) ? args.plan.length : 0;
			const active = Array.isArray(args.plan)
				? args.plan.find((p: any) => p?.status === "in_progress")?.step
				: undefined;
			const detail = active ? String(active).slice(0, 48) : `${n} steps`;
			return new Text(`${theme.bold("update_plan")} ${theme.fg("dim", detail)}`, 0, 0);
		},
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (ctx?.getCollaborationMode?.() === "plan") {
				throw new Error("update_plan is a TODO/checklist tool and is not allowed in Plan mode");
			}
			const plan = normalizePlan(params.plan || []);
			if (!plan.length) {
				return {
					content: [{ type: "text", text: "Plan update ignored: empty plan." }],
					details: { ok: false, error: "empty plan" },
				};
			}
			const update = {
				explanation: params.explanation,
				plan,
			};
			// Core path (always)
			publishPlanUpdate(update);
			// Extension context path when available
			try {
				ctx?.emitPlanUpdate?.(update);
			} catch {
				/* non-fatal */
			}
			return {
				content: [{ type: "text", text: "Plan updated" }],
				details: { ok: true, plan, explanation: params.explanation },
			};
		},
	};
}

export const updatePlanToolDefinition = createUpdatePlanToolDefinition();
export const updatePlanTool = wrapToolDefinition(updatePlanToolDefinition) as AgentTool<any>;
