import type { Model } from "@mrquake/quakecode-ai";
import {
	applyMouseHoverStyle,
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	type HitRegion,
	Input,
	Key,
	matchesKey,
	type OverlayInteractiveTarget,
	Spacer,
	Text,
} from "@mrquake/quakecode-tui";
import { theme } from "../theme/theme.js";
import { mapOverlayHitMap, OverlayRegionCache } from "../overlay-region-cache.js";
import { SelectorFrame } from "./selector-frame.js";

type EnabledIds = string[] | null;

function isEnabled(enabledIds: EnabledIds, id: string): boolean {
	return enabledIds === null || enabledIds.includes(id);
}

function toggle(enabledIds: EnabledIds, id: string): EnabledIds {
	if (enabledIds === null) return [id];
	const index = enabledIds.indexOf(id);
	if (index >= 0) return [...enabledIds.slice(0, index), ...enabledIds.slice(index + 1)];
	return [...enabledIds, id];
}

function enableAll(enabledIds: EnabledIds, allIds: string[], targetIds?: string[]): EnabledIds {
	if (enabledIds === null) return null;
	const targets = targetIds ?? allIds;
	const result = [...enabledIds];
	for (const id of targets) {
		if (!result.includes(id)) result.push(id);
	}
	return result.length === allIds.length ? null : result;
}

function clearAll(enabledIds: EnabledIds, allIds: string[], targetIds?: string[]): EnabledIds {
	if (enabledIds === null) {
		return targetIds ? allIds.filter((id) => !targetIds.includes(id)) : [];
	}
	const targets = new Set(targetIds ?? enabledIds);
	return enabledIds.filter((id) => !targets.has(id));
}

function move(enabledIds: EnabledIds, allIds: string[], id: string, delta: number): EnabledIds {
	const list = enabledIds ?? [...allIds];
	const index = list.indexOf(id);
	if (index < 0) return list;
	const newIndex = index + delta;
	if (newIndex < 0 || newIndex >= list.length) return list;
	const result = [...list];
	[result[index], result[newIndex]] = [result[newIndex], result[index]];
	return result;
}

function getSortedIds(enabledIds: EnabledIds, allIds: string[]): string[] {
	if (enabledIds === null) return allIds;
	const enabledSet = new Set(enabledIds);
	return [...enabledIds, ...allIds.filter((id) => !enabledSet.has(id))];
}

interface ModelItem {
	fullId: string;
	model: Model<any>;
	enabled: boolean;
}

export interface ModelsConfig {
	allModels: Model<any>[];
	enabledModelIds: Set<string>;
	hasEnabledModelsFilter: boolean;
}

export interface ModelsCallbacks {
	onModelToggle: (modelId: string, enabled: boolean) => void;
	onPersist: (enabledModelIds: string[]) => void;
	onEnableAll: (allModelIds: string[]) => void;
	onClearAll: () => void;
	onToggleProvider: (provider: string, modelIds: string[], enabled: boolean) => void;
	onCancel: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
	"google-antigravity": "Antigravity",
	anthropic: "Anthropic",
	"openai-codex": "OpenAI Codex",
	"google-gemini-cli": "Google Cloud Assist",
	google: "Google",
	openai: "OpenAI",
	"github-copilot": "GitHub Copilot",
};

function providerLabel(provider: string): string {
	return PROVIDER_LABELS[provider] ?? provider;
}

