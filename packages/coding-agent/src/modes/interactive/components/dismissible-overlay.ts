import {
	type Component,
	type Focusable,
	type HitRegion,
	getKeybindings,
	matchesKey,
	type OverlayChromeTarget,
	truncateToWidth,
	visibleWidth,
} from "@mrquake/quakecode-tui";
import { theme } from "../theme/theme.js";

const CLOSE_LABEL = " × ";

export function isDismissOverlayInput(data: string): boolean {
	const kb = getKeybindings();
	return (
		kb.matches(data, "tui.select.cancel") ||
		matchesKey(data, "escape") ||
		matchesKey(data, "ctrl+c") ||
		data === "q" ||
		data === "x"
	);
}

/**
 * Read-only text overlay that closes on Esc / q / x / Ctrl+C.
 * Implements Focusable so the TUI reliably routes keyboard input here.
 */
export class DismissibleOverlayComponent implements Component, Focusable, OverlayChromeTarget {
	private _focused = false;

	constructor(
		private readonly body: string,
		private readonly onClose: () => void,
	) {}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const header = this.renderHeader(width);
		const rows = this.body.split("\n").map((row) => truncateToWidth(row, width, theme.fg("dim", "...")));
		return [header, ...rows];
	}

	private renderHeader(width: number): string {
		const left = theme.fg("borderMuted", "╭");
		const right = theme.fg("borderMuted", "╮");
		const close = theme.fg("muted", CLOSE_LABEL);
		const fill = theme.fg(
			"borderMuted",
			"─".repeat(Math.max(0, width - visibleWidth(left) - visibleWidth(close) - visibleWidth(right))),
		);
		return truncateToWidth(`${left}${fill}${close}${right}`, width, "");
	}

	collectOverlayMouseRegions(width: number): HitRegion[] {
		const closeWidth = visibleWidth(CLOSE_LABEL);
		// Generous hit box for the × button (see SelectorFrame for rationale).
		const hitExtra = 12;
		return [
			{
				id: "overlay:close",
				contentLineStart: 0,
				contentLineEnd: 2,
				xStart: Math.max(0, width - closeWidth - hitExtra),
				xEnd: width + 2,
				target: this,
			},
		];
	}

	invokeClose(): void {
		this.onClose();
	}

	handleInput(data: string): void {
		if (isDismissOverlayInput(data)) {
			this.onClose();
		}
	}
}
