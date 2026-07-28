import {
	Editor,
	type EditorOptions,
	type EditorTheme,
	type HitRegion,
	type MouseCollectContext,
	type MouseTarget,
	type TUI,
} from "@mrquake/quakecode-tui";
import type { AppKeybinding, KeybindingsManager } from "../../../core/keybindings.js";
import { COMPOSER_SHORTCUT_HINT, composerBarLine, composerBorderLine, composerHintLine } from "./composer-chrome.js";

/**
 * Custom editor that handles app-level keybindings for coding-agent.
 */
export class CustomEditor extends Editor implements MouseTarget {
	private keybindings: KeybindingsManager;
	public actionHandlers: Map<AppKeybinding, () => void> = new Map();
	private footerHintGetter?: () => string;
	private lastAutocompleteStartLine = 0;
	private lastRenderWidth = 80;

	// Special handlers that can be dynamically replaced
	public onEscape?: () => void;
	public onCtrlD?: () => void;
	public onPasteImage?: () => void;
	/** Handler for extension-registered shortcuts. Returns true if handled. */
	public onExtensionShortcut?: (data: string) => boolean;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options?: EditorOptions) {
		super(tui, theme, options);
		this.keybindings = keybindings;
	}

	setComposerFooterHint(getter: () => string): void {
		this.footerHintGetter = getter;
	}

	/**
	 * Register a handler for an app action.
	 */
	onAction(action: AppKeybinding, handler: () => void): void {
		this.actionHandlers.set(action, handler);
	}

	collectMouseRegions(ctx: MouseCollectContext): HitRegion[] {
		if (ctx.lineCount === 0) return [];

		const regions: HitRegion[] = [];
		const editorLineEnd = ctx.startLine + (this.isShowingAutocomplete() ? this.lastAutocompleteStartLine : ctx.lineCount);
		if (editorLineEnd > ctx.startLine) {
			regions.push({
				id: "editor:input",
				contentLineStart: ctx.startLine,
				contentLineEnd: editorLineEnd,
				target: this,
			});
		}

		if (this.isShowingAutocomplete()) {
			const width = this.lastRenderWidth || ctx.width;
			const dropdownStart = this.lastAutocompleteStartLine;
			regions.push(
				...this.collectAutocompleteMouseRegions(width).map((region) => ({
					...region,
					contentLineStart: ctx.startLine + dropdownStart + region.contentLineStart,
					contentLineEnd: ctx.startLine + dropdownStart + region.contentLineEnd,
				})),
			);
		}

		return regions;
	}

	render(width: number): string[] {
		this.lastRenderWidth = width;
		const autocompleteLines = this.getAutocompleteLines(width);
		const allLines = super.render(width);
		if (!this.footerHintGetter) {
			this.lastAutocompleteStartLine = allLines.length - autocompleteLines.length;
			return allLines;
		}

		const contentLines =
			autocompleteLines.length > 0 ? allLines.slice(0, allLines.length - autocompleteLines.length) : allLines;
		const boxed = this.wrapComposerBox(width, contentLines);
		this.lastAutocompleteStartLine = boxed.length;
		return [...boxed, ...autocompleteLines];
	}

	private wrapComposerBox(width: number, contentLines: string[]): string[] {
		const rightHint = this.footerHintGetter?.() ?? "";
		const result: string[] = [composerBorderLine(width)];

		for (const line of contentLines) {
			result.push(composerBarLine(width, line));
		}

		if (rightHint || COMPOSER_SHORTCUT_HINT) {
			result.push(composerHintLine(width, COMPOSER_SHORTCUT_HINT, rightHint));
		}

		result.push(composerBorderLine(width));
		return result;
	}

	handleInput(data: string): void {
		// Check extension-registered shortcuts first
		if (this.onExtensionShortcut?.(data)) {
			return;
		}

		// Check for paste image keybinding
		if (this.keybindings.matches(data, "app.clipboard.pasteImage")) {
			this.onPasteImage?.();
			return;
		}

		// Escape/interrupt - only if autocomplete is NOT active
		if (this.keybindings.matches(data, "app.interrupt")) {
			if (!this.isShowingAutocomplete()) {
				const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
				if (handler) {
					handler();
					return;
				}
			}
			super.handleInput(data);
			return;
		}

		// Exit (Ctrl+D) - only when editor is empty
		if (this.keybindings.matches(data, "app.exit")) {
			if (this.getText().length === 0) {
				const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
				if (handler) handler();
				return;
			}
		}

		for (const [action, handler] of this.actionHandlers) {
			if (action !== "app.interrupt" && action !== "app.exit" && this.keybindings.matches(data, action)) {
				handler();
				return;
			}
		}

		super.handleInput(data);
	}
}
