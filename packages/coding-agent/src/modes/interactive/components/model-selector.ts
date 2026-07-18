import { type Model, modelsAreEqual } from "@mrquake/quakecode-ai";
import {
	applyMouseHoverStyle,
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	type HitRegion,
	Input,
	type OverlayInteractiveTarget,
	Spacer,
	Text,
	type TUI,
} from "@mrquake/quakecode-tui";
import type { ModelRegistry } from "../../../core/model-registry.js";
import { defaultModelPerProvider } from "../../../core/model-resolver.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import { theme } from "../theme/theme.js";
import { mapOverlayHitMap, OverlayRegionCache } from "../overlay-region-cache.js";
import { SelectorFrame } from "./selector-frame.js";

interface ModelItem {
	provider: string;
	id: string;
	model: Model<any>;
}

interface ScopedModelItem {
	model: Model<any>;
	thinkingLevel?: string;
}

type ModelScope = "all" | "scoped";

const PROVIDER_LABELS: Record<string, string> = {
	"google-antigravity": "Antigravity",
	anthropic: "Anthropic",
	"openai-codex": "OpenAI Codex",
	"google-gemini-cli": "Google Cloud Assist",
	google: "Google",
	openai: "OpenAI",
	"github-copilot": "GitHub Copilot",
};

const PROVIDER_PRIORITY = ["google-antigravity", "openai-codex", "anthropic", "google-gemini-cli", "grok-cli", "grok"];

/** Shown only when searching — always-available proxies without real user setup. */
const DEFAULT_HIDDEN_PROVIDERS = new Set(["9router", "opencode-free", "proxy-free", "nvidia-direct", "mimo-free"]);

export class ModelSelectorComponent extends Container implements Focusable, OverlayInteractiveTarget {
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
	private currentModelText: Text;
	private scopeText?: Text;
	private scopeHintText?: Text;
	private allModels: ModelItem[] = [];
	private scopedModelItems: ModelItem[] = [];
	private activeModels: ModelItem[] = [];
	private filteredModels: ModelItem[] = [];
	private selectedIndex = 0;
	private currentModel?: Model<any>;
	private settingsManager: SettingsManager;
	private modelRegistry: ModelRegistry;
	private onSelectCallback: (model: Model<any>) => void;
	private onCancelCallback: () => void;
	private errorMessage?: string;
	private tui: TUI;
	private scopedModels: ReadonlyArray<ScopedModelItem>;
	private scope: ModelScope = "all";

	constructor(
		tui: TUI,
		currentModel: Model<any> | undefined,
		settingsManager: SettingsManager,
		modelRegistry: ModelRegistry,
		scopedModels: ReadonlyArray<ScopedModelItem>,
		onSelect: (model: Model<any>) => void,
		onCancel: () => void,
		initialSearchInput?: string,
	) {
		super();

		this.tui = tui;
		this.currentModel = currentModel;
		this.settingsManager = settingsManager;
		this.modelRegistry = modelRegistry;
		this.scopedModels = scopedModels;
		this.scope = scopedModels.length > 0 ? "scoped" : "all";
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;

		const hint =
			theme.fg("dim", "↑↓") +
			theme.fg("muted", " navigate · ") +
			theme.fg("dim", "Enter") +
			theme.fg("muted", " select · ") +
			theme.fg("dim", "Type") +
			theme.fg("muted", " filter · ") +
			theme.fg("dim", "Esc") +
			theme.fg("muted", " close");

		const frame = new SelectorFrame({
			title: "Select Model",
			subtitle: "Choose the model for this session",
			hint,
			onClose: () => this.onCancelCallback(),
		});
		const body = frame.getBody();
		this.addChild(frame);

		this.currentModelText = new Text("", 0, 0);
		body.addChild(this.currentModelText);

		body.addChild(new Spacer(1));
		this.searchInput = new Input();
		if (initialSearchInput) this.searchInput.setValue(initialSearchInput);
		this.searchInput.onSubmit = () => {
			if (this.filteredModels[this.selectedIndex]) {
				this.handleSelect(this.filteredModels[this.selectedIndex].model);
			}
		};
		body.addChild(new Text(theme.fg("dim", "Search models..."), 0, 0));
		body.addChild(this.searchInput);
		body.addChild(new Spacer(1));

		this.listContainer = new Container();
		body.addChild(this.listContainer);
		body.addChild(new Spacer(1));

		this.footerText = new Text("", 0, 0);
		body.addChild(this.footerText);

		this.loadModels().then(() => {
			if (initialSearchInput) this.filterModels(initialSearchInput);
			else this.updateList();
			this.refreshHeader();
			this.tui.requestRender();
		});
	}

