import { type Component, truncateToWidth } from "@mrquake/quakecode-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import { theme } from "../theme/theme.js";
import { MemoryStatusComponent } from "./memory-status.js";

function _formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

export class SessionDashboardComponent implements Component {
	private memoryStatus: MemoryStatusComponent;

	constructor(private session: AgentSession) {
		this.memoryStatus = new MemoryStatusComponent({
			agentName: "default-agent",
			cwd: session.sessionManager.getCwd(),
		});
	}

	setSession(session: AgentSession): void {
		this.session = session;
		this.memoryStatus.setConfig({
			agentName: "default-agent",
			cwd: session.sessionManager.getCwd(),
		});
	}

	invalidate(): void {
		this.memoryStatus.invalidate();
	}

	render(width: number): string[] {
		const state = this.session.state;
		const sessionManager = this.session.sessionManager;

		// 1. Calculate Stats
		let _totalInput = 0;
		let _totalOutput = 0;
		let _totalCost = 0;
		for (const entry of sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				_totalInput += entry.message.usage.input;
				_totalOutput += entry.message.usage.output;
				_totalCost += entry.message.usage.cost.total;
			}
		}

		// 2. Prepare Labels
		const sessionId = sessionManager.getSessionId().slice(0, 8);
		const modelName = state.model?.id || "no-model";

		// Row 1: Identity
		const brand = theme.bold(theme.fg("accent", "✦ QUAKE CODE"));
		const identity = theme.fg("dim", ` · session ${sessionId} · ${modelName}`);
		const row1 = brand + identity;

		// Row 2: Memory status (if available)
		const memoryLines = this.memoryStatus.render(width);

		// Border lines
		const rule = theme.fg("borderMuted", "─".repeat(width));

		const lines: string[] = [rule, truncateToWidth(row1, width)];
		if (memoryLines.length > 0) {
			lines.push(...memoryLines);
		}
		lines.push(rule);

		return lines;
	}
}
