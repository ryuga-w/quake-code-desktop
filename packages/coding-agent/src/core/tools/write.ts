import type { AgentTool } from "@mrquake/quakecode-agent-core";
import { Container, Text } from "@mrquake/quakecode-tui";
import { type Static, Type } from "@sinclair/typebox";
import { mkdir as fsMkdir, readFile as fsReadFile, writeFile as fsWriteFile } from "fs/promises";
import { dirname } from "path";
import { renderDiff, renderDiffPreview } from "../../modes/interactive/components/diff.js";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.js";
import { getLanguageFromPath, highlightCode } from "../../modes/interactive/theme/theme.js";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.js";
import { gateToolExecution } from "../guardian/tool-gate.js";
import { inferMemoryScopeFromPath, isManagedMemoryPath, MEMORY_USE_TOOLS_MESSAGE } from "../memory/memory-store.js";
import { turnDiffAggregator } from "../turn-diff/index.js";
import { generateDiffString } from "./edit-diff.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { formatManagedMemoryFileCall, formatManagedMemoryFileResult } from "./memory-render.js";
import { resolveToCwd } from "./path-utils.js";
import {
	formatToolMeta,
	getToolExecutionStatus,
	invalidArgText,
	joinToolSections,
	normalizeDisplayText,
	replaceTabs,
	shimmerText,
	shortenPath,
	str,
} from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";

const writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

export type WriteToolInput = Static<typeof writeSchema>;

/**
 * Pluggable operations for the write tool.
 * Override these to delegate file writing to remote systems (for example SSH).
 */
export interface WriteOperations {
	/** Write content to a file */
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	/** Create directory recursively */
	mkdir: (dir: string) => Promise<void>;
	/** Read existing file contents if available */
	readFile?: (absolutePath: string) => Promise<string | undefined>;
}

const defaultWriteOperations: WriteOperations = {
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
	mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
	readFile: async (path) => {
		try {
			return await fsReadFile(path, "utf-8");
		} catch (error: any) {
			if (error?.code === "ENOENT") {
				return undefined;
			}
			throw error;
		}
	},
};

export interface WriteToolOptions {
	/** Custom operations for file writing. Default: local filesystem */
	operations?: WriteOperations;
}

export interface WriteToolDetails {
	diff?: string;
	firstChangedLine?: number;
	/** Workspace-relative path (TurnFileChangesCard / turn diff) */
	path?: string;
	kind?: "create" | "modify";
}

type WriteHighlightCache = {
	rawPath: string | null;
	lang: string;
	rawContent: string;
	normalizedLines: string[];
	highlightedLines: string[];
};

class WriteCallRenderComponent extends Text {
	cache?: WriteHighlightCache;
	previewKey?: string;
	previewPending = false;
	previewDiff?: string;
	previewError?: string;

	constructor() {
		super("", 0, 0);
	}
}

const WRITE_PARTIAL_FULL_HIGHLIGHT_LINES = 50;

function highlightSingleLine(line: string, lang: string): string {
	const highlighted = highlightCode(line, lang);
	return highlighted[0] ?? "";
}

function refreshWriteHighlightPrefix(cache: WriteHighlightCache): void {
	const prefixCount = Math.min(WRITE_PARTIAL_FULL_HIGHLIGHT_LINES, cache.normalizedLines.length);
	if (prefixCount === 0) return;
	const prefixSource = cache.normalizedLines.slice(0, prefixCount).join("\n");
	const prefixHighlighted = highlightCode(prefixSource, cache.lang);
	for (let i = 0; i < prefixCount; i++) {
		cache.highlightedLines[i] =
			prefixHighlighted[i] ?? highlightSingleLine(cache.normalizedLines[i] ?? "", cache.lang);
	}
}

function rebuildWriteHighlightCacheFull(rawPath: string | null, fileContent: string): WriteHighlightCache | undefined {
	const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
	if (!lang) return undefined;
	const displayContent = normalizeDisplayText(fileContent);
	const normalized = replaceTabs(displayContent);
	return {
		rawPath,
		lang,
		rawContent: fileContent,
		normalizedLines: normalized.split("\n"),
		highlightedLines: highlightCode(normalized, lang),
	};
}