	private providerLabel(provider: string): string {
		return PROVIDER_LABELS[provider] ?? provider;
	}

	private providerRank(provider: string): number {
		const idx = PROVIDER_PRIORITY.indexOf(provider);
		return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
	}

	private isSignedIn(provider: string): boolean {
		return this.modelRegistry.getAvailable().some((model) => model.provider === provider);
	}

	private passesConfiguredFilter(item: ModelItem): boolean {
		if (modelsAreEqual(this.currentModel, item.model)) return true;
		if (DEFAULT_HIDDEN_PROVIDERS.has(item.provider)) return false;
		return this.modelRegistry.hasConfiguredAuth(item.model);
	}

	private getRecommendedModel(): ModelItem | undefined {
		const providerBuckets = new Map<string, ModelItem[]>();
		for (const item of this.activeModels) {
			const bucket = providerBuckets.get(item.provider) ?? [];
			bucket.push(item);
			providerBuckets.set(item.provider, bucket);
		}

		const signedPriority = [...new Set([...PROVIDER_PRIORITY, ...Array.from(providerBuckets.keys())])].filter(
			(provider) => this.isSignedIn(provider),
		);

		for (const provider of signedPriority) {
			const bucket = providerBuckets.get(provider);
			if (!bucket?.length) continue;
			const defaultId = defaultModelPerProvider[provider as keyof typeof defaultModelPerProvider];
			return bucket.find((item) => item.id === defaultId) ?? bucket[0];
		}

		return undefined;
	}

	private async loadModels(): Promise<void> {
		let models: ModelItem[];
		this.modelRegistry.refresh();
		const loadError = this.modelRegistry.getError();
		if (loadError) this.errorMessage = loadError;

		try {
			const availableModels = await this.modelRegistry.getAvailable();
			models = availableModels.map((model: Model<any>) => ({ provider: model.provider, id: model.id, model }));
		} catch (error) {
			this.allModels = [];
			this.scopedModelItems = [];
			this.activeModels = [];
			this.filteredModels = [];
			this.errorMessage = error instanceof Error ? error.message : String(error);
			return;
		}

		this.allModels = this.sortModels(models);
		this.scopedModels = this.scopedModels.map((scoped) => {
			const refreshed = this.modelRegistry.find(scoped.model.provider, scoped.model.id);
			return refreshed ? { ...scoped, model: refreshed } : scoped;
		});
		this.scopedModelItems = this.sortModels(
			this.scopedModels.map((scoped) => ({
				provider: scoped.model.provider,
				id: scoped.model.id,
				model: scoped.model,
			})),
		);
		this.activeModels = this.scope === "scoped" ? this.scopedModelItems : this.allModels;
		this.filteredModels = this.activeModels;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
	}

	private sortModels(models: ModelItem[]): ModelItem[] {
		const sorted = [...models];
		sorted.sort((a, b) => {
			const aCurrent = modelsAreEqual(this.currentModel, a.model);
			const bCurrent = modelsAreEqual(this.currentModel, b.model);
			if (aCurrent && !bCurrent) return -1;
			if (!aCurrent && bCurrent) return 1;

			const aSigned = this.isSignedIn(a.provider) ? 0 : 1;
			const bSigned = this.isSignedIn(b.provider) ? 0 : 1;
			if (aSigned !== bSigned) return aSigned - bSigned;

			const providerRankDiff = this.providerRank(a.provider) - this.providerRank(b.provider);
			if (providerRankDiff !== 0) return providerRankDiff;

			const providerDiff = this.providerLabel(a.provider).localeCompare(this.providerLabel(b.provider));
			if (providerDiff !== 0) return providerDiff;
			return a.id.localeCompare(b.id);
		});
		return sorted;
	}

	private getScopeText(): string {
		const allChip = this.scope === "all" ? theme.fg("accent", "[ All ]") : theme.fg("muted", "[ All ]");
		const scopedChip = this.scope === "scoped" ? theme.fg("accent", "[ Scoped ]") : theme.fg("muted", "[ Scoped ]");
		return `${theme.fg("muted", "Scope ")} ${allChip} ${scopedChip}`;
	}

	private getScopeHintText(): string {
		return theme.fg("dim", "Tab") + theme.fg("muted", " switch scope");
	}

