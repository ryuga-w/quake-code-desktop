/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, only read-only tools are available.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered plan steps from "Plan:" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils.js";

// Tools
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const FALLBACK_NORMAL_TOOLS = ["read", "bash", "edit", "write"];

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function detectTurkish(text: string): boolean {
	return (
		/[çğıöşüÇĞİÖŞÜ]/.test(text) ||
		/\b(merhaba|selam|hocam|lütfen|yap|et|olsun|gibi|kullanıcı|talep|plan|devam|dosya|değişiklik|görev|ne|nasıl|neden|bir|ve|için|mı|mi|mu|mü)\b/i.test(
			text,
		)
	);
}

function getVisibleText(isTurkish: boolean) {
	return isTurkish
		? {
				planEnabled: `Plan modu açıldı. Salt-okunur araçlar aktif: ${PLAN_MODE_TOOLS.join(", ")}. Yazma araçları execution başlayana kadar engelli.`,
				planDisabled: (tools: string[]) => `Plan modu kapatıldı. Geri yüklenen araçlar: ${tools.join(", ")}`,
				noTodos: "Henüz görev listesi yok.",
				planProgress: "Görev İlerlemesi:",
				planReady: (count: number, list: string) => `**Plan Hazır (${count} adım):**\n\n${list}`,
				selectTitle: "Plan modu - sırada ne var?",
				execute: "İlerleme takibiyle hemen uygula",
				refine: "Uygulamadan önce planı iyileştir",
				stay: "Plan modunda kal",
				executionStarted: (tools: string[]) => `Execution başladı. Geri yüklenen araçlar: ${tools.join(", ")}`,
				refineTitle: "Planı iyileştir:",
				ambientStatus: (completed: number, total: number) => `görev ${completed}/${total}`,
			}
		: {
				planEnabled: `Plan mode enabled. Read-only tools active: ${PLAN_MODE_TOOLS.join(", ")}. Write tools are blocked until execution starts.`,
				planDisabled: (tools: string[]) => `Plan mode disabled. Restored tools: ${tools.join(", ")}`,
				noTodos: "No task list yet.",
				planProgress: "Task Progress:",
				planReady: (count: number, list: string) => `**Plan Ready (${count} steps):**\n\n${list}`,
				selectTitle: "Plan mode - what next?",
				execute: "Execute now with progress tracking",
				refine: "Refine the plan before execution",
				stay: "Stay in plan mode",
				executionStarted: (tools: string[]) => `Execution mode started. Restored tools: ${tools.join(", ")}`,
				refineTitle: "Refine the plan:",
				ambientStatus: (completed: number, total: number) => `task ${completed}/${total}`,
			};
}

