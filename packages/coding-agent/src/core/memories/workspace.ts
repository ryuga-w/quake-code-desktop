/**
 * Codex workspace.rs — baseline diff before Phase 2 (without requiring git).
 * We fingerprint memory artifacts; write phase2_workspace_diff.md for consolidation prompts.
 */

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const WORKSPACE_DIFF_FILENAME = "phase2_workspace_diff.md";
export const WORKSPACE_BASELINE_FILENAME = ".workspace_baseline.json";

export interface WorkspaceFileFingerprint {
	path: string;
	sha256: string;
	size: number;
}

export interface WorkspaceBaseline {
	files: WorkspaceFileFingerprint[];
	captured_at: string;
}

export interface WorkspaceDiff {
	has_changes: boolean;
	added: string[];
	removed: string[];
	modified: string[];
}

function shouldSkip(name: string): boolean {
	return (
		name.startsWith(".") ||
		name === WORKSPACE_DIFF_FILENAME ||
		name === "stage1" ||
		name === ".jobs.json"
	);
}

function walkFiles(root: string, rel = ""): string[] {
	const dir = rel ? join(root, rel) : root;
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		if (shouldSkip(name) && !rel) continue;
		if (name.startsWith(".") && name !== "MEMORY.md") continue;
		const full = join(dir, name);
		const relPath = rel ? `${rel}/${name}` : name;
		try {
			const st = statSync(full);
			if (st.isDirectory()) out.push(...walkFiles(root, relPath.replace(/\\/g, "/")));
			else if (st.isFile()) out.push(relPath.replace(/\\/g, "/"));
		} catch {
			/* skip */
		}
	}
	return out;
}

export function fingerprintMemoryWorkspace(root: string): WorkspaceBaseline {
	const files: WorkspaceFileFingerprint[] = [];
	for (const path of walkFiles(root).sort()) {
		try {
			const buf = readFileSync(join(root, path));
			files.push({
				path,
				sha256: createHash("sha256").update(buf).digest("hex"),
				size: buf.length,
			});
		} catch {
			/* skip */
		}
	}
	return { files, captured_at: new Date().toISOString() };
}

export function loadWorkspaceBaseline(root: string): WorkspaceBaseline | undefined {
	const p = join(root, WORKSPACE_BASELINE_FILENAME);
	if (!existsSync(p)) return undefined;
	try {
		return JSON.parse(readFileSync(p, "utf-8")) as WorkspaceBaseline;
	} catch {
		return undefined;
	}
}

export function saveWorkspaceBaseline(root: string, baseline = fingerprintMemoryWorkspace(root)): void {
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, WORKSPACE_BASELINE_FILENAME), JSON.stringify(baseline, null, 2), "utf-8");
}

export function diffAgainstBaseline(root: string, baseline?: WorkspaceBaseline): WorkspaceDiff {
	const base = baseline ?? loadWorkspaceBaseline(root);
	const current = fingerprintMemoryWorkspace(root);
	if (!base) {
		return {
			has_changes: current.files.length > 0,
			added: current.files.map((f) => f.path),
			removed: [],
			modified: [],
		};
	}
	const prev = new Map(base.files.map((f) => [f.path, f]));
	const next = new Map(current.files.map((f) => [f.path, f]));
	const added: string[] = [];
	const removed: string[] = [];
	const modified: string[] = [];
	for (const [path, f] of next) {
		const p = prev.get(path);
		if (!p) added.push(path);
		else if (p.sha256 !== f.sha256) modified.push(path);
	}
	for (const path of prev.keys()) {
		if (!next.has(path)) removed.push(path);
	}
	return {
		has_changes: added.length + removed.length + modified.length > 0,
		added: added.sort(),
		removed: removed.sort(),
		modified: modified.sort(),
	};
}

export function renderWorkspaceDiffFile(diff: WorkspaceDiff): string {
	const lines = [
		"# Memory Workspace Diff",
		"",
		"Generated before Phase 2 memory consolidation. Read this file first and do not edit it.",
		"",
		"## Status",
	];
	if (!diff.has_changes) {
		lines.push("- none", "");
		return lines.join("\n");
	}
	lines.push("- has_changes");
	lines.push("", "## Added");
	for (const p of diff.added) lines.push(`- ${p}`);
	if (!diff.added.length) lines.push("- (none)");
	lines.push("", "## Removed");
	for (const p of diff.removed) lines.push(`- ${p}`);
	if (!diff.removed.length) lines.push("- (none)");
	lines.push("", "## Modified");
	for (const p of diff.modified) lines.push(`- ${p}`);
	if (!diff.modified.length) lines.push("- (none)");
	lines.push("");
	return lines.join("\n");
}

export function removeWorkspaceDiff(root: string): void {
	const p = join(root, WORKSPACE_DIFF_FILENAME);
	if (existsSync(p)) rmSync(p, { force: true });
}

export function writeWorkspaceDiff(root: string, diff: WorkspaceDiff): string {
	const path = join(root, WORKSPACE_DIFF_FILENAME);
	writeFileSync(path, renderWorkspaceDiffFile(diff), "utf-8");
	return path;
}

export function prepareMemoryWorkspace(root: string): WorkspaceDiff {
	mkdirSync(root, { recursive: true });
	removeWorkspaceDiff(root);
	const diff = diffAgainstBaseline(root);
	writeWorkspaceDiff(root, diff);
	return diff;
}

export function resetMemoryWorkspaceBaseline(root: string): void {
	removeWorkspaceDiff(root);
	saveWorkspaceBaseline(root);
}

export function validateConsolidationArtifacts(root: string): { ok: boolean; reason?: string } {
	const memoryPath = join(root, "MEMORY.md");
	const summaryPath = join(root, "memory_summary.md");
	if (!existsSync(memoryPath)) return { ok: false, reason: "MEMORY.md missing" };
	if (!existsSync(summaryPath)) return { ok: false, reason: "memory_summary.md missing" };
	try {
		const summary = readFileSync(summaryPath, "utf-8");
		if (summary.split(/\r?\n/)[0]?.trim() !== "v1") {
			return { ok: false, reason: "memory_summary.md must start with v1" };
		}
	} catch (err) {
		return { ok: false, reason: String(err) };
	}
	return { ok: true };
}