	private refreshHeader(): void {
		const current = this.currentModel
			? `${this.currentModel.name} ${theme.fg("muted", `(${this.providerLabel(this.currentModel.provider)})`)}`
			: theme.fg("muted", "No model selected");
		this.currentModelText.setText(`${theme.fg("muted", "Current: ")}${current}`);
		if (this.scopeText) this.scopeText.setText(this.getScopeText());
		if (this.scopeHintText) this.scopeHintText.setText(this.getScopeHintText());
		const count = this.filteredModels.length;
		const providerCount = new Set(this.filteredModels.map((m) => m.provider)).size;
		const configuredHint = !this.searchInput.getValue().trim() ? " · configured only (type to search all)" : "";
		this.footerText.setText(
			theme.fg(
				"dim",
				`↑↓ navigate · Enter select · Type filter${this.scopedModels.length > 0 ? " · Tab scope" : ""} · Esc close · ${count} models · ${providerCount} providers${configuredHint}`,
			),
		);
	}

	private setScope(scope: ModelScope): void {
		if (this.scope === scope) return;
		this.scope = scope;
		this.activeModels = this.scope === "scoped" ? this.scopedModelItems : this.allModels;
		this.selectedIndex = 0;
		this.filterModels(this.searchInput.getValue());
	}

	private filterModels(query: string): void {
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

		const pool = query ? this.activeModels : this.activeModels.filter((item) => this.passesConfiguredFilter(item));

		this.filteredModels = query
			? fuzzyFilter(pool, Array.from(queryAliases).join(" "), ({ id, provider, model }) => {
					const providerLabel = this.providerLabel(provider);
					const aliases: string[] = [];
					if (provider === "openai-codex" || id.includes("gpt")) {
						aliases.push("chatgpt", "chat", "gpt", "openai", "codex");
					}
					return `${id} ${provider} ${providerLabel} ${provider}/${id} ${model.name} ${aliases.join(" ")}`;
				})
			: pool;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
		this.updateList();
	}

	private formatRow(
		item: ModelItem,
		filteredIndex: number,
		isSelected: boolean,
		isCurrent: boolean,
		isRecommended: boolean,
	): string {
		const isHovered = this.mouseHoverIndex === filteredIndex;
		const pointer = isSelected || isHovered ? theme.fg("accent", "› ") : "  ";
		const modelWidth = 34;
		const rawModel =
			item.id.length > modelWidth ? `${item.id.slice(0, modelWidth - 1)}…` : item.id.padEnd(modelWidth, " ");
		const modelText = isSelected || isHovered ? theme.fg("accent", rawModel) : rawModel;
		const providerBadge = theme.fg("muted", `[${this.providerLabel(item.provider)}]`);
		const tags: string[] = [];
		if (isCurrent) tags.push(theme.fg("success", "current"));
		if (isRecommended) tags.push(theme.fg("accent", "recommended"));
		if (this.isSignedIn(item.provider)) tags.push(theme.fg("dim", "signed in"));
		const tagText = tags.length ? `  ${tags.join(theme.fg("muted", " · "))}` : "";
		let row = `${pointer}${modelText} ${providerBadge}${tagText}`;
		if (isHovered && !isSelected) {
			row = applyMouseHoverStyle(row);
		}
		return row;
	}

	private computeListBodyStartLine(width: number): number {
		const frameLines = this.children[0]?.render(width).length ?? 0;
		const listLines = this.listContainer.render(width).length;
		return Math.max(0, frameLines - listLines - 2);
	}

	render(width: number): string[] {
		this.lastRenderWidth = width;
		return super.render(width);
	}

	collectOverlayContentRegions(width: number): HitRegion[] {
		return this.overlayRegionCache.get(width, this.getOverlayRegionKey(), () =>
			mapOverlayHitMap(this.overlayHitMap, "model", width, this),
		);
	}

	private getOverlayRegionKey(): string {
		return `${this.selectedIndex}|${this.filteredModels.length}|${this.scope}|${this.searchInput.getValue()}|${this.errorMessage ?? ""}`;
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
		if (index < 0 || index >= this.filteredModels.length) return;
		this.selectedIndex = index;
		this.updateList();
		const selected = this.filteredModels[index];
		if (selected) {
			void this.handleSelect(selected.model);
		}
	}

