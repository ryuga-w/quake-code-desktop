import type { Component } from "@mrquake/quakecode-tui";
import { theme } from "../theme/theme.js";

/**
 * Full-width dim rule between chat turns (terminal “card” separation).
 */
export class ChatSeparatorLine implements Component {
	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(0, width);
		return [theme.fg("borderMuted", "─".repeat(w))];
	}
}
