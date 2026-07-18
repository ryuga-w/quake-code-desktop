import type { AssistantMessage, ThinkingContent } from "@mrquake/quakecode-ai";
import { type Component, Container, Markdown, type MarkdownTheme, Spacer, Text } from "@mrquake/quakecode-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";
import {
	doneContinuationPrefix,
	doneLeadPrefix,
	getLineRevealFactor,
	isRiseAnimationActive,
	liveContinuationPrefix,
	MESSAGE_GUTTER_WIDTH,
	riseContinuationPrefix,
	riseLeadPrefix,
	settledRailPrefix,
	statusLeadPrefix,
	streamingLeadPrefix,
	subscribeMessageAnimation,
	thinkingLeadPrefix,
} from "./message-chrome.js";

export type AssistantMessageOptions = {
	requestRender?: () => void;
};

/**
 * Component that renders a complete assistant message.
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private lastMessage?: AssistantMessage;
	private requestRender?: () => void;
	private animationUnsub?: () => void;
	private riseStartMs = 0;
	private blockRiseState = new Map<string, { riseStartMs: number; lineCount: number }>();

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = "Thinking...",
		options: AssistantMessageOptions = {},
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.requestRender = options.requestRender;

		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	stopLiveAnimation(): void {
		this.clearAnimation();
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	private clearAnimation(): void {
		this.animationUnsub?.();
		this.animationUnsub = undefined;
	}

	private ensureAnimationSubscription(): void {
		if (this.animationUnsub || !this.requestRender) return;
		this.animationUnsub = subscribeMessageAnimation(() => {
			this.requestRender?.();
			const isLive = Boolean(this.lastMessage && !this.lastMessage.stopReason);
			if (!isLive && !isRiseAnimationActive(this.riseStartMs)) {
				this.clearAnimation();
			}
		});
	}

	private syncAnimation(message: AssistantMessage): void {
		const isLive = !message.stopReason && Boolean(this.requestRender);
		const riseActive = isRiseAnimationActive(this.riseStartMs);
		if (isLive || riseActive) {
			this.ensureAnimationSubscription();
			return;
		}
		this.clearAnimation();
	}

	private touchRiseAnimation(startMs: number): void {
		this.riseStartMs = startMs;
		this.ensureAnimationSubscription();
	}

	private hasRenderableThinking(content: ThinkingContent): boolean {
		return Boolean(content.thinking.trim() || content.redacted || content.thinkingSignature?.trim());
	}

	private getThinkingRenderText(content: ThinkingContent): string {
		const thinkingText = content.thinking.trim();
		if (thinkingText) {
			return thinkingText;
		}
		if (content.redacted) {
			return "Reasoning hidden by provider";
		}
		return "Reasoning not exposed by provider";
	}

	private getBlockRiseState(blockId: string): { riseStartMs: number; lineCount: number } {
		const existing = this.blockRiseState.get(blockId);
		if (existing) return existing;
		const created = { riseStartMs: 0, lineCount: 0 };
		this.blockRiseState.set(blockId, created);
		return created;
	}

	private addRailMarkdown(
		blockId: string,
		text: string,
		isLive: boolean,
		mode: "thinking" | "answer",
		options?: ConstructorParameters<typeof Markdown>[4],
	): void {
		const md = new Markdown(text, 0, 0, this.markdownTheme, options);
		const riseEnabled = Boolean(this.requestRender) && mode === "answer";

		this.contentContainer.addChild({
			invalidate: () => md.invalidate(),
			render: (width: number) => {
				const blockState = this.getBlockRiseState(blockId);
				const blockRiseStartMs = blockState.riseStartMs;
				const riseAnimating = riseEnabled && isRiseAnimationActive(blockRiseStartMs);
				const showRail = isLive || riseAnimating;
				const gutterWidth = showRail ? MESSAGE_GUTTER_WIDTH : 0;
				const lines = md.render(Math.max(1, width - gutterWidth));
				if (riseEnabled && lines.length > blockState.lineCount) {
					blockState.lineCount = lines.length;
					blockState.riseStartMs = Date.now();
					this.touchRiseAnimation(blockState.riseStartMs);
				}
				const totalLines = lines.length;

				return lines.map((line, idx) => {
					const reveal = getLineRevealFactor(idx, totalLines, blockRiseStartMs, riseEnabled);
					if (reveal <= 0) return "";
					const prefix = (() => {
						if (reveal < 1) {
							return idx === 0 ? riseLeadPrefix(reveal) : riseContinuationPrefix(reveal);
						}
						if (!showRail) {
							return idx === 0 ? doneLeadPrefix() : doneContinuationPrefix();
						}
						if (isLive) {
							return idx === 0
								? mode === "thinking"
									? thinkingLeadPrefix()
									: streamingLeadPrefix()
								: liveContinuationPrefix();
						}
						return settledRailPrefix(idx === 0);
					})();
					return `${prefix}${line}`;
				});
			},
		} as Component);
	}

	private addStatusLine(kind: "error" | "aborted", label: string, text: string): void {
		const prefix = statusLeadPrefix(kind);
		const status = `${theme.fg("error", label)}${theme.fg("dim", " · ")}${theme.fg("error", text)}`;
		this.contentContainer.addChild(new Text(`${prefix}${status}`, 0, 0));
	}

	updateContent(message: AssistantMessage): void {
		this.lastMessage = message;
		this.syncAnimation(message);
		this.contentContainer.clear();

		const isLive = !message.stopReason;
		const hasToolCalls = message.content.some((content) => content.type === "toolCall");

		let renderedVisibleBlock = false;
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];

			if (content.type === "thinking" && this.hasRenderableThinking(content)) {
				if (isLive) {
					const thinkingText = this.hideThinkingBlock
						? `thinking\n${this.hiddenThinkingLabel}`
						: `reasoning\n${this.getThinkingRenderText(content)}`;
					this.addRailMarkdown(`thinking-${i}`, thinkingText, true, "thinking", {
						color: (text: string) => theme.fg("thinkingText", text),
						italic: true,
					});
					renderedVisibleBlock = true;

					const hasVisibleNext = message.content
						.slice(i + 1)
						.some(
							(c) =>
								(c.type === "text" && c.text.trim()) ||
								(c.type === "thinking" && this.hasRenderableThinking(c)),
						);
					if (hasVisibleNext) {
						this.contentContainer.addChild(new Spacer(1));
					}
				}
				continue;
			}

			if (content.type === "text" && content.text.trim()) {
				const text = content.text.trim();
				if (renderedVisibleBlock) {
					this.contentContainer.addChild(new Spacer(1));
				}
				this.addRailMarkdown(`answer-${i}`, text, isLive, "answer");
				renderedVisibleBlock = true;
			}
		}

		if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				this.contentContainer.addChild(new Spacer(1));
				this.addStatusLine("aborted", "aborted", abortMessage);
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.addStatusLine("error", "error", errorMsg);
			}
		}
	}
}
