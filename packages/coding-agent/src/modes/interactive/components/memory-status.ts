import { type Component, truncateToWidth } from "@mrquake/quakecode-tui";
import { getDefaultAgentName, getMemoryStatus } from "../../../core/memory-consolidation.js";
import { theme } from "../theme/theme.js";

export interface MemoryStatusConfig {
	agentName?: string;
	cwd: string;
}

export class MemoryStatusComponent implements Component {
	private config: MemoryStatusConfig | null = null;

	constructor(config?: MemoryStatusConfig) {
		this.config = config ?? null;
	}

	setConfig(config: MemoryStatusConfig): void {
		this.config = config;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (!this.config) return [];

		try {
			const agent = this.config.agentName ?? getDefaultAgentName();
			const status = getMemoryStatus(agent, this.config.cwd);

			if (status.totalEntries === 0) return [];

			const needsConsolidation = status.scopes.some((s) => s.needsConsolidation);
			const bytes = status.scopes.reduce((sum, s) => sum + s.bytes, 0);
			const memoryLabel = theme.fg("accent", "mem");
			let indicator = `${memoryLabel} ${status.totalEntries} · ${(bytes / 1024).toFixed(1)}KB`;

			if (needsConsolidation) {
				indicator += ` ${theme.fg("warning", "!")}`;
			}

			return [truncateToWidth(`  ${indicator}`, width)];
		} catch {
			return [];
		}
	}
}
