import { type Component, visibleWidth } from "@mrquake/quakecode-tui";
import { theme } from "../theme/theme.js";

function truncateText(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	let out = text;
	while (visibleWidth(out) > maxWidth && out.length > 0) {
		out = out.slice(0, -1);
	}
	if (visibleWidth(text) > maxWidth && maxWidth >= 1) {
		while (visibleWidth(`${out}…`) > maxWidth && out.length > 0) {
			out = out.slice(0, -1);
		}
		return `${out}…`;
	}
	return out;
}

export class SessionTabsComponent implements Component {
	constructor(
		private getSessionLabel: () => string,
		private getDisplayName: () => string,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const chrome = theme.fg("dim", "▌");
		const appIcon = theme.bold(theme.fg("accent", "◆"));
		const appChip = theme.bg("userMessageBg", ` ${appIcon} ${this.getDisplayName()} `);
		const plusChip = theme.bg("userMessageBg", ` ${theme.bold(theme.fg("accent", "+"))} `);

		const rawLabel = this.getSessionLabel();
		const reservedWidth = visibleWidth(appChip) + visibleWidth(plusChip) + 6;
		const maxTabWidth = Math.max(12, width - reservedWidth);
		const label = truncateText(rawLabel, Math.max(4, maxTabWidth - 2));
		const tabInner = ` ${theme.bold(label)} `;
		const tabChip = theme.bg("selectedBg", tabInner);

		const left = `${chrome}${appChip} ${tabChip}`;
		const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(plusChip) - 1);
		const line = `${left}${" ".repeat(gap)}${plusChip}`;
		return [line];
	}
}
