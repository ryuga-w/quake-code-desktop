import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@mrquake/quakecode-cli";
import { Type } from "@sinclair/typebox";
import type {
	RequestUserInputArgs,
	RequestUserInputResponse,
} from "../../../core/plan-protocol.js";
import { isSafeCommand } from "./utils.js";

const PLAN_MODE_INSTRUCTIONS = readFileSync(new URL("./PLAN.md", import.meta.url), "utf8");
const DEFAULT_MODE_INSTRUCTIONS = `# Collaboration Mode: Default

You are now in Default mode. Any previous instructions for other modes (e.g. Plan mode) are no longer active.

Your active mode changes only when new developer instructions with a different <collaboration_mode>...</collaboration_mode> change it; user requests or tool descriptions do not change mode by themselves. Known mode names are Default and Plan.

## request_user_input availability

Use the \`request_user_input\` tool only when it is listed in the available tools for this turn.

In Default mode, strongly prefer making reasonable assumptions and executing the user's request rather than stopping to ask questions. If you absolutely must ask a question because the answer cannot be discovered from local context and a reasonable assumption would be risky, ask the user directly with a concise plain-text question. Never write a multiple choice question as a textual assistant message.

## Planning

You have access to an \`update_plan\` tool which tracks steps and progress and renders them to the user. Using the tool helps demonstrate that you've understood the task and convey how you're approaching it. Plans can help to make complex, ambiguous, or multi-phase work clearer and more collaborative for the user. A good plan should break the task into meaningful, logically ordered steps that are easy to verify as you go.

Note that plans are not for padding out simple work with filler steps or stating the obvious. The content of your plan should not involve doing anything that you aren't capable of doing (i.e. don't try to test things that you can't test). Do not use plans for simple or single-step queries that you can just do or answer immediately.

Do not repeat the full contents of the plan after an \`update_plan\` call — the harness already displays it. Instead, summarize the change made and highlight any important context or next step.

Before running a command, consider whether or not you have completed the previous step, and make sure to mark it as completed before moving on to the next step. It may be the case that you complete all steps in your plan after a single pass of implementation. If this is the case, you can simply mark all the planned steps as completed. Sometimes, you may need to change plans in the middle of a task: call \`update_plan\` with the updated plan and make sure to provide an \`explanation\` of the rationale when doing so.

Use a plan when:

- The task is non-trivial and will require multiple actions over a long time horizon.
- There are logical phases or dependencies where sequencing matters.
- The work has ambiguity that benefits from outlining high-level goals.
- You want intermediate checkpoints for feedback and validation.
- When the user asked you to do more than one thing in a single prompt
- The user has asked you to use the plan tool (aka "TODOs")
- You generate additional steps while working, and plan to do them before yielding to the user

### Examples

**High-quality plans**

Example 1:

1. Add CLI entry with file args
2. Parse Markdown via CommonMark library
3. Apply semantic HTML template
4. Handle code blocks, images, links
5. Add error handling for invalid files

Example 2:

1. Define CSS variables for colors
2. Add toggle with localStorage state
3. Refactor components to use variables
4. Verify all views for readability
5. Add smooth theme-change transition

Example 3:

1. Set up Node.js + WebSocket server
2. Add join/leave broadcast events
3. Implement messaging with timestamps
4. Add usernames + mention highlighting
5. Persist messages in lightweight DB
6. Add typing indicators + unread count

**Low-quality plans**

Example 1:

1. Create CLI tool
2. Add Markdown parser
3. Convert to HTML

Example 2:

1. Add dark mode toggle
2. Save preference
3. Make styles look good

Example 3:

1. Create single-file HTML game
2. Run quick sanity check
3. Summarize usage instructions

## \`update_plan\`

A tool named \`update_plan\` is available to you. You can use it to keep an up-to-date, step-by-step plan for the task.

To create a new plan, call \`update_plan\` with a short list of 1-sentence steps (no more than 5-7 words each) with a \`status\` for each step (\`pending\`, \`in_progress\`, or \`completed\`).

When steps have been completed, use \`update_plan\` to mark each finished step as \`completed\` and the next step you are working on as \`in_progress\`. There should always be exactly one \`in_progress\` step until everything is done. You can mark multiple items as complete in a single \`update_plan\` call.

If all steps are complete, ensure you call \`update_plan\` to mark all steps as \`completed\`.`;

const PLAN_MODE_BLOCKED_TOOLS = new Set([
	"edit",
	"write",
	"apply_patch",
	"applyPatch",
	"multi_edit",
	"delete",
	"move",
	"rename",
	"mkdir",
]);

const REQUEST_USER_INPUT_MIN_MS = 60_000;
const REQUEST_USER_INPUT_MAX_MS = 240_000;

