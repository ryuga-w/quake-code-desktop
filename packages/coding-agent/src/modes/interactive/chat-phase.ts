import type { AgentSessionEvent } from "../../core/agent-session.js";

export type ChatPhase =
	| "idle"
	| "submitting"
	| "planning"
	| "inspecting"
	| "searching"
	| "reading"
	| "applying_changes"
	| "verifying"
	| "compacting"
	| "retrying"
	| "done"
	| "error";

export interface ChatOperationalState {
	phase: ChatPhase;
	label: string;
	detail?: string;
	queueCount: number;
}

const DEFAULT_STATE: ChatOperationalState = {
	phase: "idle",
	label: "Ready",
	queueCount: 0,
};

function cleanSnippet(text: string | undefined, maxLength = 72): string | undefined {
	if (!text) return undefined;
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return undefined;
	return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function firstPathArg(args: any): string | undefined {
	const candidate = args?.path ?? args?.filePath ?? args?.cwd ?? args?.dir ?? args?.directory ?? args?.url;
	return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function classifyBashCommand(command: string | undefined): Pick<ChatOperationalState, "phase" | "label" | "detail"> {
	const normalized = command?.trim() ?? "";
	const lower = normalized.toLowerCase();
	const detail = cleanSnippet(normalized);

	if (!normalized) {
		return { phase: "verifying", label: "Running command", detail: undefined };
	}

	if (
		/\b(npm|pnpm|yarn|bun|cargo|go)\s+(run\s+)?(test|build|lint|check)\b/.test(lower) ||
		/\b(vitest|jest|tsc|eslint|biome|pytest|ruff|mypy|cargo test|go test)\b/.test(lower)
	) {
		return { phase: "verifying", label: "Verifying changes", detail };
	}

	if (
		/\bgit\s+(status|diff|log|show|branch)\b/.test(lower) ||
		/\b(ls|dir|find|fd|rg|grep|cat|head|tail|wc)\b/.test(lower)
	) {
		return { phase: "inspecting", label: "Inspecting workspace", detail };
	}

	return { phase: "verifying", label: "Running command", detail };
}

export function getToolActivity(
	toolName: string,
	args?: any,
): Pick<ChatOperationalState, "phase" | "label" | "detail"> {
	const path = cleanSnippet(firstPathArg(args), 64);
	const query = cleanSnippet(
		typeof args?.pattern === "string"
			? args.pattern
			: typeof args?.query === "string"
				? args.query
				: Array.isArray(args?.queries) && typeof args.queries[0] === "string"
					? args.queries[0]
					: undefined,
		48,
	);

	if (toolName === "read") {
		return { phase: "reading", label: "Reading source", detail: path };
	}
	if (toolName === "grep") {
		return { phase: "searching", label: "Searching code", detail: query ?? path };
	}
	if (toolName === "find" || toolName === "ls") {
		return { phase: "inspecting", label: "Mapping workspace", detail: path };
	}
	if (toolName === "edit") {
		return { phase: "applying_changes", label: "Preparing targeted change", detail: path };
	}
	if (toolName === "write") {
		return { phase: "applying_changes", label: "Drafting file content", detail: path };
	}
	if (toolName === "bash") {
		return classifyBashCommand(typeof args?.command === "string" ? args.command : undefined);
	}
	if (toolName === "web_search") {
		return { phase: "searching", label: "Researching external context", detail: query };
	}
	if (toolName.startsWith("browser_")) {
		return { phase: "inspecting", label: "Inspecting page state", detail: path };
	}

	return {
		phase: "planning",
		label: "Coordinating tool work",
		detail: cleanSnippet(toolName),
	};
}

export class ChatPhaseTracker {
	private state: ChatOperationalState = { ...DEFAULT_STATE };

	getState(): ChatOperationalState {
		return { ...this.state };
	}

	markSubmitting(text: string): void {
		this.state = {
			...this.state,
			phase: "submitting",
			label: "Submitting instruction",
			detail: cleanSnippet(text),
		};
	}

	applyEvent(event: AgentSessionEvent): ChatOperationalState {
		switch (event.type) {
			case "queue_update": {
				const queueCount = event.steering.length + event.followUp.length;
				this.state = {
					...this.state,
					queueCount,
				};
				break;
			}

			case "agent_start":
				if (this.state.phase === "idle" || this.state.phase === "done" || this.state.phase === "submitting") {
					this.state = {
						...this.state,
						phase: "planning",
						label: "Planning next step",
						detail: "Thinking through the task",
					};
				}
				break;

			case "message_start":
				if (event.message.role === "user") {
					const content = event.message.content;
					const textPart = Array.isArray(content)
						? content.find((part): part is { type: "text"; text: string } => part.type === "text")
						: typeof content === "string"
							? { type: "text" as const, text: content }
							: undefined;
					this.state = {
						...this.state,
						phase: "submitting",
						label: "Submitting instruction",
						detail: cleanSnippet(textPart?.text),
					};
				} else if (event.message.role === "assistant") {
					this.state = {
						...this.state,
						phase: "planning",
						label: "Drafting response",
						detail: "Preparing the next action",
					};
				}
				break;

			case "tool_execution_start": {
				const activity = getToolActivity(event.toolName, event.args);
				this.state = {
					...this.state,
					...activity,
				};
				break;
			}

			case "message_end":
				if (event.message.role === "assistant") {
					this.state = {
						...this.state,
						phase:
							event.message.stopReason === "error" || event.message.stopReason === "aborted" ? "error" : "done",
						label:
							event.message.stopReason === "error"
								? "Response failed"
								: event.message.stopReason === "aborted"
									? "Operation aborted"
									: "Response ready",
						detail:
							event.message.stopReason === "error" || event.message.stopReason === "aborted"
								? cleanSnippet(event.message.errorMessage)
								: "Ready for the next instruction",
					};
				}
				break;

			case "compaction_start":
				this.state = {
					...this.state,
					phase: "compacting",
					label: event.reason === "manual" ? "Compacting session" : "Auto-compacting session",
					detail:
						event.reason === "overflow"
							? "Recovering from context overflow"
							: "Compressing prior context for continued work",
				};
				break;

			case "compaction_end":
				this.state = {
					...this.state,
					phase: event.aborted || event.errorMessage ? "error" : "done",
					label: event.aborted
						? "Compaction cancelled"
						: event.errorMessage
							? "Compaction failed"
							: "Compaction complete",
					detail: event.errorMessage ? cleanSnippet(event.errorMessage) : "Session context refreshed",
				};
				break;

			case "auto_retry_start":
				this.state = {
					...this.state,
					phase: "retrying",
					label: `Retrying request (${event.attempt}/${event.maxAttempts})`,
					detail: cleanSnippet(event.errorMessage),
				};
				break;

			case "auto_retry_end":
				this.state = {
					...this.state,
					phase: event.success ? "planning" : "error",
					label: event.success ? "Retry succeeded" : "Retry failed",
					detail: event.success ? "Continuing the response" : cleanSnippet(event.finalError),
				};
				break;

			case "agent_end":
				if (
					this.state.phase === "planning" ||
					this.state.phase === "inspecting" ||
					this.state.phase === "searching" ||
					this.state.phase === "reading" ||
					this.state.phase === "applying_changes" ||
					this.state.phase === "verifying"
				) {
					this.state = {
						...this.state,
						phase: "done",
						label: "Response ready",
						detail: "Ready for the next instruction",
					};
				}
				break;
		}

		return this.getState();
	}
}
