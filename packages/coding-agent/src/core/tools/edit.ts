import type { AgentTool } from "@mrquake/quakecode-agent-core";
import { Container, Text } from "@mrquake/quakecode-tui";
import { type Static, Type } from "@sinclair/typebox";
import { constants } from "fs";
import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from "fs/promises";
import { renderDiff, renderDiffPreview } from "../../modes/interactive/components/diff.js";
import type { ToolDefinition } from "../extensions/types.js";
import { gateToolExecution } from "../guardian/tool-gate.js";
import { inferMemoryScopeFromPath, isManagedMemoryPath, MEMORY_USE_TOOLS_MESSAGE } from "../memory/memory-store.js";
import { turnDiffAggregator } from "../turn-diff/index.js";
import {
	applyEditsToNormalizedContent,
	computeEditsDiff,
	detectLineEnding,
	type Edit,
	generateDiffString,
	normalizeToLF,
	restoreLineEndings,
	stripBom,
} from "./edit-diff.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { formatManagedMemoryFileCall, formatManagedMemoryFileResult } from "./memory-render.js";
import { resolveToCwd } from "./path-utils.js";
import {
	getToolExecutionStatus,
	invalidArgText,
	joinToolSections,
	shimmerText,
	shortenPath,
	str,
} from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";

type EditRenderState = Record<string, never>;

class EditCallRenderComponent extends Text {
	previewKey?: string;
	previewPending = false;
	previewDiff?: string;
	previewError?: string;

	constructor() {
		super("", 0, 0);
	}
}

const replaceEditSchema = Type.Object(
	{
		oldText: Type.String({
			description:
				"Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
		}),
		newText: Type.String({ description: "Replacement text for this targeted edit." }),
	},
	{ additionalProperties: false },
);

const editSchema = Type.Object(
	{
		path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
		edits: Type.Array(replaceEditSchema, {
			description:
				"One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
		}),
	},
	{ additionalProperties: false },
);

export type EditToolInput = Static<typeof editSchema>;
type LegacyEditToolInput = EditToolInput & {
	oldText?: unknown;
	newText?: unknown;
};

export interface EditToolDetails {
	/** Unified diff of the changes made */
	diff: string;
	/** Line number of the first change in the new file (for editor navigation) */
	firstChangedLine?: number;
}

/**
 * Pluggable operations for the edit tool.
 * Override these to delegate file editing to remote systems (for example SSH).
 */
export interface EditOperations {
	/** Read file contents as a Buffer */
	readFile: (absolutePath: string) => Promise<Buffer>;
	/** Write content to a file */
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	/** Check if file is readable and writable (throw if not) */
	access: (absolutePath: string) => Promise<void>;
}

const defaultEditOperations: EditOperations = {
	readFile: (path) => fsReadFile(path),
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
	access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
};

export interface EditToolOptions {
	/** Custom operations for file editing. Default: local filesystem */
	operations?: EditOperations;
}

function prepareEditArguments(input: unknown): EditToolInput {
	if (!input || typeof input !== "object") {
		return input as EditToolInput;
	}

	const args = input as LegacyEditToolInput;
	if (typeof args.oldText !== "string" || typeof args.newText !== "string") {
		return input as EditToolInput;
	}

	const edits = Array.isArray(args.edits) ? [...args.edits] : [];
	edits.push({ oldText: args.oldText, newText: args.newText });
	const { oldText: _oldText, newText: _newText, ...rest } = args;
	return { ...rest, edits } as EditToolInput;
}

function validateEditInput(input: EditToolInput): { path: string; edits: Edit[] } {
	if (!Array.isArray(input.edits) || input.edits.length === 0) {
		throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
	}
	return { path: input.path, edits: input.edits };
}

type RenderableEditArgs = {
	path?: string;
	file_path?: string;
	edits?: Edit[];
	oldText?: string;
	newText?: string;
};

function hashText(text: string): string {
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		hash = (hash * 31 + text.charCodeAt(i)) | 0;
	}
	return `${text.length}:${hash}`;
}

function getRenderableEdits(args: RenderableEditArgs | undefined): Edit[] {
	const edits = Array.isArray(args?.edits) ? [...args.edits] : [];
	if (typeof args?.oldText === "string" && typeof args?.newText === "string") {
		edits.push({ oldText: args.oldText, newText: args.newText });
	}
	return edits.filter(
		(edit): edit is Edit =>
			typeof edit?.oldText === "string" &&
			typeof edit?.newText === "string" &&
			(edit.oldText.length > 0 || edit.newText.length > 0),
	);
}