export default function planModeExtension(quake: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let previousActiveTools: string[] = [];
	let userPrefersTurkish = false;

	quake.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function getRestoreTools(): string[] {
		return previousActiveTools.length > 0 ? previousActiveTools : FALLBACK_NORMAL_TOOLS;
	}

	function restoreTools(): void {
		quake.setActiveTools(getRestoreTools());
	}

	function updateStatus(ctx: ExtensionContext): void {
		// Footer status
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `plan ${completed}/${todoItems.length}`));
		} else if (planModeEnabled && todoItems.length > 0) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("success", `ready (${todoItems.length})`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "planning"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Widget showing todo list
		if ((executionMode || planModeEnabled) && todoItems.length > 0) {
			const header =
				planModeEnabled || executionMode
					? userPrefersTurkish
						? ctx.ui.theme.fg("accent", "Plan Adımları")
						: ctx.ui.theme.fg("accent", "Plan Steps")
					: userPrefersTurkish
						? ctx.ui.theme.fg("accent", "Görev Listesi")
						: ctx.ui.theme.fg("accent", "Task Checklist");
			const lines = [
				header,
				"",
				...todoItems.map((item) => {
					if (item.completed) {
						return (
							ctx.ui.theme.fg("success", "[x] ") +
							ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
						);
					}
					return `${ctx.ui.theme.fg("muted", "[ ] ")}${item.text}`;
				}),
			];
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = !planModeEnabled;
		executionMode = false;
		todoItems = [];

		const t = getVisibleText(userPrefersTurkish);
		if (planModeEnabled) {
			previousActiveTools = quake.getActiveTools();
			quake.setActiveTools(PLAN_MODE_TOOLS);
			ctx.ui.notify(t.planEnabled);
		} else {
			restoreTools();
			ctx.ui.notify(t.planDisabled(getRestoreTools()));
		}
		persistState();
		updateStatus(ctx);
	}

	function persistState(): void {
		quake.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			previousTools: previousActiveTools,
		});
	}

	quake.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	quake.registerCommand("todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			const t = getVisibleText(userPrefersTurkish);
			if (todoItems.length === 0) {
				ctx.ui.notify(t.noTodos, "info");
				return;
			}
			const list = todoItems
				.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.fullText ?? item.text}`)
				.join("\n");
			ctx.ui.notify(`${t.planProgress}\n${list}`, "info");
		},
	});

	quake.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Block destructive bash commands in plan mode
	quake.on("tool_call", async (event) => {
		if (!planModeEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	// Filter out stale plan mode context when not in plan mode
	quake.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (
					msg.customType === "plan-mode-context" ||
					msg.customType === "plan-mode-trigger" ||
					msg.customType === "plan-mode-execute"
				)
					return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts
	quake.on("before_agent_start", async (event) => {
		if (planModeEnabled) {
			return {
				systemPrompt: `${event.systemPrompt}\n\n[PLAN MODE ACTIVE]\nYou are in plan mode - a read-only exploration mode for safe code analysis.\n\nRestrictions:\n- You can only use: read, bash, grep, find, ls, questionnaire\n- You CANNOT use: edit, write (file modifications are disabled)\n- Bash is restricted to an allowlist of read-only commands\n\nAsk clarifying questions using the questionnaire tool when requirements are ambiguous.\n\nYour output must stay in planning mode. Do not implement anything yet.\nBefore finalizing the plan, inspect package scripts/config and run the smallest relevant safe verification command if available (for example: npm run typecheck, npm run check, npm run lint, npm run test with scoped flags, or tsc --noEmit). Prefer targeted checks over broad builds.\n\nCreate a detailed numbered plan under a "Plan:" header, and include affected files, key risks, validation notes, and any verification findings.\n\nPlan:\n1. First step description\n2. Second step description\n...\n\nDo NOT attempt to make changes - just describe what you would do.`,
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				systemPrompt: `${event.systemPrompt}\n\n[EXECUTING PLAN - Full tool access enabled]\n\nRemaining steps:\n${todoList}\n\nExecute each step in order.\nKeep scope tight to the approved plan.\nAfter completing a step, include a [DONE:n] tag in your response.`,
			};
		}
	});

	// Track progress after each turn
	quake.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState();
	});

	// Handle plan completion and plan mode UI
	quake.on("agent_end", async (event, ctx) => {
		// Check if execution is complete
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.fullText ?? t.text}~~`).join("\n");
				quake.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				restoreTools();
				updateStatus(ctx);
				persistState(); // Save cleared state so resume doesn't restore old execution mode
			}
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		// Extract todos from last assistant message
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}

		// Show plan steps and prompt for next action
		const t = getVisibleText(userPrefersTurkish);
		if (todoItems.length > 0) {
			const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.fullText ?? t.text}`).join("\n");
			quake.sendMessage(
				{
					customType: "plan-todo-list",
					content: t.planReady(todoItems.length, todoListText),
					display: true,
				},
				{ triggerTurn: false },
			);
		}

		updateStatus(ctx);

		const choice = await ctx.ui.select(t.selectTitle, [t.execute, t.refine, t.stay]);

		if (choice === t.execute) {
			planModeEnabled = false;
			executionMode = todoItems.length > 0;
			restoreTools();
			ctx.ui.notify(t.executionStarted(getRestoreTools()));
			updateStatus(ctx);
			quake.appendEntry("plan-mode-execute", { startedAt: Date.now(), steps: todoItems.length });
			persistState();

			quake.sendMessage({ customType: "plan-mode-trigger", content: "", display: false }, { triggerTurn: true });
		} else if (choice === t.refine) {
			const refinement = await ctx.ui.editor(t.refineTitle, "");
			if (refinement?.trim()) {
				quake.sendUserMessage(refinement.trim());
			}
		}
	});

	// Restore state on session start/resume
	quake.on("session_start", async (_event, ctx) => {
		const allText = ctx.sessionManager
			.getEntries()
			.filter(
				(entry): entry is { type: string; message: AgentMessage } => entry.type === "message" && "message" in entry,
			)
			.map((entry) => {
				const message = entry.message;
				if (message.role !== "user") return "";
				return typeof message.content === "string"
					? message.content
					: Array.isArray(message.content)
						? message.content
								.filter((c) => c.type === "text")
								.map((c) => c.text)
								.join("\n")
						: "";
			})
			.join("\n");
		userPrefersTurkish = detectTurkish(allText);

		if (quake.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();

		// Restore persisted state
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as
			| {
					data?: { enabled: boolean; todos?: TodoItem[]; executing?: boolean; previousTools?: string[] };
			  }
			| undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			previousActiveTools = planModeEntry.data.previousTools ?? previousActiveTools;
		}

		// On resume: re-scan messages to rebuild completion state
		// Only scan messages AFTER the last "plan-mode-execute" to avoid picking up [DONE:n] from previous plans
		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			// Find the index of the last plan-mode-execute entry (marks when current execution started)
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}

			// Only scan messages after the execute marker
			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}

		if (planModeEnabled) {
			quake.setActiveTools(PLAN_MODE_TOOLS);
		} else if (executionMode) {
			restoreTools();
		}
		updateStatus(ctx);
	});
}