function updateWriteHighlightCacheIncremental(
	cache: WriteHighlightCache | undefined,
	rawPath: string | null,
	fileContent: string,
): WriteHighlightCache | undefined {
	const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
	if (!lang) return undefined;
	if (!cache) return rebuildWriteHighlightCacheFull(rawPath, fileContent);
	if (cache.lang !== lang || cache.rawPath !== rawPath) return rebuildWriteHighlightCacheFull(rawPath, fileContent);
	if (!fileContent.startsWith(cache.rawContent)) return rebuildWriteHighlightCacheFull(rawPath, fileContent);
	if (fileContent.length === cache.rawContent.length) return cache;

	const deltaRaw = fileContent.slice(cache.rawContent.length);
	const deltaDisplay = normalizeDisplayText(deltaRaw);
	const deltaNormalized = replaceTabs(deltaDisplay);
	cache.rawContent = fileContent;
	if (cache.normalizedLines.length === 0) {
		cache.normalizedLines.push("");
		cache.highlightedLines.push("");
	}

	const segments = deltaNormalized.split("\n");
	const lastIndex = cache.normalizedLines.length - 1;
	cache.normalizedLines[lastIndex] += segments[0];
	cache.highlightedLines[lastIndex] = highlightSingleLine(cache.normalizedLines[lastIndex], cache.lang);
	for (let i = 1; i < segments.length; i++) {
		cache.normalizedLines.push(segments[i]);
		cache.highlightedLines.push(highlightSingleLine(segments[i], cache.lang));
	}
	refreshWriteHighlightPrefix(cache);
	return cache;
}

function trimTrailingEmptyLines(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") {
		end--;
	}
	return lines.slice(0, end);
}

function hashText(text: string): string {
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		hash = (hash * 31 + text.charCodeAt(i)) | 0;
	}
	return `${text.length}:${hash}`;
}

function normalizeDiffInput(content: string): string {
	return content.replace(/\r\n/g, "\n");
}

