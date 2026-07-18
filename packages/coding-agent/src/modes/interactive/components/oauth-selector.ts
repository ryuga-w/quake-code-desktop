import { getOAuthProviders } from "@mrquake/quakecode-ai/oauth";
import {
	applyMouseHoverStyle,
	Container,
	type Focusable,
	getKeybindings,
	type HitRegion,
	type OverlayInteractiveTarget,
	TruncatedText,
} from "@mrquake/quakecode-tui";
import type { AuthStorage } from "../../../core/auth-storage.js";
import { theme } from "../theme/theme.js";
import { mapOverlayHitMap, OverlayRegionCache } from "../overlay-region-cache.js";
import { SelectorFrame } from "./selector-frame.js";

interface ProviderListItem {
	id: string;
	name: string;
	kind: "oauth" | "api_key";
}

/**
 * Component that renders an auth provider selector.
 * Supports OAuth providers plus selected API-key providers like OpenRouter.
 */
export class OAuthSelectorComponent extends Container implements Focusable, OverlayInteractiveTarget {
	private listContainer: Container;
	private allProviders: ProviderListItem[] = [];
	private selectedIndex = 0;
	private mode: "login" | "logout";
	private authStorage: AuthStorage;
	private onSelectCallback: (providerId: string) => void;
	private onCancelCallback: () => void;
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
		mode: "login" | "logout",
		authStorage: AuthStorage,
		onSelect: (providerId: string) => void,
		onCancel: () => void,
	) {
		super();

		this.mode = mode;
		this.authStorage = authStorage;
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;
		this.loadProviders();

		const title = mode === "login" ? "Login" : "Logout";
		const subtitle = mode === "login" ? "Choose a provider for this session" : "Choose which provider to disconnect";
		const hint = `${theme.fg("dim", "↑↓")} ${theme.fg("muted", "navigate · ")}${theme.fg("dim", "Enter")} ${theme.fg("muted", "select · ")}${theme.fg("dim", "Esc")} ${theme.fg("muted", "close")}`;
		const frame = new SelectorFrame({
			title,
			subtitle,
			hint,
			footerHint: mode === "login" ? "Signed-in providers are marked in green" : "Esc · × close",
			onClose: () => this.onCancelCallback(),
		});
		this.listContainer = frame.getBody();
		this.addChild(frame);

		this.updateList();
	}

	private loadProviders(): void {
		const providerOrder: Record<string, number> = {
			"openai-codex": 0,
			"google-antigravity": 1,
			anthropic: 2,
			"google-gemini-cli": 3,
			"amazon-kiro": 4,
			openrouter: 5,
		};

		const oauthProviders: ProviderListItem[] = getOAuthProviders().map((p) => ({
			id: p.id,
			name: p.name,
			kind: "oauth",
		}));

		const apiKeyProviders: ProviderListItem[] = [];
		const hasOpenRouter = this.authStorage.hasAuth("openrouter");
		if (this.mode === "login" || hasOpenRouter) {
			apiKeyProviders.push({
				id: "openrouter",
				name: "OpenRouter (API Key)",
				kind: "api_key",
			});
		}
		this.allProviders = [...oauthProviders, ...apiKeyProviders].sort((a, b) => {
			const aOrder = providerOrder[a.id] ?? Number.MAX_SAFE_INTEGER;
			const bOrder = providerOrder[b.id] ?? Number.MAX_SAFE_INTEGER;
			if (aOrder !== bOrder) return aOrder - bOrder;
			return a.name.localeCompare(b.name);
		});
	}

	private computeListBodyStartLine(width: number): number {
		const frameLines = this.children[0]?.render(width).length ?? 0;
		const listLines = this.listContainer.render(width).length;
		return Math.max(0, frameLines - listLines - 2);
	}

	private formatRow(provider: ProviderListItem, index: number, isSelected: boolean): string {
		const isHovered = this.mouseHoverIndex === index;
		const credentials = this.authStorage.get(provider.id);
		const isConfigured = credentials?.type === "oauth" || credentials?.type === "api_key";
		const statusLabel = isConfigured
			? provider.kind === "api_key"
				? "configured"
				: "signed in"
			: provider.kind === "api_key"
				? "enter key"
				: "available";
		const statusIndicator = isConfigured ? theme.fg("success", statusLabel) : theme.fg("dim", statusLabel);

		const prefix = isSelected || isHovered ? theme.fg("accent", "› ") : "  ";
		const name = isSelected || isHovered ? theme.fg("accent", provider.name) : provider.name;
		let line = `${prefix}${name}  ${statusIndicator}`;
		if (isHovered && !isSelected) {
			line = applyMouseHoverStyle(line);
		}
		return line;
	}

	private updateList(): void {
		const width = this.lastRenderWidth;
		const listBodyStart = this.computeListBodyStartLine(width);
		this.listContainer.clear();
		this.overlayHitMap = [];
		let lineInList = 0;

		for (let i = 0; i < this.allProviders.length; i++) {
			const provider = this.allProviders[i];
			if (!provider) continue;

			const isSelected = i === this.selectedIndex;
			this.overlayHitMap.push({ index: i, line: listBodyStart + lineInList });
			this.listContainer.addChild(new TruncatedText(this.formatRow(provider, i, isSelected), 0, 0));
			lineInList += 1;

			if (i < this.allProviders.length - 1) {
				this.listContainer.addChild(new TruncatedText(theme.fg("dim", "  ─────────────────────────────"), 0, 0));
				lineInList += 1;
			}
		}

		if (this.allProviders.length === 0) {
			const message =
				this.mode === "login" ? "No providers available" : "No configured providers. Use /login first.";
			this.listContainer.addChild(new TruncatedText(theme.fg("muted", message), 0, 0));
		}
	}

	render(width: number): string[] {
		this.lastRenderWidth = width;
		return super.render(width);
	}

	collectOverlayContentRegions(width: number): HitRegion[] {
		return this.overlayRegionCache.get(width, `${this.selectedIndex}|${this.allProviders.length}|${this.mode}`, () =>
			mapOverlayHitMap(this.overlayHitMap, "oauth", width, this),
		);
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
		if (index < 0 || index >= this.allProviders.length) return;
		this.selectedIndex = index;
		this.updateList();
		const selectedProvider = this.allProviders[index];
		if (selectedProvider) {
			this.onSelectCallback(selectedProvider.id);
		}
	}

	scrollByWheel(direction: "up" | "down"): void {
		if (this.allProviders.length === 0) return;
		if (direction === "up") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		} else {
			this.selectedIndex = Math.min(this.allProviders.length - 1, this.selectedIndex + 1);
		}
		this.updateList();
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.down")) {
			this.selectedIndex = Math.min(this.allProviders.length - 1, this.selectedIndex + 1);
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.confirm")) {
			const selectedProvider = this.allProviders[this.selectedIndex];
			if (selectedProvider) {
				this.onSelectCallback(selectedProvider.id);
			}
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
		}
	}
}