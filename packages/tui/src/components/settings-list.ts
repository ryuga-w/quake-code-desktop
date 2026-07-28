import { fuzzyFilter } from "../fuzzy.js";
import { getKeybindings } from "../keybindings.js";
import { applyMouseHoverStyle } from "../mouse.js";
import type { HitRegion } from "../spatial-index.js";
import type { Component } from "../tui.js";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "../utils.js";
import { Input } from "./input.js";

export interface SettingItem {
	/** Unique identifier for this setting */
	id: string;
	/** Display label (left side) */
	label: string;
	/** Optional description shown when selected */
	description?: string;
	/** Current value to display (right side) */
	currentValue: string;
	/** If provided, Enter/Space cycles through these values */
	values?: string[];
	/** If provided, Enter opens this submenu. Receives current value and done callback. */
	submenu?: (currentValue: string, done: (selectedValue?: string) => void) => Component;
}

export interface SettingsListTheme {
	label: (text: string, selected: boolean) => string;
	value: (text: string, selected: boolean) => string;
	description: (text: string) => string;
	cursor: string;
	hint: (text: string) => string;
}

export interface SettingsListOptions {
	enableSearch?: boolean;
}

export class SettingsList implements Component {
	private items: SettingItem[];
	private filteredItems: SettingItem[];
	private theme: SettingsListTheme;
	private selectedIndex = 0;
	private maxVisible: number;
	private onChange: (id: string, newValue: string) => void;
	private onCancel: () => void;
	private searchInput?: Input;
	private searchEnabled: boolean;

	// Submenu state
	private submenuComponent: Component | null = null;
	private submenuItemIndex: number | null = null;
	private mouseHoverIndex: number | null = null;
	private itemLineRegions: Array<{ index: number; lineStart: number; lineEnd: number }> = [];

	constructor(
		items: SettingItem[],
		maxVisible: number,
		theme: SettingsListTheme,
		onChange: (id: string, newValue: string) => void,
		onCancel: () => void,
		options: SettingsListOptions = {},
	) {
		this.items = items;
		this.filteredItems = items;
		this.maxVisible = maxVisible;
		this.theme = theme;
		this.onChange = onChange;
		this.onCancel = onCancel;
		this.searchEnabled = options.enableSearch ?? false;
		if (this.searchEnabled) {
			this.searchInput = new Input();
		}
	}

	/** Update an item's currentValue */
	updateValue(id: string, newValue: string): void {
		const item = this.items.find((i) => i.id === id);
		if (item) {
			item.currentValue = newValue;
		}
	}

	invalidate(): void {
		this.submenuComponent?.invalidate?.();
	}

	render(width: number): string[] {
		// If submenu is active, render it instead
		if (this.submenuComponent) {
			return this.submenuComponent.render(width);
		}

		return this.renderMainList(width);
	}

	setMouseHoverIndex(index: number | null): void {
		if (this.mouseHoverIndex === index) return;
		this.mouseHoverIndex = index;
		if (index !== null) {
			this.selectedIndex = index;
		}
	}

	selectMouseIndex(index: number): void {
		const displayItems = this.searchEnabled ? this.filteredItems : this.items;
		if (index < 0 || index >= displayItems.length) return;
		this.selectedIndex = index;
		this.activateItem();
	}

