import {
	applyMouseHoverStyle,
	Container,
	type Focusable,
	getKeybindings,
	type HitRegion,
	type OverlayInteractiveTarget,
	TruncatedText,
} from "@mrquake/quakecode-tui";
import {
	forgetEntry,
	formatEntryForDisplay,
	listEntries,
	type MemoryEntry,
} from "../../../core/memory/memory-store.js";
import {
	consolidateMemory,
	createMemorySummarizer,
	getDefaultAgentName,
	getMemoryStatus,
} from "../../../core/memory-consolidation.js";
import { theme } from "../theme/theme.js";
import { mapOverlayHitMap, OverlayRegionCache } from "../overlay-region-cache.js";
import { SelectorFrame } from "./selector-frame.js";

export type MemoryPanelAction = "close" | "forget" | "consolidate";

export class MemoryPanelComponent extends Container implements Focusable, OverlayInteractiveTarget {
	private listContainer: Container;
	private entries: MemoryEntry[] = [];
	private selectedIndex = 0;
	private detailMode = false;
	private mouseHoverIndex: number | null = null;
	private overlayHitMap: Array<{ index: number; line: number }> = [];
	private readonly overlayRegionCache = new OverlayRegionCache();
	private lastRenderWidth = 80;
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
	}

	constructor(
		private cwd: string,
		private onAction: (action: MemoryPanelAction, entry?: MemoryEntry) => void,
	) {
		super();

		const frame = new SelectorFrame({
			title: "Memory",
			subtitle: "Layered memory: user → project → local → session",
			hint: `${theme.fg("dim", "↑↓")} ${theme.fg("muted", "navigate · ")}${theme.fg("dim", "Enter")} ${theme.fg("muted", "view · ")}${theme.fg("dim", "d")} ${theme.fg("muted", "delete · ")}${theme.fg("dim", "c")} ${theme.fg("muted", "consolidate · ")}${theme.fg("dim", "Esc")} ${theme.fg("muted", "close")}`,
			footerHint: "Agent tools: memory_remember · memory_recall · memory_forget · Esc · × close",
			onClose: () => this.onAction("close"),
		});
		this.listContainer = frame.getBody();
		this.addChild(frame);
		this.reload();
	}

	private reload(): void {
		this.entries = listEntries(getDefaultAgentName(), this.cwd);
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.entries.length - 1));
		this.renderList();
	}

	private computeListBodyStartLine(width: number): number {
		const frameLines = this.children[0]?.render(width).length ?? 0;
		const listLines = this.listContainer.render(width).length;
		return Math.max(0, frameLines - listLines - 2);
	}

	private formatEntryRow(entry: MemoryEntry, index: number, selected: boolean): string {
		const isHovered = this.mouseHoverIndex === index;
		const prefix = selected || isHovered ? theme.fg("accent", "› ") : "  ";
		const label = `${prefix}${entry.scope}/${entry.name} ${theme.fg("dim", `(${entry.type})`)} ${theme.fg("muted", entry.description)}`;
		if (selected || isHovered) {
			let row = theme.fg("accent", label);
			if (isHovered && !selected) {
				row = applyMouseHoverStyle(row);
			}
			return row;
		}
		return label;
	}

	private renderList(): void {
		const width = this.lastRenderWidth;
		const listBodyStart = this.computeListBodyStartLine(width);
		this.listContainer.clear();
		this.overlayHitMap = [];
		let lineInList = 0;
		const status = getMemoryStatus(getDefaultAgentName(), this.cwd);

		this.listContainer.addChild(
			new TruncatedText(
				theme.fg("muted", `${status.totalEntries} entries across ${status.scopes.length} scopes`),
				0,
				0,
			),
		);
		lineInList += 1;

		for (const s of status.scopes) {
			const flag = s.needsConsolidation ? theme.fg("warning", " !") : "";
			this.listContainer.addChild(
				new TruncatedText(
					theme.fg("dim", `  ${s.scope}: ${s.entryCount} · ${(s.bytes / 1024).toFixed(1)}KB${flag}`),
					0,
					0,
				),
			);
			lineInList += 1;
		}

		if (this.entries.length === 0) {
			this.listContainer.addChild(
				new TruncatedText(theme.fg("dim", "  (empty — agent can use memory_remember)"), 0, 0),
			);
			return;
		}

		for (let i = 0; i < this.entries.length; i++) {
			const e = this.entries[i]!;
			const selected = i === this.selectedIndex;
			this.overlayHitMap.push({ index: i, line: listBodyStart + lineInList });
			this.listContainer.addChild(new TruncatedText(this.formatEntryRow(e, i, selected), 0, 0));
			lineInList += 1;
		}

		if (this.detailMode) {
			const entry = this.entries[this.selectedIndex];
			if (entry) {
				this.listContainer.addChild(new TruncatedText("", 0, 0));
				for (const line of formatEntryForDisplay(entry).split("\n")) {
					this.listContainer.addChild(new TruncatedText(theme.fg("muted", line), 0, 0));
				}
			}
		}
	}

	render(width: number): string[] {
		this.lastRenderWidth = width;
		return super.render(width);
	}

	collectOverlayContentRegions(width: number): HitRegion[] {
		return this.overlayRegionCache.get(width, `${this.selectedIndex}|${this.entries.length}|${this.detailMode}`, () =>
			mapOverlayHitMap(this.overlayHitMap, "memory", width, this),
		);
	}

	setMouseHoverIndex(index: number | null): void {
		if (this.mouseHoverIndex === index) return;
		this.mouseHoverIndex = index;
		if (index !== null) {
			this.selectedIndex = index;
		}
		this.renderList();
	}

	selectMouseIndex(index: number): void {
		if (index < 0 || index >= this.entries.length) return;
		this.selectedIndex = index;
		this.detailMode = !this.detailMode;
		this.renderList();
	}

	scrollByWheel(direction: "up" | "down"): void {
		if (this.entries.length === 0) return;
		if (direction === "up") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		} else {
			this.selectedIndex = Math.min(this.entries.length - 1, this.selectedIndex + 1);
		}
		this.renderList();
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();

		if (kb.matches(keyData, "tui.select.cancel")) {
			this.onAction("close");
			return;
		}

		if (keyData === "c") {
			for (const s of getMemoryStatus(getDefaultAgentName(), this.cwd).scopes) {
				if (s.needsConsolidation) {
					consolidateMemory(getDefaultAgentName(), s.scope, this.cwd, createMemorySummarizer());
				}
			}
			this.reload();
			this.onAction("consolidate");
			return;
		}

		if (keyData === "d") {
			const entry = this.entries[this.selectedIndex];
			if (entry) {
				forgetEntry(getDefaultAgentName(), this.cwd, entry.name, entry.scope);
				this.detailMode = false;
				this.reload();
				this.onAction("forget", entry);
			}
			return;
		}

		if (kb.matches(keyData, "tui.select.up")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.renderList();
			return;
		}

		if (kb.matches(keyData, "tui.select.down")) {
			this.selectedIndex = Math.min(this.entries.length - 1, this.selectedIndex + 1);
			this.renderList();
			return;
		}

		if (kb.matches(keyData, "tui.select.confirm")) {
			this.detailMode = !this.detailMode;
			this.renderList();
		}
	}
}
