/**
 * Codex apply_patch tool — multi-file patch in Begin/End Patch format.
 */

import type { AgentTool } from "@mrquake/quakecode-agent-core";
import { Text } from "@mrquake/quakecode-tui";
import { type Static, Type } from "@sinclair/typebox";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	applyPatchText,
	ApplyPatchError,
	isPathInsideRoot,
	resolveWorkspacePath,
} from "../apply-patch/apply.js";
import { ApplyPatchParseError } from "../apply-patch/parser.js";
import type { ToolDefinition } from "../extensions/types.js";
import { gateToolExecution, guardianRuntime } from "../guardian/index.js";
import { APPLY_PATCH_TOOL_INSTRUCTIONS } from "../prompts/codex-templates.js";
import { turnDiffAggregator } from "../turn-diff/index.js";
import { generateDiffString } from "./edit-diff.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";

const schema = Type.Object({
	patch: Type.String({
		description:
			'Codex apply_patch body: "*** Begin Patch" … "*** End Patch" with Add/Update/Delete File hunks.',
	}),
	workdir: Type.Optional(Type.String({ description: "Optional working directory (defaults to cwd)." })),
});

export type ApplyPatchToolInput = Static<typeof schema>;

export interface ApplyPatchFileStat {
	path: string;
	kind: "create" | "modify" | "delete";
	added: number;
	removed: number;
	previousPath?: string;
	diff?: string;
}

export interface ApplyPatchToolDetails {
	ok: boolean;
	added: string[];
	deleted: string[];
	updated: string[];
	moved: Array<{ from: string; to: string }>;
	/** Per-file +/- for TurnFileChangesCard (Codex FileChange summary) */
	files?: ApplyPatchFileStat[];
	/** Original apply_patch body for expandable history-cell diffs */
	diff?: string;
	error?: string;
}

/** Count real +/- lines from patch text (context " " lines excluded). */
function countPatchFileStats(patch: string): ApplyPatchFileStat[] {
	const files: ApplyPatchFileStat[] = [];
	let current: ApplyPatchFileStat | undefined;
	for (const raw of patch.replace(/\r\n/g, "\n").split("\n")) {
		const line = raw;
		const add = line.match(/^\*\*\*\s+Add File:\s*(.+?)\s*$/i);
		const del = line.match(/^\*\*\*\s+Delete File:\s*(.+?)\s*$/i);
		const upd = line.match(/^\*\*\*\s+Update File:\s*(.+?)\s*$/i);
		const move = line.match(/^\*\*\*\s+Move to:\s*(.+?)\s*$/i);
		if (add) {
			current = { path: add[1].trim(), kind: "create", added: 0, removed: 0 };
			files.push(current);
			continue;
		}
		if (del) {
			current = { path: del[1].trim(), kind: "delete", added: 0, removed: 0 };
			files.push(current);
			continue;
		}
		if (upd) {
			current = { path: upd[1].trim(), kind: "modify", added: 0, removed: 0 };
			files.push(current);
			continue;
		}
		if (move && current) {
			current.previousPath = current.path;
			current.path = move[1].trim();
			continue;
		}
		if (!current || line.startsWith("***") || line.startsWith("@@")) continue;
		if (line.startsWith("+")) current.added += 1;
		else if (line.startsWith("-")) current.removed += 1;
	}
	return files;
}

