import { Box, Markdown, type MarkdownTheme, Spacer, Text } from "@mrquake/quakecode-tui";
import type { BranchSummaryMessage } from "../../../core/messages.js";
import { getMarkdownTheme, theme } from "../theme/theme.js";
import { keyText } from "./keybinding-hints.js";

/**
 * Component that renders a branch summary message with collapsed/expanded state.
 * Uses same background color as custom messages for visual consistency.
 */
export class BranchSummaryMessageComponent extends Box {
	private expanded = false;
	private message: BranchSummaryMessage;
	private markdownTheme: MarkdownTheme;

	constructor(message: BranchSummaryMessage, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super(1, 1, (t) => theme.bg("customMessageBg", t));
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

		const icon = theme.fg("warning", "⌥ ");
		const label = theme.bold(theme.fg("warning", "BRANCHED FROM HISTORY"));
		const meta = theme.fg("dim", ` [ from ${this.message.fromId.slice(0, 8)} ]`);

		this.addChild(new Text(icon + label + meta, 0, 0));
		this.addChild(new Spacer(1));

		if (this.expanded) {
			const separator = theme.fg("dim", "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌");
			this.addChild(
				new Markdown(this.message.summary, 0, 0, this.markdownTheme, {
					color: (text: string) => theme.fg("customMessageText", text),
				}),
			);
			this.addChild(new Spacer(1));
			this.addChild(new Text(separator, 0, 0));
		} else {
			this.addChild(
				new Text(
					theme.fg("dim", "  │ ") +
						theme.fg("customMessageText", "Abandoned path summarized (") +
						theme.fg("warning", keyText("app.tools.expand")) +
						theme.fg("dim", " to view lineage)"),
					0,
					0,
				),
			);
		}
	}
}
