import {
	applyMouseHoverStyle,
	type Component,
	Container,
	type Focusable,
	getKeybindings,
	type HitRegion,
	type OverlayInteractiveTarget,
	truncateToWidth,
} from "@mrquake/quakecode-tui";
import { theme } from "../theme/theme.js";
import { OverlayRegionCache } from "../overlay-region-cache.js";
import { SelectorFrame } from "./selector-frame.js";

interface UserMessageItem {
	id: string;
	text: string;
	timestamp?: string;
}

/**
 * Custom user message list component with selection
 */
class UserMessageList implements Component {
	private messages: UserMessageItem[] = [];
	private selectedIndex = 0;
	public onSelect?: (entryId: string) => void;
	public onCancel?: () => void;
	private maxVisible = 10;
	private mouseHoverIndex: number | null = null;
	private itemLineRegions: Array<{ index: number; lineStart: number; lineEnd: number }> = [];

	constructor(messages: UserMessageItem[]) {
		this.messages = messages;
		this.selectedIndex = Math.max(0, messages.length - 1);
	}

	invalidate(): void {}

	setMouseHoverIndex(index: number | null): void {
		if (this.mouseHoverIndex === index) return;
		this.mouseHoverIndex = index;
		if (index !== null) {
			this.selectedIndex = index;
		}
	}

	selectMouseIndex(index: number): void {
		if (index < 0 || index >= this.messages.length) return;
		this.selectedIndex = index;
		const selected = this.messages[index];
		if (selected && this.onSelect) {
			this.onSelect(selected.id);
		}
	}

	scrollByWheel(direction: "up" | "down"): void {
		if (this.messages.length === 0) return;
		if (direction === "up") {
			this.selectedIndex = this.selectedIndex === 0 ? this.messages.length - 1 : this.selectedIndex - 1;
		} else {
			this.selectedIndex = this.selectedIndex === this.messages.length - 1 ? 0 : this.selectedIndex + 1;
		}
	}

	buildItemRegions(width: number, panelId: string, linePrefix: number, target: unknown): HitRegion[] {
		this.render(width);
		return this.toItemRegions(panelId, linePrefix, width, target);
	}

	toItemRegions(panelId: string, linePrefix: number, width: number, target: unknown): HitRegion[] {
		return this.itemLineRegions.map(({ index, lineStart, lineEnd }) => ({
			id: `overlay-item:${panelId}:${index}`,
			contentLineStart: linePrefix + lineStart,
			contentLineEnd: linePrefix + lineEnd,
			xStart: 0,
			xEnd: width,
			target,
		}));
	}

	getStructureKey(): string {
		return `${this.selectedIndex}|${this.messages.length}`;
	}

	render(width: number): string[] {
		const lines: string[] = [];
		this.itemLineRegions = [];

		if (this.messages.length === 0) {
			lines.push(theme.fg("muted", "  No user messages found"));
			return lines;
		}

		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.messages.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.messages.length);

		for (let i = startIndex; i < endIndex; i++) {
			const message = this.messages[i]!;
			const isSelected = i === this.selectedIndex;
			const isHovered = this.mouseHoverIndex === i;

			const normalizedMessage = message.text.replace(/\n/g, " ").trim();
			const cursor = isSelected || isHovered ? theme.fg("accent", "› ") : "  ";
			const maxMsgWidth = width - 2;
			const truncatedMsg = truncateToWidth(normalizedMessage, maxMsgWidth);
			let messageLine = cursor + (isSelected || isHovered ? theme.bold(truncatedMsg) : truncatedMsg);
			if (isHovered && !isSelected) {
				messageLine = applyMouseHoverStyle(messageLine);
			}

			const lineStart = lines.length;
			lines.push(messageLine);

			const position = i + 1;
			const metadata = `  Message ${position} of ${this.messages.length}`;
			lines.push(theme.fg("muted", metadata));
			lines.push("");
			this.itemLineRegions.push({ index: i, lineStart, lineEnd: lineStart + 2 });
		}

		if (startIndex > 0 || endIndex < this.messages.length) {
			lines.push(theme.fg("muted", `  (${this.selectedIndex + 1}/${this.messages.length})`));
		}

		return lines;
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up")) {
			this.selectedIndex = this.selectedIndex === 0 ? this.messages.length - 1 : this.selectedIndex - 1;
		} else if (kb.matches(keyData, "tui.select.down")) {
			this.selectedIndex = this.selectedIndex === this.messages.length - 1 ? 0 : this.selectedIndex + 1;
		} else if (kb.matches(keyData, "tui.select.confirm")) {
			const selected = this.messages[this.selectedIndex];
			if (selected && this.onSelect) {
				this.onSelect(selected.id);
			}
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancel?.();
		}
	}
}

/**
 * Component that renders a user message selector for branching
 */
export class UserMessageSelectorComponent extends Container implements Focusable, OverlayInteractiveTarget {
	private messageList: UserMessageList;
	private lastRenderWidth = 80;
	private overlayListPrefix = 0;
	private readonly overlayRegionCache = new OverlayRegionCache();
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
	}

	constructor(messages: UserMessageItem[], onSelect: (entryId: string) => void, onCancel: () => void) {
		super();

		const hint =
			theme.fg("dim", "↑↓") +
			theme.fg("muted", " navigate · ") +
			theme.fg("dim", "Enter") +
			theme.fg("muted", " branch · ") +
			theme.fg("dim", "Esc") +
			theme.fg("muted", " close");

		const frame = new SelectorFrame({
			title: "Branch from Message",
			subtitle: "Select a message to create a new branch from that point",
			hint,
			footerHint: "Esc · × close",
			onClose: onCancel,
		});
		const body = frame.getBody();
		this.addChild(frame);

		this.messageList = new UserMessageList(messages);
		this.messageList.onSelect = onSelect;
		this.messageList.onCancel = onCancel;
		body.addChild(this.messageList);

		if (messages.length === 0) {
			setTimeout(() => onCancel(), 100);
		}
	}

	render(width: number): string[] {
		this.lastRenderWidth = width;
		const lines = super.render(width);
		const listOnly = this.messageList.render(width);
		this.overlayListPrefix = lines.length - listOnly.length;
		return lines;
	}

	collectOverlayContentRegions(width: number): HitRegion[] {
		return this.overlayRegionCache.get(width, this.messageList.getStructureKey(), () => {
			if (width !== this.lastRenderWidth) this.render(width);
			return this.messageList.toItemRegions("user-message", this.overlayListPrefix, width, this);
		});
	}

	setMouseHoverIndex(index: number | null): void {
		this.messageList.setMouseHoverIndex(index);
	}

	selectMouseIndex(index: number): void {
		this.messageList.selectMouseIndex(index);
	}

	scrollByWheel(direction: "up" | "down"): void {
		this.messageList.scrollByWheel(direction);
	}

	handleInput(keyData: string): void {
		this.messageList.handleInput(keyData);
	}

	getMessageList(): UserMessageList {
		return this.messageList;
	}
}