function createApplyPatchToolDefinition(cwd: string): ToolDefinition<typeof schema> {
	return {
		name: "apply_patch",
		label: "apply_patch",
		description: APPLY_PATCH_TOOL_INSTRUCTIONS,
		parameters: schema,
		promptSnippet: "apply_patch: multi-file Codex patch (*** Begin Patch)",
		promptGuidelines: [
			APPLY_PATCH_TOOL_INSTRUCTIONS,
			"Do not use apply_patch for binary files.",
			"After a successful apply_patch, do not re-read or paste the full file — the UI shows file-change counts.",
		],
		renderCall(args, theme) {
			const n = (args.patch || "").split("\n").filter((l) => l.startsWith("*** ")).length;
			return new Text(`${theme.bold("apply_patch")} ${theme.fg("dim", `${n} markers`)}`, 0, 0);
		},
		async execute(_id, params) {
			// Session workspace root (tool factory cwd). Never re-root guardian to a
			// caller-supplied workdir — that would bypass write-root policy.
			const sessionRoot = resolve(cwd);
			let applyCwd = sessionRoot;
			if (params.workdir?.trim()) {
				const requested = resolve(params.workdir.trim());
				if (!isPathInsideRoot(requested, sessionRoot)) {
					return {
						details: {
							ok: false,
							added: [],
							deleted: [],
							updated: [],
							moved: [],
							error: `file change denied (forbidden): workdir escapes workspace: ${params.workdir}`,
						},
						content: [
							{
								type: "text",
								text: `apply_patch denied: workdir escapes workspace: ${params.workdir}`,
							},
						],
					};
				}
				applyCwd = requested;
			}

			guardianRuntime.setWorkspaceRoot(sessionRoot);
			const filesPreview = countPatchFileStats(params.patch);

			// Hard sandbox write-root for every path (same gate as write/edit)
			for (const f of filesPreview) {
				let abs: string;
				try {
					abs = resolveWorkspacePath(applyCwd, f.path);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return {
						details: {
							ok: false,
							added: [],
							deleted: [],
							updated: [],
							moved: [],
							error: `file change denied (forbidden): ${msg}`,
						},
						content: [{ type: "text", text: `apply_patch denied: ${msg}` }],
					};
				}
				if (f.previousPath) {
					try {
						resolveWorkspacePath(applyCwd, f.previousPath);
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						return {
							details: {
								ok: false,
								added: [],
								deleted: [],
								updated: [],
								moved: [],
								error: `file change denied (forbidden): ${msg}`,
							},
							content: [{ type: "text", text: `apply_patch denied: ${msg}` }],
						};
					}
				}
				const pathGate = await gateToolExecution({
					tool: "apply_patch",
					summary: `apply_patch ${f.kind} ${f.path}`,
					cwd: sessionRoot,
					path: abs,
					risk: "high",
					details: { kind: "file_change", path: f.path },
				});
				if (!pathGate.allow) {
					return {
						details: {
							ok: false,
							added: [],
							deleted: [],
							updated: [],
							moved: [],
							error: `file change denied (${pathGate.decision}): ${pathGate.reason}`,
						},
						content: [
							{
								type: "text",
								text: `apply_patch denied (${pathGate.decision}): ${pathGate.reason}`,
							},
						],
					};
				}
			}

			// Codex FileChangeRequestApproval: prompt before apply unless Full Access
			const previewSummary =
				filesPreview.length === 0
					? `apply_patch (${(params.patch || "").split("\n").length} lines)`
					: filesPreview.length === 1
						? `File change: ${filesPreview[0].kind} ${filesPreview[0].path} (+${filesPreview[0].added} -${filesPreview[0].removed})`
						: `File change: ${filesPreview.length} files (${filesPreview.map((f) => f.path).slice(0, 6).join(", ")}${filesPreview.length > 6 ? "…" : ""})`;
			const fileGate = await guardianRuntime.requestApproval({
				tool: "apply_patch",
				summary: previewSummary,
				reason: "Codex-style file change approval before applying patch",
				risk: "high",
				needsPrompt: guardianRuntime.getPreset().id !== "full-access",
				details: {
					kind: "file_change",
					files: filesPreview,
					patchPreview: String(params.patch || "").slice(0, 4_000),
					workdir: applyCwd,
				},
			});
			if (!fileGate.allow) {
				return {
					details: {
						ok: false,
						added: [],
						deleted: [],
						updated: [],
						moved: [],
						error: `file change denied (${fileGate.decision}): ${fileGate.reason}`,
					},
					content: [{ type: "text", text: `apply_patch denied: ${fileGate.reason}` }],
				};
			}
			try {
				// Capture the exact pre-turn state before applying. The original
				// apply_patch text cannot restore a deleted file because Delete File
				// carries no body; an exact generated diff can.
				const beforeContents = new Map<string, string | undefined>();
				for (const file of filesPreview) {
					const sourcePath = file.previousPath || file.path;
					const source = resolveWorkspacePath(applyCwd, sourcePath);
					beforeContents.set(file.path, existsSync(source) ? readFileSync(source, "utf8") : undefined);
				}
				const result = applyPatchText(applyCwd, params.patch);
				const files = filesPreview.map((file) => {
					const target = resolveWorkspacePath(applyCwd, file.path);
					const after = existsSync(target) ? readFileSync(target, "utf8") : undefined;
					const before = beforeContents.get(file.path);
					return {
						...file,
						diff: generateDiffString(before ?? "", after ?? "").diff,
					};
				});
				// Record exact old/new diffs so the desktop can safely reverse the
				// complete turn, including deletions, after the tool has settled.
				try {
					turnDiffAggregator.recordApplyPatchDetails({ files, ...result });
				} catch {
					/* non-fatal */
				}
				const totalAdded = files.reduce((s, f) => s + f.added, 0);
				const totalRemoved = files.reduce((s, f) => s + f.removed, 0);
				const fileCount =
					result.added.length + result.updated.length + result.deleted.length + result.moved.length;
				// Codex create_diff_summary style: "Edited N files (+a -b)"
				const summary = [
					fileCount === 1
						? `1 file changed (+${totalAdded} -${totalRemoved})`
						: `${fileCount} files changed (+${totalAdded} -${totalRemoved})`,
					result.added.length ? `added: ${result.added.join(", ")}` : "",
					result.updated.length ? `updated: ${result.updated.join(", ")}` : "",
					result.deleted.length ? `deleted: ${result.deleted.join(", ")}` : "",
					result.moved.length
						? `moved: ${result.moved.map((m) => `${m.from}→${m.to}`).join(", ")}`
						: "",
				]
					.filter(Boolean)
					.join("\n");
				const details: ApplyPatchToolDetails = {
					ok: true,
					...result,
					files,
					// Keep patch text so history cells can expand line-by-line diffs
					diff: String(params.patch || "").slice(0, 80_000),
				};
				return {
					details,
					content: [{ type: "text", text: summary || "Patch applied (no file changes)." }],
				};
			} catch (err) {
				const message =
					err instanceof ApplyPatchParseError || err instanceof ApplyPatchError
						? err.message
						: err instanceof Error
							? err.message
							: String(err);
				const details: ApplyPatchToolDetails = {
					ok: false,
					added: [],
					deleted: [],
					updated: [],
					moved: [],
					error: message,
				};
				return {
					details,
					content: [{ type: "text", text: `apply_patch failed: ${message}` }],
				};
			}
		},
	};
}

export function createApplyPatchTool(cwd: string): AgentTool<any> {
	return wrapToolDefinition(createApplyPatchToolDefinition(cwd)) as AgentTool<any>;
}

export const applyPatchToolDefinition = createApplyPatchToolDefinition(process.cwd());
export const applyPatchTool = wrapToolDefinition(applyPatchToolDefinition) as AgentTool<any>;

export function createApplyPatchToolDefinitionForCwd(cwd: string): typeof applyPatchToolDefinition {
	return createApplyPatchToolDefinition(cwd);
}
