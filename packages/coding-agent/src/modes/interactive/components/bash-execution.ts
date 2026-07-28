/**
 * Component for displaying bash command execution with streaming output.
 */

import { Container, Loader, Spacer, Text, type TUI } from "@mrquake/quakecode-tui";
import stripAnsi from "strip-ansi";
import { shimmerText } from "../../../core/tools/render-utils.js";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type TruncationResult,
	truncateTail,
} from "../../../core/tools/truncate.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { keyHint, keyText } from "./keybinding-hints.js";
import { truncateToVisualLines } from "./visual-truncate.js";

const PREVIEW_LINES = 20;

type BashIntentKind =
	| "inspect"
	| "search"
	| "list"
	| "read"
	| "build"
	| "test"
	| "git"
	| "script"
	| "write"
	| "generic";

type BashIntent = {
	title: string;
	subtitle?: string;
	prefersHeadPreview?: boolean;
	kind: BashIntentKind;
};

function normalizeCommand(command: string): string {
	return command.replace(/^!!\s*/, "").trim();
}

function extractFirstPath(command: string): string | undefined {
	const match = command.match(/(?:^|\s)(\.?\/?[\w./-]+)(?=\s|$)/);
	const value = match?.[1]?.trim();
	if (!value || value === "." || value === "./") return undefined;
	if (
		/^(find|fd|rg|grep|ls|pwd|git|npm|pnpm|yarn|bun|node|python|python3|bash|sh|sed|cat|head|tail|awk)$/i.test(value)
	) {
		return undefined;
	}
	return value.replace(/^\.\//, "");
}

function extractQuotedValue(command: string): string | undefined {
	const match = command.match(/(["'])(.*?)\1/);
	return match?.[2]?.trim() || undefined;
}

function inferBashIntent(command: string): BashIntent {
	const normalized = normalizeCommand(command);
	const lower = normalized.toLowerCase();
	const firstPath = extractFirstPath(normalized);
	const quoted = extractQuotedValue(normalized);

	if (/\b(pwd|ls|dir|tree)\b/.test(lower) || (lower.includes("find ") && lower.includes("-type d"))) {
		return {
			title: "Inspecting workspace structure",
			subtitle: firstPath ? `Scanning folders under ${firstPath}` : "Scanning folders and top-level project layout",
			prefersHeadPreview: true,
			kind: "inspect",
		};
	}

	if (
		/(^|\s)find\s/.test(lower) ||
		lower.includes("rg --files") ||
		/(^|\s)fd\s/.test(lower) ||
		lower.includes("-type f")
	) {
		return {
			title: firstPath ? `Scanning files under ${firstPath}` : "Scanning workspace files",
			subtitle: "Listing candidate files before narrowing scope",
			prefersHeadPreview: true,
			kind: "list",
		};
	}

	if (/\b(rg|grep|ag)\b/.test(lower)) {
		return {
			title: quoted ? `Searching for “${quoted}”` : "Searching workspace",
			subtitle: firstPath ? `Looking through ${firstPath}` : "Looking for matching content",
			prefersHeadPreview: true,
			kind: "search",
		};
	}

	if (/\b(cat|sed|head|tail|awk)\b/.test(lower)) {
		return {
			title: firstPath ? `Reading ${firstPath}` : "Reading file contents",
			subtitle: "Pulling in source details for the next step",
			prefersHeadPreview: true,
			kind: "read",
		};
	}

	if (/\bgit\s+(status|diff|log|show|branch)\b/.test(lower)) {
		return {
			title: "Checking git state",
			subtitle: "Reviewing repository history or changes",
			prefersHeadPreview: true,
			kind: "git",
		};
	}

	if (/\b(npm|pnpm|yarn|bun)\b.*\bbuild\b/.test(lower)) {
		return {
			title: "Running build",
			subtitle: "Validating the project compiles cleanly",
			kind: "build",
		};
	}

	if (/\b(npm|pnpm|yarn|bun)\b.*\b(test|vitest|jest)\b/.test(lower)) {
		return {
			title: "Running tests",
			subtitle: "Checking behavior against the test suite",
			kind: "test",
		};
	}

	if (/\b(node|python|python3|bash|sh|pwsh|powershell)\b/.test(lower)) {
		return {
			title: "Running script",
			subtitle: firstPath ? `Executing ${firstPath}` : "Executing a helper command",
			kind: "script",
		};
	}

	if (/\b(mkdir|cp|mv|rm|touch)\b/.test(lower)) {
		return {
			title: "Updating filesystem",
			subtitle: "Applying file or directory changes",
			kind: "write",
		};
	}

	return {
		title: "Running shell command",
		subtitle: normalized,
		kind: "generic",
	};
}

function summarizeBashOutput(
	intent: BashIntent,
	lines: string[],
	status: "running" | "complete" | "cancelled" | "error",
	exitCode?: number,
): string | undefined {
	const meaningful = lines.map((line) => line.trim()).filter(Boolean);
	if (status === "running") {
		if (meaningful.length === 0) return undefined;
		if (intent.kind === "search")
			return `Found ${meaningful.length} candidate match${meaningful.length === 1 ? "" : "es"} so far`;
		if (intent.kind === "list" || intent.kind === "inspect")
			return `Collected ${meaningful.length} path${meaningful.length === 1 ? "" : "s"} so far`;
		return `Streaming ${meaningful.length} line${meaningful.length === 1 ? "" : "s"} of output`;
	}
	if (status === "cancelled") return "Command was cancelled before completion";
	if (status === "error") return exitCode !== undefined ? `Command exited with code ${exitCode}` : "Command failed";
	if (meaningful.length === 0) return "Completed with no output";
	if (intent.kind === "search") return `Found ${meaningful.length} matching line${meaningful.length === 1 ? "" : "s"}`;
	if (intent.kind === "list" || intent.kind === "inspect")
		return `Found ${meaningful.length} path${meaningful.length === 1 ? "" : "s"}`;
	if (intent.kind === "read") return `Read ${meaningful.length} line${meaningful.length === 1 ? "" : "s"}`;
	if (intent.kind === "build") return exitCode ? `Build failed with exit ${exitCode}` : "Build completed successfully";
	if (intent.kind === "test") return exitCode ? `Tests failed with exit ${exitCode}` : "Tests completed successfully";
	if (intent.kind === "git") return `Collected ${meaningful.length} git line${meaningful.length === 1 ? "" : "s"}`;
	return `Produced ${meaningful.length} line${meaningful.length === 1 ? "" : "s"} of output`;
}

function pickPreviewLines(
	intent: BashIntent,
	lines: string[],
	expanded: boolean,
): { lines: string[]; hiddenLineCount: number } {
	if (expanded) {
		return { lines, hiddenLineCount: 0 };
	}
	const previewLines = intent.prefersHeadPreview ? lines.slice(0, PREVIEW_LINES) : lines.slice(-PREVIEW_LINES);
	return {
		lines: previewLines,
		hiddenLineCount: Math.max(0, lines.length - previewLines.length),
	};
}

function formatDuration(durationMs: number | undefined): string | undefined {
	if (durationMs === undefined) return undefined;
	if (durationMs < 1000) return `${durationMs}ms`;
	return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
}

export class BashExecutionComponent extends Container {
	private command: string;
	private readonly intent: BashIntent;
	private outputLines: string[] = [];
	private status: "running" | "complete" | "cancelled" | "error" = "running";
	private exitCode: number | undefined = undefined;
	private loader: Loader;
	private readonly ui: TUI;
	private readonly excludeFromContext: boolean;
	private truncationResult?: TruncationResult;
	private fullOutputPath?: string;
	private expanded = false;
	private contentContainer: Container;
	private readonly startedAt = Date.now();
	private completedAt?: number;

	constructor(command: string, ui: TUI, excludeFromContext = false) {
		super();
		this.command = command;
		this.intent = inferBashIntent(command);
		this.ui = ui;
		this.excludeFromContext = excludeFromContext;

		const colorKey = excludeFromContext ? "dim" : "bashMode";
		const borderColor = (str: string) => theme.fg(colorKey, str);

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder(borderColor));

		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		this.loader = this.createLoader();
		this.contentContainer.addChild(this.loader);

		this.addChild(new DynamicBorder(borderColor));
		this.updateDisplay();
	}

	private createLoader(): Loader {
		const colorKey = this.excludeFromContext ? "dim" : "bashMode";
		return new Loader(
			this.ui,
			(spinner) => theme.fg(colorKey, spinner),
			(text) => theme.fg("muted", text),
			`${this.intent.title}... (${keyText("tui.select.cancel")} to cancel)`,
		);
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		if (this.status === "running") {
			this.loader.stop();
			this.loader = this.createLoader();
		}
		this.updateDisplay();
	}

	appendOutput(chunk: string): void {
		const clean = stripAnsi(chunk).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		const newLines = clean.split("\n");
		if (this.outputLines.length > 0 && newLines.length > 0) {
			this.outputLines[this.outputLines.length - 1] += newLines[0];
			this.outputLines.push(...newLines.slice(1));
		} else {
			this.outputLines.push(...newLines);
		}
		this.updateDisplay();
	}

	setComplete(
		exitCode: number | undefined,
		cancelled: boolean,
		truncationResult?: TruncationResult,
		fullOutputPath?: string,
	): void {
		this.exitCode = exitCode;
		this.completedAt = Date.now();
		this.status = cancelled
			? "cancelled"
			: exitCode !== 0 && exitCode !== undefined && exitCode !== null
				? "error"
				: "complete";
		this.truncationResult = truncationResult;
		this.fullOutputPath = fullOutputPath;
		this.loader.stop();
		this.updateDisplay();
	}

	private updateDisplay(): void {
		const fullOutput = this.outputLines.join("\n");
		const contextTruncation = truncateTail(fullOutput, {
			maxLines: DEFAULT_MAX_LINES,
			maxBytes: DEFAULT_MAX_BYTES,
		});
		const availableLines = contextTruncation.content ? contextTruncation.content.split("\n") : [];
		const duration = formatDuration((this.completedAt ?? Date.now()) - this.startedAt);
		const summary = summarizeBashOutput(this.intent, availableLines, this.status, this.exitCode);
		const preview = pickPreviewLines(this.intent, availableLines, this.expanded);

		this.contentContainer.clear();
		this.contentContainer.addChild(new Text(theme.fg("toolTitle", theme.bold(this.intent.title)), 1, 0));

		const cmdPreview = this.command.length > 30 ? `${this.command.slice(0, 30)}...` : this.command;
		const metaParts = [`bash: ${cmdPreview}`];
		if (duration) metaParts.push(duration);
		const statusText =
			this.status === "running"
				? "executing"
				: this.status === "complete"
					? "done"
					: this.status === "cancelled"
						? "cancelled"
						: this.exitCode !== undefined
							? `exit ${this.exitCode}`
							: "failed";

		const baseMeta = metaParts.join(" · ");
		const metaLine =
			this.status === "running"
				? shimmerText(theme, `${baseMeta} · ${statusText}`)
				: theme.fg("dim", `${baseMeta} · ${statusText}`);

		this.contentContainer.addChild(new Text(metaLine, 1, 0));

		if (this.intent.subtitle) {
			this.contentContainer.addChild(new Text(theme.fg("muted", this.intent.subtitle), 1, 0));
		}
		if (summary) {
			this.contentContainer.addChild(new Text(theme.fg("muted", summary), 1, 0));
		}

		if (this.expanded) {
			this.contentContainer.addChild(new Text(theme.fg("dim", "Command"), 1, 0));
			this.contentContainer.addChild(new Text(theme.fg("bashMode", `$ ${this.command}`), 2, 0));
		}

		if (preview.lines.length > 0) {
			const styledOutput = preview.lines.map((line) => theme.fg("muted", line)).join("\n");
			const styledInput = `\n${styledOutput}`;
			let cachedWidth: number | undefined;
			let cachedLines: string[] | undefined;
			this.contentContainer.addChild({
				render: (width: number) => {
					if (cachedLines === undefined || cachedWidth !== width) {
						const limit = this.expanded ? Number.MAX_SAFE_INTEGER : PREVIEW_LINES;
						const result = truncateToVisualLines(styledInput, limit, width, 1);
						cachedLines = result.visualLines;
						cachedWidth = width;
					}
					return cachedLines ?? [];
				},
				invalidate: () => {
					cachedWidth = undefined;
					cachedLines = undefined;
				},
			});
		}

		if (this.status === "running") {
			this.loader.setMessage(`${this.intent.title}... (${keyText("tui.select.cancel")} to cancel)`);
			this.contentContainer.addChild(this.loader);
		} else {
			const statusParts: string[] = [];
			if (preview.hiddenLineCount > 0) {
				statusParts.push(
					this.expanded
						? `(${keyHint("app.tools.expand", "to collapse")})`
						: `${theme.fg("muted", `... ${preview.hiddenLineCount} more lines`)} (${keyHint("app.tools.expand", "to expand")})`,
				);
			}
			const wasTruncated = this.truncationResult?.truncated || contextTruncation.truncated;
			if (wasTruncated && this.fullOutputPath) {
				statusParts.push(theme.fg("warning", `Output truncated. Full output: ${this.fullOutputPath}`));
			}
			if (statusParts.length > 0) {
				this.contentContainer.addChild(new Text(`\n${statusParts.join("\n")}`, 1, 0));
			}
		}
	}

	getOutput(): string {
		return this.outputLines.join("\n");
	}

	getCommand(): string {
		return this.command;
	}
}