async function computeWritePreview(
	path: string,
	content: string,
	cwd: string,
	ops: WriteOperations,
): Promise<{ diff: string; firstChangedLine?: number } | { error: string }> {
	try {
		const absolutePath = resolveToCwd(path, cwd);
		const previousContent = ops.readFile ? await ops.readFile(absolutePath) : undefined;
		return generateDiffString(normalizeDiffInput(previousContent ?? ""), normalizeDiffInput(content));
	} catch (error: unknown) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function maybeStartWritePreview(
	component: WriteCallRenderComponent,
	rawPath: string | null,
	fileContent: string | null,
	cwd: string,
	ops: WriteOperations,
	argsComplete: boolean,
	invalidate: () => void,
): void {
	if (!argsComplete || rawPath === null || !rawPath || fileContent === null) {
		component.previewKey = undefined;
		component.previewPending = false;
		component.previewDiff = undefined;
		component.previewError = undefined;
		return;
	}

	const previewKey = `${rawPath}:${hashText(fileContent)}`;
	if (component.previewKey === previewKey) {
		return;
	}

	component.previewKey = previewKey;
	component.previewPending = true;
	component.previewDiff = undefined;
	component.previewError = undefined;

	void computeWritePreview(rawPath, fileContent, cwd, ops)
		.then((result) => {
			if (component.previewKey !== previewKey) {
				return;
			}
			component.previewPending = false;
			if ("error" in result) {
				component.previewError = result.error;
				component.previewDiff = undefined;
			} else {
				component.previewDiff = result.diff;
				component.previewError = undefined;
			}
			invalidate();
		})
		.catch((error: unknown) => {
			if (component.previewKey !== previewKey) {
				return;
			}
			component.previewPending = false;
			component.previewDiff = undefined;
			component.previewError = error instanceof Error ? error.message : String(error);
			invalidate();
		});
}

function formatWriteCall(
	args: { path?: string; file_path?: string; content?: string } | undefined,
	options: ToolRenderResultOptions,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
	cache: WriteHighlightCache | undefined,
	status: ReturnType<typeof getToolExecutionStatus>,
	previewDiff?: string,
	previewPending?: boolean,
	previewError?: string,
): string {
	const rawPath = str(args?.file_path ?? args?.path);
	const fileContent = str(args?.content);
	if (rawPath && isManagedMemoryPath(rawPath)) {
		return formatManagedMemoryFileCall(
			"save",
			shortenPath(rawPath),
			theme,
			status,
			inferMemoryScopeFromPath(rawPath),
			options.expanded,
			fileContent ?? undefined,
		);
	}
	const path = rawPath !== null ? shortenPath(rawPath) : null;
	const invalidArg = invalidArgText(theme);
	const actionLabel =
		status === "running" || status === "streaming"
			? shimmerText(theme, "Writing", "muted", "accent")
			: theme.fg("muted", "Writing");
	const sections: string[] = [
		`${actionLabel} ${path === null ? invalidArg : path ? theme.fg("accent", path) : theme.fg("toolOutput", "file")}`,
		formatToolMeta(theme, "write", status),
	];

	if (previewDiff) {
		sections.push(
			options.expanded
				? renderDiff(previewDiff, { filePath: rawPath ?? undefined })
				: renderDiffPreview(previewDiff, 8, { filePath: rawPath ?? undefined }),
		);
		return joinToolSections(...sections);
	}

	if (previewError) {
		sections.push(theme.fg("error", previewError));
		return joinToolSections(...sections);
	}

	if (previewPending) {
		sections.push(theme.fg("muted", "Building diff preview..."));
		return joinToolSections(...sections);
	}

	sections.push(theme.fg("muted", "Creating or replacing file content"));

	if (fileContent === null) {
		sections.push(theme.fg("error", "[invalid content arg - expected string]"));
	} else if (fileContent && options.expanded) {
		const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
		const renderedLines = lang
			? (cache?.highlightedLines ?? highlightCode(replaceTabs(normalizeDisplayText(fileContent)), lang))
			: normalizeDisplayText(fileContent).split("\n");
		const lines = trimTrailingEmptyLines(renderedLines);
		const totalLines = lines.length;
		const maxLines = options.expanded ? lines.length : 10;
		const displayLines = lines.slice(0, maxLines);
		const remaining = lines.length - maxLines;
		let preview = displayLines.map((line) => (lang ? line : theme.fg("toolOutput", replaceTabs(line)))).join("\n");
		if (remaining > 0) {
			preview += `${theme.fg("muted", `\n... (${remaining} more lines, ${totalLines} total,`)} ${keyHint("app.tools.expand", "to expand")})`;
		}
		sections.push(preview);
	}

	return joinToolSections(...sections);
}

function formatWriteResult(
	args: { path?: string; file_path?: string; content?: string } | undefined,
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: WriteToolDetails;
		isError?: boolean;
	},
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
	expanded: boolean,
): string | undefined {
	const rawPath = str(args?.file_path ?? args?.path);
	const output = result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text || "")
		.join("\n");
	if (result.isError) {
		if (rawPath && isManagedMemoryPath(rawPath)) {
			return formatManagedMemoryFileResult("blocked", theme, "error", output || MEMORY_USE_TOOLS_MESSAGE);
		}
		if (!output) return theme.fg("error", "Write failed");
		return joinToolSections(theme.fg("error", "Write failed"), theme.fg("error", output));
	}
	const path = rawPath !== null ? shortenPath(rawPath) : null;
	const target = path ? ` ${theme.fg("accent", path)}` : "";
	if (!output) {
		return theme.fg("muted", `Wrote${target} successfully`);
	}
	if (result.details?.diff) {
		return expanded
			? joinToolSections(
					theme.fg("muted", `Wrote${target} successfully`),
					renderDiff(result.details.diff, { filePath: rawPath ?? undefined }),
				)
			: theme.fg("muted", `Wrote${target} successfully · diff hidden · ${keyHint("app.tools.expand", "expand")}`);
	}
	return expanded
		? joinToolSections(theme.fg("muted", `Wrote${target} successfully`), theme.fg("toolOutput", output))
		: theme.fg("muted", `Wrote${target} successfully · output hidden · ${keyHint("app.tools.expand", "expand")}`);
}