	scrollByWheel(direction: "up" | "down"): void {
		const displayItems = this.searchEnabled ? this.filteredItems : this.items;
		if (displayItems.length === 0) return;
		if (direction === "up") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		} else {
			this.selectedIndex = Math.min(displayItems.length - 1, this.selectedIndex + 1);
		}
	}

	buildItemRegions(
		width: number,
		panelId: string,
		linePrefix: number,
		target: unknown,
	): HitRegion[] {
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
		if (this.submenuComponent) return "submenu";
		const query = this.searchEnabled ? (this.searchInput?.getValue() ?? "") : "";
		const count = this.searchEnabled ? this.filteredItems.length : this.items.length;
		return `${this.selectedIndex}|${count}|${query}|${this.maxVisible}`;
	}

	private renderMainList(width: number): string[] {
		const lines: string[] = [];
		this.itemLineRegions = [];

		if (this.searchEnabled && this.searchInput) {
			lines.push(...this.searchInput.render(width));
			lines.push("");
		}

		if (this.items.length === 0) {
			lines.push(this.theme.hint("  No settings available"));
			if (this.searchEnabled) {
				this.addHintLine(lines, width);
			}
			return lines;
		}

		const displayItems = this.searchEnabled ? this.filteredItems : this.items;
		if (displayItems.length === 0) {
			lines.push(truncateToWidth(this.theme.hint("  No matching settings"), width));
			this.addHintLine(lines, width);
			return lines;
		}

		// Calculate visible range with scrolling
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), displayItems.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, displayItems.length);

		// Calculate max label width for alignment
		const maxLabelWidth = Math.min(30, Math.max(...this.items.map((item) => visibleWidth(item.label))));

		// Render visible items
		for (let i = startIndex; i < endIndex; i++) {
			const item = displayItems[i];
			if (!item) continue;

			const isSelected = i === this.selectedIndex;
			const isHovered = this.mouseHoverIndex === i;
			const prefix = isSelected ? this.theme.cursor : "  ";
			const prefixWidth = visibleWidth(prefix);

			// Pad label to align values
			const labelPadded = item.label + " ".repeat(Math.max(0, maxLabelWidth - visibleWidth(item.label)));
			const labelText = this.theme.label(labelPadded, isSelected || isHovered);

			// Calculate space for value
			const separator = "  ";
			const usedWidth = prefixWidth + maxLabelWidth + visibleWidth(separator);
			const valueMaxWidth = width - usedWidth - 2;

			const valueText = this.theme.value(truncateToWidth(item.currentValue, valueMaxWidth, ""), isSelected || isHovered);

			let row = truncateToWidth(prefix + labelText + separator + valueText, width);
			if (isHovered && !isSelected) {
				row = applyMouseHoverStyle(row);
			}
			this.itemLineRegions.push({ index: i, lineStart: lines.length, lineEnd: lines.length + 1 });
			lines.push(row);
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < displayItems.length) {
			const scrollText = `  (${this.selectedIndex + 1}/${displayItems.length})`;
			lines.push(this.theme.hint(truncateToWidth(scrollText, width - 2, "")));
		}

		// Add description for selected item
		const selectedItem = displayItems[this.selectedIndex];
		if (selectedItem?.description) {
			lines.push("");
			const wrappedDesc = wrapTextWithAnsi(selectedItem.description, width - 4);
			for (const line of wrappedDesc) {
				lines.push(this.theme.description(`  ${line}`));
			}
		}

		// Add hint
		this.addHintLine(lines, width);

		return lines;
	}

	handleInput(data: string): void {
		// If submenu is active, delegate all input to it
		// The submenu's onCancel (triggered by escape) will call done() which closes it
		if (this.submenuComponent) {
			this.submenuComponent.handleInput?.(data);
			return;
		}

		// Main list input handling
		const kb = getKeybindings();
		const displayItems = this.searchEnabled ? this.filteredItems : this.items;
		if (kb.matches(data, "tui.select.up")) {
			if (displayItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? displayItems.length - 1 : this.selectedIndex - 1;
		} else if (kb.matches(data, "tui.select.down")) {
			if (displayItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === displayItems.length - 1 ? 0 : this.selectedIndex + 1;
		} else if (kb.matches(data, "tui.select.confirm") || data === " ") {
			this.activateItem();
		} else if (kb.matches(data, "tui.select.cancel")) {
			this.onCancel();
		} else if (this.searchEnabled && this.searchInput) {
			const sanitized = data.replace(/ /g, "");
			if (!sanitized) {
				return;
			}
			this.searchInput.handleInput(sanitized);
			this.applyFilter(this.searchInput.getValue());
		}
	}

	private activateItem(): void {
		const item = this.searchEnabled ? this.filteredItems[this.selectedIndex] : this.items[this.selectedIndex];
		if (!item) return;

		if (item.submenu) {
			// Open submenu, passing current value so it can pre-select correctly
			this.submenuItemIndex = this.selectedIndex;
			this.submenuComponent = item.submenu(item.currentValue, (selectedValue?: string) => {
				if (selectedValue !== undefined) {
					item.currentValue = selectedValue;
					this.onChange(item.id, selectedValue);
				}
				this.closeSubmenu();
			});
		} else if (item.values && item.values.length > 0) {
			// Cycle through values
			const currentIndex = item.values.indexOf(item.currentValue);
			const nextIndex = (currentIndex + 1) % item.values.length;
			const newValue = item.values[nextIndex];
			item.currentValue = newValue;
			this.onChange(item.id, newValue);
		}
	}

	private closeSubmenu(): void {
		this.submenuComponent = null;
		// Restore selection to the item that opened the submenu
		if (this.submenuItemIndex !== null) {
			this.selectedIndex = this.submenuItemIndex;
			this.submenuItemIndex = null;
		}
	}

	private applyFilter(query: string): void {
		this.filteredItems = fuzzyFilter(this.items, query, (item) => item.label);
		this.selectedIndex = 0;
	}

	private addHintLine(lines: string[], width: number): void {
		lines.push("");
		lines.push(
			truncateToWidth(
				this.theme.hint(
					this.searchEnabled
						? "  Type to search · Enter/Space to change · Esc to cancel"
						: "  Enter/Space to change · Esc to cancel",
				),
				width,
			),
		);
	}
}