function maybeStartEditPreview(
	component: EditCallRenderComponent,
	args: RenderableEditArgs | undefined,
	cwd: string,
	argsComplete: boolean,
	invalidate: () => void,
): void {
	const rawPath = str(args?.file_path ?? args?.path);
	const edits = getRenderableEdits(args);

	if (!argsComplete || rawPath === null || !rawPath || edits.length === 0) {
		component.previewKey = undefined;
		component.previewPending = false;
		component.previewDiff = undefined;
		component.previewError = undefined;
		return;
	}

	const previewKey = `${rawPath}:${hashText(JSON.stringify(edits))}`;
	if (component.previewKey === previewKey) {
		return;
	}

	component.previewKey = previewKey;
	component.previewPending = true;
	component.previewDiff = undefined;
	component.previewError = undefined;

	void computeEditsDiff(rawPath, edits, cwd)
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

function formatEditCall(
	args: RenderableEditArgs | undefined,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
	status: ReturnType<typeof getToolExecutionStatus>,
	expanded: boolean,
	previewDiff?: string,
	previewPending?: boolean,
	previewError?: string,
): string {
	const invalidArg = invalidArgText(theme);
	const rawPath = str(args?.file_path ?? args?.path);
	if (rawPath && isManagedMemoryPath(rawPath)) {
		const path = shortenPath(rawPath);
		const preview = getRenderableEdits(args)
			.map((edit) => edit.newText)
			.filter(Boolean)
			.join("\n");
		return formatManagedMemoryFileCall(
			"update",
			path,
			theme,
			status,
			inferMemoryScopeFromPath(rawPath),
			expanded,
			preview || undefined,
		);
	}
	const path = rawPath !== null ? shortenPath(rawPath) : null;
	const pathDisplay = path === null ? invalidArg : path ? theme.fg("accent", path) : theme.fg("toolOutput", "file");
	const editCount = getRenderableEdits(args).length;
	const actionLabel =
		status === "running" || status === "streaming"
			? shimmerText(theme, "Editing", "muted", "accent")
			: theme.fg("muted", "Editing");
	const sections = [`${actionLabel} ${pathDisplay}`];

	if (previewDiff && expanded) {
		sections.push(renderDiff(previewDiff, { filePath: rawPath ?? undefined }));
	} else if (previewDiff) {
		sections.push(renderDiffPreview(previewDiff, 8, { filePath: rawPath ?? undefined }));
	} else if (previewError) {
		sections.push(theme.fg("error", previewError));
	} else if (previewPending) {
		sections.push(theme.fg("muted", "Building diff preview..."));
	} else {
		sections.push(
			theme.fg(
				"muted",
				editCount > 0
					? `Preparing ${editCount} targeted replacement${editCount === 1 ? "" : "s"}`
					: "Preparing a targeted source change",
			),
		);
	}

	return joinToolSections(...sections);
}

function formatEditResult(
	args: RenderableEditArgs | undefined,
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: EditToolDetails;
	},
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
	isError: boolean,
	expanded: boolean,
): string | undefined {
	const rawPath = str(args?.file_path ?? args?.path);
	if (rawPath && isManagedMemoryPath(rawPath) && isError) {
		const errorText = result.content
			.filter((c) => c.type === "text")
			.map((c) => c.text || "")
			.join("\n");
		return formatManagedMemoryFileResult("blocked", theme, "error", errorText || MEMORY_USE_TOOLS_MESSAGE);
	}
	if (isError) {
		const errorText = result.content
			.filter((c) => c.type === "text")
			.map((c) => c.text || "")
			.join("\n");
		if (!errorText) {
			return undefined;
		}
		return joinToolSections(theme.fg("error", "Edit failed"), theme.fg("error", errorText));
	}

	const resultDiff = result.details?.diff;
	if (!resultDiff) {
		return theme.fg("muted", "Applied edit successfully");
	}
	if (!expanded) {
		return theme.fg("muted", "Applied edit successfully · diff hidden · expand to inspect");
	}
	return joinToolSections(
		theme.fg("muted", "Applied edit successfully"),
		renderDiff(resultDiff, { filePath: rawPath ?? undefined }),
	);
}