export class ScopedModelsSelectorComponent extends Container implements Focusable, OverlayInteractiveTarget {
	private modelsById: Map<string, Model<any>> = new Map();
	private allIds: string[] = [];
	private enabledIds: EnabledIds = null;
	private filteredItems: ModelItem[] = [];
	private selectedIndex = 0;
	private searchInput: Input;
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
		this.searchInput.focused = value;
	}

	private listContainer: Container;
	private footerText: Text;
	private summaryText: Text;
	private callbacks: ModelsCallbacks;
	private maxVisible = 15;
	private isDirty = false;

	constructor(config: ModelsConfig, callbacks: ModelsCallbacks) {
		super();
		this.callbacks = callbacks;

		for (const model of config.allModels) {
			const fullId = `${model.provider}/${model.id}`;
			this.modelsById.set(fullId, model);
			this.allIds.push(fullId);
		}

		this.enabledIds = config.hasEnabledModelsFilter ? [...config.enabledModelIds] : null;
		this.filteredItems = this.buildItems();

		const hint =
			theme.fg("dim", "↑↓") +
			theme.fg("muted", " navigate · ") +
			theme.fg("dim", "Enter") +
			theme.fg("muted", " toggle · ") +
			theme.fg("dim", "Type") +
			theme.fg("muted", " filter · ") +
			theme.fg("dim", "Ctrl+S") +
			theme.fg("muted", " save · Esc close");

		const frame = new SelectorFrame({
			title: "Model Configuration",
			subtitle: "Choose which models appear in model cycling",
			hint,
			footerHint: "Ctrl+A enable all · Ctrl+X clear · Ctrl+P provider · Alt+↑↓ reorder · Esc · × close",
			onClose: () => this.callbacks.onCancel(),
		});
		const body = frame.getBody();
		this.addChild(frame);

		this.summaryText = new Text("", 0, 0);
		body.addChild(this.summaryText);
		body.addChild(new Spacer(1));

		body.addChild(new Text(theme.fg("dim", "Search models..."), 0, 0));
		this.searchInput = new Input();
		body.addChild(this.searchInput);
		body.addChild(new Spacer(1));

		this.listContainer = new Container();
		body.addChild(this.listContainer);
		body.addChild(new Spacer(1));

		this.footerText = new Text("", 0, 0);
		body.addChild(this.footerText);

		this.refresh();
	}

	private buildItems(): ModelItem[] {
		return getSortedIds(this.enabledIds, this.allIds)
			.filter((id) => this.modelsById.has(id))
			.map((id) => ({
				fullId: id,
				model: this.modelsById.get(id)!,
				enabled: isEnabled(this.enabledIds, id),
			}));
	}

	private getEnabledCount(): number {
		return this.enabledIds?.length ?? this.allIds.length;
	}

	private getProviderEnabledCount(provider: string): { enabled: number; total: number } {
		const ids = this.allIds.filter((id) => this.modelsById.get(id)?.provider === provider);
		return {
			enabled: ids.filter((id) => isEnabled(this.enabledIds, id)).length,
			total: ids.length,
		};
	}

	private getFooterText(): string {
		const enabledCount = this.getEnabledCount();
		const countText = this.enabledIds === null ? "all enabled" : `${enabledCount}/${this.allIds.length} enabled`;
		const base = theme.fg(
			"dim",
			`Enter toggle · Ctrl+A all · Ctrl+X clear · Ctrl+P provider · Alt+↑↓ reorder · Ctrl+S save · ${countText}`,
		);
		return this.isDirty ? `${base} ${theme.fg("warning", "(unsaved)")}` : base;
	}

	private refreshSummary(): void {
		const enabledCount = this.getEnabledCount();
		const providerCount = new Set(this.filteredItems.map((item) => item.model.provider)).size;
		const summary =
			this.enabledIds === null
				? theme.fg("muted", `Current: all models enabled across ${providerCount} providers`)
				: theme.fg(
						"muted",
						`Current: ${enabledCount}/${this.allIds.length} models enabled across ${providerCount} providers`,
					);
		this.summaryText.setText(summary);
		this.footerText.setText(this.getFooterText());
	}

	private refresh(): void {
		const query = this.searchInput.getValue();
		const items = this.buildItems();
		const normalizedQuery = query.trim().toLowerCase();
		const queryAliases = new Set<string>([normalizedQuery]);
		if (normalizedQuery.includes("chat")) {
			queryAliases.add(normalizedQuery.replace(/chatgpt|chat/g, "gpt"));
			queryAliases.add(normalizedQuery.replace(/chatgpt|chat/g, "openai codex"));
		}
		if (normalizedQuery.includes("gpt")) {
			queryAliases.add(normalizedQuery.replace(/gpt/g, "chatgpt"));
			queryAliases.add(normalizedQuery.replace(/gpt/g, "chat"));
		}
		this.filteredItems = query
			? fuzzyFilter(items, Array.from(queryAliases).join(" "), (i) => {
					const aliases: string[] = [];
					if (i.model.provider === "openai-codex" || i.model.id.includes("gpt")) {
						aliases.push("chatgpt", "chat", "gpt", "openai", "codex");
					}
					return `${i.model.id} ${i.model.provider} ${providerLabel(i.model.provider)} ${i.model.name} ${aliases.join(" ")}`;
				})
			: items;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredItems.length - 1));
		this.updateList();
	}

	private computeListBodyStartLine(width: number): number {
		const frameLines = this.children[0]?.render(width).length ?? 0;
		const listLines = this.listContainer.render(width).length;
		return Math.max(0, frameLines - listLines - 2);
	}

	private formatRow(item: ModelItem, filteredIndex: number, isSelected: boolean): string {
		const isHovered = this.mouseHoverIndex === filteredIndex;
		const pointer = isSelected || isHovered ? theme.fg("accent", "› ") : "  ";
		const modelWidth = 34;
		const rawModel =
			item.model.id.length > modelWidth
				? `${item.model.id.slice(0, modelWidth - 1)}…`
				: item.model.id.padEnd(modelWidth, " ");
		const modelText = isSelected || isHovered ? theme.fg("accent", rawModel) : rawModel;
		const badge = theme.fg("muted", `[${providerLabel(item.model.provider)}]`);
		const status = item.enabled ? theme.fg("success", "enabled") : theme.fg("dim", "disabled");
		let row = `${pointer}${modelText} ${badge}  ${status}`;
		if (isHovered && !isSelected) {
			row = applyMouseHoverStyle(row);
		}
		return row;
	}

	private updateList(): void {
		const width = this.lastRenderWidth;
		const listBodyStart = this.computeListBodyStartLine(width);
		this.listContainer.clear();
		this.overlayHitMap = [];
		let lineInList = 0;

		if (this.filteredItems.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "No matching models"), 0, 0));
			this.refreshSummary();
			return;
		}

		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredItems.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);

		let lastProvider: string | undefined;
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredItems[i]!;
			if (item.model.provider !== lastProvider) {
				if (lastProvider !== undefined) {
					this.listContainer.addChild(new Spacer(1));
					lineInList += 1;
				}
				const counts = this.getProviderEnabledCount(item.model.provider);
				this.listContainer.addChild(
					new Text(
						theme.fg(
							"muted",
							`${providerLabel(item.model.provider)} · ${counts.enabled}/${counts.total} enabled`,
						),
						0,
						0,
					),
				);
				lineInList += 1;
				lastProvider = item.model.provider;
			}
			this.overlayHitMap.push({ index: i, line: listBodyStart + lineInList });
			this.listContainer.addChild(new Text(this.formatRow(item, i, i === this.selectedIndex), 0, 0));
			lineInList += 1;
		}

		if (startIndex > 0 || endIndex < this.filteredItems.length) {
			this.listContainer.addChild(new Spacer(1));
			this.listContainer.addChild(
				new Text(theme.fg("muted", `(${this.selectedIndex + 1}/${this.filteredItems.length})`), 0, 0),
			);
		}

		const selected = this.filteredItems[this.selectedIndex];
		if (selected) {
			this.listContainer.addChild(new Spacer(1));
			this.listContainer.addChild(new Text(theme.fg("muted", `Model Name: ${selected.model.name}`), 0, 0));
			this.listContainer.addChild(
				new Text(
					theme.fg(
						"dim",
						`${providerLabel(selected.model.provider)} · ${selected.enabled ? "Included in cycling" : "Excluded from cycling"} · ${selected.model.reasoning ? "Thinking supported" : "Fast / no extended thinking"}`,
					),
					0,
					0,
				),
			);
		}

		this.refreshSummary();
	}

	handleInput(data: string): void {
		const kb = getKeybindings();

		if (kb.matches(data, "tui.select.up")) {
			if (this.filteredItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredItems.length - 1 : this.selectedIndex - 1;
			this.updateList();
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			if (this.filteredItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredItems.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			return;
		}

		if (matchesKey(data, Key.alt("up")) || matchesKey(data, Key.alt("down"))) {
			const item = this.filteredItems[this.selectedIndex];
			if (item && isEnabled(this.enabledIds, item.fullId)) {
				const delta = matchesKey(data, Key.alt("up")) ? -1 : 1;
				const enabledList = this.enabledIds ?? this.allIds;
				const currentIndex = enabledList.indexOf(item.fullId);
				const newIndex = currentIndex + delta;
				if (newIndex >= 0 && newIndex < enabledList.length) {
					this.enabledIds = move(this.enabledIds, this.allIds, item.fullId, delta);
					this.isDirty = true;
					this.selectedIndex += delta;
					this.refresh();
				}
			}
			return;
		}

		if (matchesKey(data, Key.enter)) {
			const item = this.filteredItems[this.selectedIndex];
			if (item) {
				const wasAllEnabled = this.enabledIds === null;
				this.enabledIds = toggle(this.enabledIds, item.fullId);
				this.isDirty = true;
				if (wasAllEnabled) this.callbacks.onClearAll();
				this.callbacks.onModelToggle(item.fullId, isEnabled(this.enabledIds, item.fullId));
				this.refresh();
			}
			return;
		}

		if (matchesKey(data, Key.ctrl("a"))) {
			const targetIds = this.searchInput.getValue() ? this.filteredItems.map((i) => i.fullId) : undefined;
			this.enabledIds = enableAll(this.enabledIds, this.allIds, targetIds);
			this.isDirty = true;
			this.callbacks.onEnableAll(targetIds ?? this.allIds);
			this.refresh();
			return;
		}

		if (matchesKey(data, Key.ctrl("x"))) {
			const targetIds = this.searchInput.getValue() ? this.filteredItems.map((i) => i.fullId) : undefined;
			this.enabledIds = clearAll(this.enabledIds, this.allIds, targetIds);
			this.isDirty = true;
			this.callbacks.onClearAll();
			this.refresh();
			return;
		}

		if (matchesKey(data, Key.ctrl("p"))) {
			const item = this.filteredItems[this.selectedIndex];
			if (item) {
				const provider = item.model.provider;
				const providerIds = this.allIds.filter((id) => this.modelsById.get(id)!.provider === provider);
				const allProviderEnabled = providerIds.every((id) => isEnabled(this.enabledIds, id));
				this.enabledIds = allProviderEnabled
					? clearAll(this.enabledIds, this.allIds, providerIds)
					: enableAll(this.enabledIds, this.allIds, providerIds);
				this.isDirty = true;
				this.callbacks.onToggleProvider(provider, providerIds, !allProviderEnabled);
				this.refresh();
			}
			return;
		}

		if (matchesKey(data, Key.ctrl("s"))) {
			this.callbacks.onPersist(this.enabledIds ?? [...this.allIds]);
			this.isDirty = false;
			this.footerText.setText(this.getFooterText());
			return;
		}

		if (matchesKey(data, Key.ctrl("c"))) {
			if (this.searchInput.getValue()) {
				this.searchInput.setValue("");
				this.refresh();
			} else {
				this.callbacks.onCancel();
			}
			return;
		}

		if (matchesKey(data, Key.escape)) {
			this.callbacks.onCancel();
			return;
		}

		this.searchInput.handleInput(data);
		this.refresh();
	}

	render(width: number): string[] {
		this.lastRenderWidth = width;
		return super.render(width);
	}

	collectOverlayContentRegions(width: number): HitRegion[] {
		return this.overlayRegionCache.get(width, this.getOverlayRegionKey(), () =>
			mapOverlayHitMap(this.overlayHitMap, "scoped-models", width, this),
		);
	}

	private getOverlayRegionKey(): string {
		return `${this.selectedIndex}|${this.filteredItems.length}|${this.searchInput.getValue()}`;
	}

	setMouseHoverIndex(index: number | null): void {
		if (this.mouseHoverIndex === index) return;
		this.mouseHoverIndex = index;
		if (index !== null) {
			this.selectedIndex = index;
		}
		this.updateList();
	}

	selectMouseIndex(index: number): void {
		if (index < 0 || index >= this.filteredItems.length) return;
		this.selectedIndex = index;
		this.updateList();
		const item = this.filteredItems[index];
		if (item) {
			const wasAllEnabled = this.enabledIds === null;
			this.enabledIds = toggle(this.enabledIds, item.fullId);
			this.isDirty = true;
			if (wasAllEnabled) this.callbacks.onClearAll();
			this.callbacks.onModelToggle(item.fullId, isEnabled(this.enabledIds, item.fullId));
			this.refresh();
		}
	}

	scrollByWheel(direction: "up" | "down"): void {
		if (this.filteredItems.length === 0) return;
		if (direction === "up") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		} else {
			this.selectedIndex = Math.min(this.filteredItems.length - 1, this.selectedIndex + 1);
		}
		this.updateList();
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