export function createWriteToolDefinition(
	cwd: string,
	options?: WriteToolOptions,
): ToolDefinition<typeof writeSchema, WriteToolDetails | undefined> {
	const ops = options?.operations ?? defaultWriteOperations;
	return {
		name: "write",
		label: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		promptSnippet: "Create or overwrite files",
		promptGuidelines: [
			"Use write only for new files or complete rewrites; prefer edit for surgical updates to existing files.",
			"When creating a new file, include the full intended content — do not leave placeholders the user must fill.",
			"Prefer workspace-relative paths when possible; avoid absolute paths unless required.",
			"Never write .quake-code/agent-memory/** or MEMORY.md — use memory_remember instead.",
		],
		parameters: writeSchema,
		async execute(
			_toolCallId,
			{ path, content }: { path: string; content: string },
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			const absolutePath = resolveToCwd(path, cwd);
			if (isManagedMemoryPath(absolutePath)) {
				return {
					content: [{ type: "text", text: MEMORY_USE_TOOLS_MESSAGE }],
					details: undefined,
					isError: true,
				} as any;
			}
			const gate = await gateToolExecution({
				tool: "write",
				summary: `write ${path}`,
				cwd,
				path: absolutePath,
				risk: "medium",
				details: { path },
			});
			if (!gate.allow) {
				return {
					content: [{ type: "text", text: `write denied (${gate.decision}): ${gate.reason}` }],
					details: undefined,
					isError: true,
				} as any;
			}
			const dir = dirname(absolutePath);
			return withFileMutationQueue(
				absolutePath,
				() =>
					new Promise<{ content: Array<{ type: "text"; text: string }>; details: WriteToolDetails | undefined }>(
						(resolve, reject) => {
							if (signal?.aborted) {
								reject(new Error("Operation aborted"));
								return;
							}
							let aborted = false;
							const onAbort = () => {
								aborted = true;
								reject(new Error("Operation aborted"));
							};
							signal?.addEventListener("abort", onAbort, { once: true });
							(async () => {
								try {
									// Create parent directories if needed.
									await ops.mkdir(dir);
									if (aborted) return;
									const previousContent = ops.readFile ? await ops.readFile(absolutePath) : undefined;
									if (aborted) return;
									// Write the file contents.
									await ops.writeFile(absolutePath, content);
									if (aborted) return;
									signal?.removeEventListener("abort", onAbort);
									const normalizedPreviousContent = normalizeDiffInput(previousContent ?? "");
									const normalizedNewContent = normalizeDiffInput(content);
									const isCreate = previousContent == null || previousContent === "";
									const diffResult =
										normalizedPreviousContent === normalizedNewContent
											? undefined
											: generateDiffString(normalizedPreviousContent, normalizedNewContent);
									try {
										turnDiffAggregator.record({
											path,
											kind: isCreate ? "create" : "modify",
											diff: diffResult?.diff,
											content: isCreate ? content : undefined,
										});
									} catch {
										/* non-fatal */
									}
									resolve({
										content: [
											{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` },
										],
										details: diffResult
											? { ...diffResult, path, kind: isCreate ? "create" : "modify" }
											: { path, kind: isCreate ? "create" : "modify" },
									});
								} catch (error: any) {
									signal?.removeEventListener("abort", onAbort);
									if (!aborted) reject(error);
								}
							})();
						},
					),
			);
		},
		renderCall(args, theme, context) {
			const renderArgs = args as { path?: string; file_path?: string; content?: string } | undefined;
			const rawPath = str(renderArgs?.file_path ?? renderArgs?.path);
			const fileContent = str(renderArgs?.content);
			const component =
				(context.lastComponent as WriteCallRenderComponent | undefined) ?? new WriteCallRenderComponent();
			if (fileContent !== null) {
				component.cache = context.argsComplete
					? rebuildWriteHighlightCacheFull(rawPath, fileContent)
					: updateWriteHighlightCacheIncremental(component.cache, rawPath, fileContent);
			} else {
				component.cache = undefined;
			}
			const status = getToolExecutionStatus({
				executionStarted: context.executionStarted,
				isPartial: context.isPartial,
				isError: context.isError,
			});
			maybeStartWritePreview(
				component,
				rawPath,
				fileContent,
				context.cwd,
				ops,
				context.argsComplete,
				context.invalidate,
			);
			component.setText(
				formatWriteCall(
					renderArgs,
					{ expanded: context.expanded, isPartial: context.isPartial },
					theme,
					component.cache,
					status,
					component.previewDiff,
					component.previewPending,
					component.previewError,
				),
			);
			return component;
		},
		renderResult(result, options, theme, context) {
			const output = formatWriteResult(
				context.args,
				{ ...result, isError: context.isError },
				theme,
				options.expanded ?? context.expanded,
			);
			if (!output) {
				const component = (context.lastComponent as Container | undefined) ?? new Container();
				component.clear();
				return component;
			}
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(output);
			return text;
		},
	};
}

export function createWriteTool(cwd: string, options?: WriteToolOptions): AgentTool<typeof writeSchema> {
	return wrapToolDefinition(createWriteToolDefinition(cwd, options));
}

/** Default write tool using process.cwd() for backwards compatibility. */
export const writeToolDefinition = createWriteToolDefinition(process.cwd());
export const writeTool = createWriteTool(process.cwd());
