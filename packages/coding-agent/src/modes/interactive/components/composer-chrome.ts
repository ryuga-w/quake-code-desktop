import { truncateToWidth, visibleWidth } from "@mrquake/quakecode-tui";
import { theme } from "../theme/theme.js";

export const COMPOSER_SHORTCUT_HINT = "Enter:send | Alt+Enter: newline | Shift+Tab: mode | Ctrl+x: shortcuts";

export function composerPrompt(): string {
	return theme.fg("text", "› ");
}

export function composerBorderLine(width: number): string {
	return theme.fg("borderMuted", "─".repeat(width));
}

export function composerBarLine(width: number, content: string): string {
	const clipped = truncateToWidth(content, width, "");
	const pad = Math.max(0, width - visibleWidth(clipped));
	return theme.bg("toolPendingBg", `${clipped}${" ".repeat(pad)}`);
}

export function composerHintLine(width: number, left: string, right: string): string {
	const leftStyled = theme.fg("dim", left);
	const rightStyled = right ? theme.fg("dim", right) : "";
	const gap = width - visibleWidth(leftStyled) - visibleWidth(rightStyled);
	const combined =
		gap >= 2
			? `${leftStyled}${" ".repeat(gap)}${rightStyled}`
			: rightStyled
				? `${truncateToWidth(leftStyled, Math.max(1, width - visibleWidth(rightStyled) - 2), "")}  ${rightStyled}`
				: truncateToWidth(leftStyled, width, "");
	return composerBarLine(width, combined);
}