export default function planModeExtension(quake: ExtensionAPI): void {
	quake.registerFlag("plan", {
		description: "Start in Codex-compatible Plan mode",
		type: "boolean",
		default: false,
	});

	// update_plan is a **core builtin** (Codex PlanHandler) — always active via
	// createAllToolDefinitions. Do not re-register here (avoids double tools).

	quake.registerTool({
		name: "request_user_input",
		label: "request_user_input",
		description:
			"Request user input for one to three short questions and wait for the response. Set autoResolutionMs only when continuing with best judgment is acceptable if the user does not answer. This tool is only available in Plan mode.",
		promptSnippet: "Ask focused Plan mode questions",
		parameters: Type.Object(
			{
				questions: Type.Array(
					Type.Object(
						{
							header: Type.String({ description: "Short header label shown in the UI (12 or fewer chars)." }),
							id: Type.String({ description: "Stable identifier for mapping answers (snake_case)." }),
							question: Type.String({ description: "Single-sentence prompt shown to the user." }),
							options: Type.Array(
								Type.Object(
									{
										description: Type.String({
											description: "One short sentence explaining impact/tradeoff if selected.",
										}),
										label: Type.String({ description: "User-facing label (1-5 words)." }),
									},
									{ additionalProperties: false },
								),
								{
									minItems: 2,
									maxItems: 3,
									description:
										'Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with "(Recommended)". Do not include an Other option; the client adds it.',
								},
							),
						},
						{ additionalProperties: false },
					),
					{ minItems: 1, maxItems: 3 },
				),
				autoResolutionMs: Type.Optional(
					Type.Number(),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.isRootAgent()) {
				throw new Error("request_user_input can only be used by the root thread");
			}
			if (ctx.getCollaborationMode() !== "plan") {
				throw new Error("request_user_input is unavailable in Default mode");
			}
			const request: RequestUserInputArgs = {
				questions: params.questions.map((question) => ({
					header: question.header,
					id: question.id,
					question: question.question,
					options: question.options.map((option) => ({
						description: option.description,
						label: option.label,
					})),
				})),
				autoResolutionMs:
					params.autoResolutionMs === undefined
						? undefined
						: Math.min(REQUEST_USER_INPUT_MAX_MS, Math.max(REQUEST_USER_INPUT_MIN_MS, params.autoResolutionMs)),
			};
			const response = await requestUserInput(ctx, request);
			if (!response) {
				throw new Error("request_user_input was cancelled before receiving a response");
			}
			return {
				content: [{ type: "text" as const, text: JSON.stringify(response) }],
				details: response,
			};
		},
	});

	const setMode = (ctx: ExtensionContext, mode: "default" | "plan") => {
		ctx.setCollaborationMode(mode);
		syncRequestUserInputTool(quake, mode);
		ctx.ui.setStatus("collaboration-mode", mode === "plan" ? "Plan" : undefined);
	};

	quake.registerCommand("plan", {
		description: "Toggle Codex-compatible Plan mode",
		handler: async (_args, ctx) => {
			setMode(ctx, ctx.getCollaborationMode() === "plan" ? "default" : "plan");
		},
	});
	quake.registerShortcut("shift+tab" as any, {
		description: "Toggle Codex-compatible Plan mode",
		handler: async (ctx) => {
			setMode(ctx, ctx.getCollaborationMode() === "plan" ? "default" : "plan");
		},
	});

	quake.on("session_start", async (_event, ctx) => {
		if (quake.getFlag("plan") === true) ctx.setCollaborationMode("plan");
		syncRequestUserInputTool(quake, ctx.getCollaborationMode());
		ctx.ui.setStatus("collaboration-mode", ctx.getCollaborationMode() === "plan" ? "Plan" : undefined);
	});

	quake.on("before_agent_start", async (event, ctx) => ({
		systemPrompt: `${event.systemPrompt}\n\n<collaboration_mode>\n${
			ctx.getCollaborationMode() === "plan" ? PLAN_MODE_INSTRUCTIONS : DEFAULT_MODE_INSTRUCTIONS
		}\n</collaboration_mode>`,
	}));

	quake.on("tool_call", async (event, ctx) => {
		if (ctx.getCollaborationMode() !== "plan") return;
		if (PLAN_MODE_BLOCKED_TOOLS.has(event.toolName)) {
			return {
				block: true,
				reason: `Plan mode: "${event.toolName}" blocked (read-only).`,
			};
		}
		if (event.toolName === "bash") {
			const command = event.input.command;
			if (typeof command !== "string" || !isSafeCommand(command)) {
				return {
					block: true,
					reason: `Plan mode: command blocked (not allowlisted).\nCommand: ${
						typeof command === "string" ? command : "<invalid>"
					}`,
				};
			}
		}
	});
}

function syncRequestUserInputTool(quake: ExtensionAPI, mode: "default" | "plan"): void {
	const active = quake.getActiveTools().filter((name) => name !== "request_user_input");
	if (mode === "plan") active.push("request_user_input");
	if (!active.includes("update_plan")) active.push("update_plan");
	quake.setActiveTools(active);
}

async function requestUserInput(
	ctx: ExtensionContext,
	request: RequestUserInputArgs,
): Promise<RequestUserInputResponse | undefined> {
	if (ctx.ui.requestUserInput) {
		return ctx.ui.requestUserInput(request);
	}

	const answers: RequestUserInputResponse["answers"] = {};
	for (const question of request.questions) {
		const otherLabel = "Other";
		const choice = await ctx.ui.select(
			question.question,
			[...question.options.map((option) => option.label), otherLabel],
			request.autoResolutionMs ? { timeout: request.autoResolutionMs } : undefined,
		);
		if (choice === undefined) return undefined;
		if (choice === otherLabel) {
			const text = await ctx.ui.editor(question.header, "");
			if (text === undefined) return undefined;
			answers[question.id] = { answers: [text] };
		} else {
			answers[question.id] = { answers: [choice] };
		}
	}
	return { answers };
}
