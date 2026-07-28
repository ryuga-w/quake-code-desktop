import { Container, Markdown, type MarkdownTheme, Spacer, Text } from "@mrquake/quakecode-tui";
import type { CompactionSummaryMessage } from "../../../core/messages.js";
import { getMarkdownTheme, theme } from "../theme/theme.js";
import { keyText } from "./keybinding-hints.js";

/**
 * Component that renders a compaction message with collapsed/expanded state.
 * Intentionally borderless/backgroundless to keep the post-compaction status light.
 * Static rendering only — no shimmer/timers, to avoid layout jitter.
 */
export class CompactionSummaryMessageComponent extends Container {
	private expanded = false;
	private message: CompactionSummaryMessage;
	private markdownTheme: MarkdownTheme;

	constructor(message: CompactionSummaryMessage, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super();
		this.message = message;
		this.markdownTheme = markdownTheme;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	private updateDisplay(): void {
		this.clear();

		const tokenStr = `${(this.message.tokensBefore / 1000).toFixed(1)}k`;
		const icon = theme.fg("accent", "✦ ");
		const label = theme.bold(theme.fg("accent", "CONTEXT SUMMARIZED"));
		const badge = theme.fg("dim", ` [ ${tokenStr} tokens ]`);

		this.addChild(new Text(icon + label + badge, 0, 0));
		this.addChild(new Spacer(1));

		if (this.expanded) {
			const _header = `${theme.fg("dim", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}\n\n`;
			this.addChild(
				new Markdown(this.message.summary, 0, 0, this.markdownTheme, {
					color: (text: string) => theme.fg("customMessageText", text),
				}),
			);
			this.addChild(new Spacer(1));
			this.addChild(
				new Text(theme.fg("dim", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"), 0, 0),
			);
		} else {
			this.addChild(
				new Text(
					theme.fg("dim", "  │ ") +
						theme.fg("customMessageText", `${this.message.summary.split("\n")[0].slice(0, 60)}...`) +
						theme.fg("dim", " (") +
						theme.fg("accent", keyText("app.tools.expand")) +
						theme.fg("dim", " to read summary)"),
					0,
					0,
				),
			);
		}
	}
}