export function createEditToolDefinition(
	cwd: string,
	options?: EditToolOptions,
): ToolDefinition<typeof editSchema, EditToolDetails | undefined, EditRenderState> {
	const ops = options?.operations ?? defaultEditOperations;
	return {
		name: "edit",
		label: "edit",
		description:
			"Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
		promptSnippet:
			"Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
		promptGuidelines: [
			"Prefer apply_patch for multi-file or multi-hunk edits; use edit for a single precise replacement.",
			"Use edit for precise changes (edits[].oldText must match exactly).",
			"When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls.",
			"Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
			"Keep edits[].oldText as small as possible while still unique; ~3 lines of local context only when needed.",
			"Use write only for new files or complete rewrites; prefer edit for surgical updates.",
			"Prefer workspace-relative paths; avoid absolute paths unless required.",
			"After a successful edit, do not re-dump the whole file in chat — the UI shows file-change summary with +/-.",
			"Never edit .quake-code/agent-memory/** or MEMORY.md — use memory_remember instead.",
		],
		parameters: editSchema,
		prepareArguments: prepareEditArguments,
		async execute(_toolCallId, input: EditToolInput, signal?: AbortSignal, _onUpdate?, _ctx?) {
			const { path, edits } = validateEditInput(input);
			const absolutePath = resolveToCwd(path, cwd);
			if (isManagedMemoryPath(absolutePath)) {
				return {
					content: [{ type: "text", text: MEMORY_USE_TOOLS_MESSAGE }],
					details: undefined,
					isError: true,
				} as any;
			}

			const gate = await gateToolExecution({
				tool: "edit",
				summary: `edit ${path}`,
				cwd,
				path: absolutePath,
				risk: "medium",
				details: { path },
			});
			if (!gate.allow) {
				return {
					content: [{ type: "text", text: `edit denied (${gate.decision}): ${gate.reason}` }],
					details: undefined,
					isError: true,
				} as any;
			}

			return withFileMutationQueue(
				absolutePath,
				() =>
					new Promise<{
						content: Array<{ type: "text"; text: string }>;
						details: EditToolDetails | undefined;
					}>((resolve, reject) => {
						// Check if already aborted.
						if (signal?.aborted) {
							reject(new Error("Operation aborted"));
							return;
						}

						let aborted = false;

						// Set up abort handler.
						const onAbort = () => {
							aborted = true;
							reject(new Error("Operation aborted"));
						};

						if (signal) {
							signal.addEventListener("abort", onAbort, { once: true });
						}

						// Perform the edit operation.
						void (async () => {
							try {
								// Check if file exists.
								try {
									await ops.access(absolutePath);
								} catch {
									if (signal) {
										signal.removeEventListener("abort", onAbort);
									}
									reject(new Error(`File not found: ${path}`));
									return;
								}

								// Check if aborted before reading.
								if (aborted) {
									return;
								}

								// Read the file.
								const buffer = await ops.readFile(absolutePath);
								const rawContent = buffer.toString("utf-8");

								// Check if aborted after reading.
								if (aborted) {
									return;
								}

								// Strip BOM before matching. The model will not include an invisible BOM in oldText.
								const { bom, text: content } = stripBom(rawContent);
								const originalEnding = detectLineEnding(content);
								const normalizedContent = normalizeToLF(content);
								const { baseContent, newContent } = applyEditsToNormalizedContent(
									normalizedContent,
									edits,
									path,
								);

								// Check if aborted before writing.
								if (aborted) {
									return;
								}

								const finalContent = bom + restoreLineEndings(newContent, originalEnding);
								await ops.writeFile(absolutePath, finalContent);

								// Check if aborted after writing.
								if (aborted) {
									return;
								}

								// Clean up abort handler.
								if (signal) {
									signal.removeEventListener("abort", onAbort);
								}

								const diffResult = generateDiffString(baseContent, newContent);
								try {
									turnDiffAggregator.record({
										path,
										kind: "modify",
										diff: diffResult.diff,
									});
								} catch {
									/* non-fatal */
								}
								resolve({
									content: [
										{
											type: "text",
											text: `Successfully replaced ${edits.length} block(s) in ${path}.`,
										},
									],
									details: { diff: diffResult.diff, firstChangedLine: diffResult.firstChangedLine },
								});
							} catch (error: unknown) {
								// Clean up abort handler.
								if (signal) {
									signal.removeEventListener("abort", onAbort);
								}

								if (!aborted) {
									reject(error instanceof Error ? error : new Error(String(error)));
								}
							}
						})();
					}),
			);
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as EditCallRenderComponent | undefined) ?? new EditCallRenderComponent();
			const status = getToolExecutionStatus({
				executionStarted: context.executionStarted,
				isPartial: context.isPartial,
				isError: context.isError,
			});
			maybeStartEditPreview(text, args, context.cwd, context.argsComplete, context.invalidate);
			text.setText(
				formatEditCall(
					args,
					theme,
					status,
					context.expanded && context.isPartial,
					text.previewDiff,
					text.previewPending,
					text.previewError,
				),
			);
			return text;
		},
		renderResult(result, options, theme, context) {
			const output = formatEditResult(
				context.args,
				result as any,
				theme,
				context.isError,
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

export function createEditTool(cwd: string, options?: EditToolOptions): AgentTool<typeof editSchema> {
	return wrapToolDefinition(createEditToolDefinition(cwd, options));
}

/** Default edit tool using process.cwd() for backwards compatibility. */
export const editToolDefinition = createEditToolDefinition(process.cwd());
export const editTool = createEditTool(process.cwd());