	scrollByWheel(direction: "up" | "down"): void {
		if (this.filteredModels.length === 0) return;
		if (direction === "up") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		} else {
			this.selectedIndex = Math.min(this.filteredModels.length - 1, this.selectedIndex + 1);
		}
		this.updateList();
	}

	private updateList(): void {
		const width = this.lastRenderWidth;
		const listBodyStart = this.computeListBodyStartLine(width);
		this.listContainer.clear();
		this.overlayHitMap = [];
		let lineInList = 0;

		if (this.errorMessage) {
			for (const line of this.errorMessage.split("\n")) {
				this.listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
			}
			this.refreshHeader();
			return;
		}

		if (this.filteredModels.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "No matching models"), 0, 0));
			this.refreshHeader();
			return;
		}

		const recommended = this.getRecommendedModel();
		const maxVisible = 12;
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filteredModels.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, this.filteredModels.length);
		const visibleItems = this.filteredModels.slice(startIndex, endIndex);
		const visibleRecommended =
			recommended &&
			visibleItems.find((item) => item.provider === recommended.provider && item.id === recommended.id);

		if (visibleRecommended) {
			this.listContainer.addChild(new Text(theme.fg("accent", theme.bold("Recommended")), 0, 0));
			lineInList += 1;
			const recIndex = this.filteredModels.findIndex(
				(item) => item.provider === visibleRecommended.provider && item.id === visibleRecommended.id,
			);
			this.overlayHitMap.push({ index: recIndex, line: listBodyStart + lineInList });
			this.listContainer.addChild(
				new Text(
					this.formatRow(
						visibleRecommended,
						recIndex,
						recIndex === this.selectedIndex,
						modelsAreEqual(this.currentModel, visibleRecommended.model),
						true,
					),
					0,
					0,
				),
			);
			lineInList += 1;
			this.listContainer.addChild(new Spacer(1));
		}

		let lastProvider: string | undefined;
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredModels[i];
			if (!item) continue;
			const isRecommended = Boolean(
				recommended && recommended.provider === item.provider && recommended.id === item.id,
			);
			if (isRecommended && visibleRecommended) continue;
			if (item.provider !== lastProvider) {
				if (lastProvider !== undefined) {
					this.listContainer.addChild(new Spacer(1));
					lineInList += 1;
				}
				const providerTitle = `${this.providerLabel(item.provider)}${this.isSignedIn(item.provider) ? theme.fg("dim", " · signed in") : ""}`;
				this.listContainer.addChild(new Text(theme.fg("muted", providerTitle), 0, 0));
				lineInList += 1;
				lastProvider = item.provider;
			}
			this.overlayHitMap.push({ index: i, line: listBodyStart + lineInList });
			this.listContainer.addChild(
				new Text(
					this.formatRow(
						item,
						i,
						i === this.selectedIndex,
						modelsAreEqual(this.currentModel, item.model),
						isRecommended,
					),
					0,
					0,
				),
			);
			lineInList += 1;
		}

		if (startIndex > 0 || endIndex < this.filteredModels.length) {
			this.listContainer.addChild(new Spacer(1));
			this.listContainer.addChild(
				new Text(theme.fg("muted", `(${this.selectedIndex + 1}/${this.filteredModels.length})`), 0, 0),
			);
		}

		const selected = this.filteredModels[this.selectedIndex];
		if (selected) {
			const thinking = selected.model.reasoning ? "Thinking supported" : "Fast / no extended thinking";
			const auth = this.isSignedIn(selected.provider) ? "Signed in or API key configured" : "Configured provider";
			this.listContainer.addChild(new Spacer(1));
			this.listContainer.addChild(new Text(theme.fg("muted", `Model Name: ${selected.model.name}`), 0, 0));
			this.listContainer.addChild(
				new Text(theme.fg("dim", `${this.providerLabel(selected.provider)} · ${thinking} · ${auth}`), 0, 0),
			);
		}

		this.refreshHeader();
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.input.tab")) {
			if (this.scopedModelItems.length > 0) {
				this.setScope(this.scope === "all" ? "scoped" : "all");
			}
			return;
		}
		if (kb.matches(keyData, "tui.select.up")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.down")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.confirm")) {
			const selectedModel = this.filteredModels[this.selectedIndex];
			if (selectedModel) this.handleSelect(selectedModel.model);
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
		} else {
			this.searchInput.handleInput(keyData);
			this.filterModels(this.searchInput.getValue());
		}
	}

	private handleSelect(model: Model<any>): void {
		this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
		this.onSelectCallback(model);
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
