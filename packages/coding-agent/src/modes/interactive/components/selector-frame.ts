import {
	type Component,
	Container,
	type HitRegion,
	type OverlayChromeTarget,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@mrquake/quakecode-tui";
import { theme } from "../theme/theme.js";

const CLOSE_LABEL = " × ";

export interface SelectorFrameOptions {
	title: string;
	subtitle?: string;
	hint?: string;
	summary?: string;
	footerHint?: string;
	onClose?: () => void;
}

/**
 * Shared visual frame for selector-style modal panels.
 * Keeps borders, spacing, title hierarchy, and footer hints consistent.
 */
export class SelectorFrame extends Container implements OverlayChromeTarget {
	private body: Container;
	private footer: Container;
	private readonly onCloseCallback?: () => void;

	constructor(options: SelectorFrameOptions) {
		super();
		this.onCloseCallback = options.onClose;

		const topRule: Component = {
			invalidate() {},
			render: (width: number) => {
				const closeWidth = this.onCloseCallback ? visibleWidth(CLOSE_LABEL) : 0;
				const title = truncateToWidth(options.title, Math.max(1, width - 8 - closeWidth), "…");
				const left = `╭─ ${title} `;
				const right = "╮";
				const fillWidth = Math.max(0, width - visibleWidth(left) - closeWidth - visibleWidth(right));
				const closePart = this.onCloseCallback ? theme.fg("muted", CLOSE_LABEL) : "";
				return [
					theme.fg("accent", left) +
						theme.fg("borderMuted", "─".repeat(fillWidth)) +
						closePart +
						theme.fg("accent", right),
				];
			},
		};
		const bottomRule: Component = {
			invalidate() {},
			render: (width: number) => [theme.fg("borderMuted", `╰${"─".repeat(Math.max(0, width - 2))}╯`)],
		};

		this.addChild(topRule);
		this.addChild(new Spacer(1));

		if (options.subtitle) {
			this.addChild(new Text(theme.fg("muted", options.subtitle), 1, 0));
		}
		if (options.hint) {
			this.addChild(new Text(theme.fg("dim", options.hint), 1, 0));
		}
		if (options.summary) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(options.summary, 0, 0));
		}

		this.addChild(new Spacer(1));
		this.body = new Container();
		this.addChild(this.body);

		this.footer = new Container();
		if (options.footerHint) {
			this.footer.addChild(new Spacer(1));
			this.footer.addChild(new Text(theme.fg("dim", options.footerHint), 0, 0));
		}
		this.addChild(this.footer);
		this.addChild(new Spacer(1));
		this.addChild(bottomRule);
	}

	getBody(): Container {
		return this.body;
	}

	setFooterHint(text: string | undefined): void {
		this.footer.clear();
		if (text) {
			this.footer.addChild(new Spacer(1));
			this.footer.addChild(new Text(theme.fg("dim", text), 0, 0));
		}
	}

	collectOverlayMouseRegions(width: number): HitRegion[] {
		if (!this.onCloseCallback) return [];
		const closeWidth = visibleWidth(CLOSE_LABEL);
		// Generous hit box for the × button: makes clicking the close reliable even with
		// slight movement on release, coord jitter, or small terminal sizing differences.
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
		this.onCloseCallback?.();
	}
}