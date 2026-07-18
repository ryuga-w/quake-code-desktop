/**
 * Quake Code memory store — layered persistent memory (user / project / local / session).
 *
 * Inspired by Claude Code auto-memory, Codex memories, and Cursor rules/memories split.
 * Markdown frontmatter entries in MEMORY.md per scope; SESSION.md for episodic notes.
 */

import {
	appendFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type MemoryScope = "user" | "project" | "local" | "session";

export type MemoryEntryType = "preference" | "fact" | "convention" | "feedback" | "reference" | "session";

export interface MemoryEntry {
	name: string;
	description: string;
	type: MemoryEntryType;
	scope: MemoryScope;
	content: string;
	created?: string;
	updated?: string;
}

export interface MemorySearchResult extends MemoryEntry {
	score: number;
}

const DEFAULT_AGENT = "default-agent";
const MEMORY_FILE = "MEMORY.md";
const SESSION_FILE = "SESSION.md";
const ACTIVITY_FILE = "ACTIVITY.md";
const ARCHIVE_DIR = "archive";

/** Claude Code-style injection caps */
export const MEMORY_INJECT_MAX_LINES = 200;
export const MEMORY_INJECT_MAX_BYTES = 25 * 1024;

const SCOPE_ORDER: MemoryScope[] = ["user", "project", "local", "session"];

export function isSafeMemoryName(name: string): boolean {
	if (!name || name.length > 128) return false;
	return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name);
}

const MANAGED_MEMORY_BASENAMES = new Set(["memory.md", "session.md", "activity.md"]);

/** True when path points at Quake layered memory storage (not arbitrary repo files). */
export function isManagedMemoryPath(filePath: string): boolean {
	const lower = filePath.replace(/\\/g, "/").toLowerCase();
	if (!lower.includes("agent-memory")) return false;
	const base = lower.split("/").pop() ?? "";
	if (MANAGED_MEMORY_BASENAMES.has(base)) return true;
	return lower.includes("/archive/");
}

export function inferMemoryScopeFromPath(filePath: string, cwd?: string): MemoryScope {
	const lower = filePath.replace(/\\/g, "/").toLowerCase();
	if (lower.includes("agent-memory-local")) return "local";
	if (lower.endsWith("/session.md")) return "session";
	const home = homedir().replace(/\\/g, "/").toLowerCase();
	const normalizedCwd = cwd?.replace(/\\/g, "/").toLowerCase();
	if (lower.startsWith(`${home}/.quake-code/agent-memory`)) {
		if (normalizedCwd && lower.startsWith(normalizedCwd)) return "project";
		return "user";
	}
	return "project";
}

export const MEMORY_USE_TOOLS_MESSAGE =
	"Managed memory files cannot be changed with read/edit/write. Use memory_remember to save, memory_recall to read/search, and memory_forget to delete.";

function isSymlink(filePath: string): boolean {
	try {
		return lstatSync(filePath).isSymbolicLink();
	} catch {
		return false;
	}
}

export function safeReadFile(filePath: string): string | undefined {
	if (!existsSync(filePath)) return undefined;
	if (isSymlink(filePath)) return undefined;
	try {
		return readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}
}

export function resolveMemoryDir(agentName: string, scope: MemoryScope, cwd: string): string {
	if (!isSafeMemoryName(agentName)) {
		throw new Error(`Unsafe agent name: "${agentName}"`);
	}
	switch (scope) {
		case "user":
			return join(homedir(), ".quake-code", "agent-memory", agentName);
		case "project":
			return join(cwd, ".quake-code", "agent-memory", agentName);
		case "local":
			return join(cwd, ".quake-code", "agent-memory-local", agentName);
		case "session":
			return join(cwd, ".quake-code", "agent-memory", agentName);
	}
}

function memoryFileForScope(scope: MemoryScope): string {
	return scope === "session" ? SESSION_FILE : MEMORY_FILE;
}

export function ensureMemoryDir(agentName: string, scope: MemoryScope, cwd: string): string {
	const dir = resolveMemoryDir(agentName, scope, cwd);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

/** Parse frontmatter-delimited entries from a memory file. */
export function parseMemoryFile(content: string, defaultScope: MemoryScope): MemoryEntry[] {
	const entries: MemoryEntry[] = [];
	const lines = content.split("\n");
	let inFrontmatter = false;
	let inBody = false;
	let meta: Record<string, string> = {};
	let bodyLines: string[] = [];

	const flush = () => {
		if (!meta.name) {
			meta = {};
			bodyLines = [];
			inBody = false;
			return;
		}
		entries.push({
			name: meta.name,
			description: meta.description || "",
			type: (meta.type as MemoryEntryType) || "fact",
			scope: (meta.scope as MemoryScope) || defaultScope,
			content: bodyLines.join("\n").trim(),
			created: meta.created,
			updated: meta.updated,
		});
		meta = {};
		bodyLines = [];
		inBody = false;
	};

	for (const line of lines) {
		if (line.trim() === "---") {
			if (!inFrontmatter && !inBody) {
				inFrontmatter = true;
				continue;
			}
			if (inFrontmatter) {
				inFrontmatter = false;
				inBody = true;
				continue;
			}
			if (inBody) {
				flush();
				inFrontmatter = true;
				continue;
			}
		}
		if (inFrontmatter) {
			const m = line.match(/^([\w-]+):\s*(.*)$/);
			if (m) meta[m[1]!] = m[2]!.trim();
		} else if (inBody) {
			bodyLines.push(line);
		}
	}
	if (inBody) flush();

	return entries;
}

function serializeEntry(entry: MemoryEntry): string {
	const now = new Date().toISOString();
	const lines = [
		"---",
		`name: ${entry.name}`,
		`description: ${entry.description}`,
		`type: ${entry.type}`,
		`scope: ${entry.scope}`,
		`created: ${entry.created || now}`,
		`updated: ${entry.updated || now}`,
		"---",
		entry.content.trim(),
		"",
	];
	return lines.join("\n");
}

export function readScopeEntries(agentName: string, scope: MemoryScope, cwd: string): MemoryEntry[] {
	const dir = resolveMemoryDir(agentName, scope, cwd);
	const file = join(dir, memoryFileForScope(scope));
	const content = safeReadFile(file);
	if (!content) return [];
	return parseMemoryFile(content, scope);
}

export function readAllEntries(agentName: string, cwd: string, scopes: MemoryScope[] = SCOPE_ORDER): MemoryEntry[] {
	const merged = new Map<string, MemoryEntry>();
	for (const scope of scopes) {
		for (const entry of readScopeEntries(agentName, scope, cwd)) {
			const key = `${entry.scope}:${entry.name}`;
			merged.set(key, entry);
		}
	}
	return Array.from(merged.values());
}

export function listEntries(
	agentName: string,
	cwd: string,
	opts?: { scope?: MemoryScope; limit?: number },
): MemoryEntry[] {
	let entries = readAllEntries(agentName, cwd);
	if (opts?.scope) {
		entries = entries.filter((e) => e.scope === opts.scope);
	}
	entries.sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
	const limit = opts?.limit ?? 100;
	return entries.slice(0, limit);
}

export function getEntry(agentName: string, cwd: string, name: string, scope?: MemoryScope): MemoryEntry | undefined {
	if (scope) {
		return readScopeEntries(agentName, scope, cwd).find((e) => e.name === name);
	}
	return readAllEntries(agentName, cwd).find((e) => e.name === name);
}

export function rememberEntry(
	agentName: string,
	cwd: string,
	entry: Omit<MemoryEntry, "created" | "updated"> & { overwrite?: boolean },
): { created: boolean; scope: MemoryScope } {
	if (!isSafeMemoryName(entry.name)) {
		throw new Error(`Invalid memory name: "${entry.name}"`);
	}

	const scope = entry.scope;
	ensureMemoryDir(agentName, scope, cwd);
	const file = join(resolveMemoryDir(agentName, scope, cwd), memoryFileForScope(scope));

	const existing = readScopeEntries(agentName, scope, cwd);
	const found = existing.find((e) => e.name === entry.name);

	if (found && !entry.overwrite) {
		throw new Error(`Memory entry "${entry.name}" already exists in ${scope} scope. Use overwrite=true.`);
	}

	const now = new Date().toISOString();
	const full: MemoryEntry = {
		...entry,
		created: found?.created || now,
		updated: now,
	};

	const entries = existing.filter((e) => e.name !== entry.name);
	entries.push(full);

	const body = entries.map(serializeEntry).join("\n");
	writeFileSync(file, body, "utf-8");
	logActivity(agentName, scope, cwd, `${found ? "updated" : "created"} memory "${entry.name}"`);

	return { created: !found, scope };
}

export function forgetEntry(agentName: string, cwd: string, name: string, scope?: MemoryScope): boolean {
	const scopes = scope ? [scope] : SCOPE_ORDER;
	for (const s of scopes) {
		const entries = readScopeEntries(agentName, s, cwd);
		const idx = entries.findIndex((e) => e.name === name);
		if (idx === -1) continue;

		entries.splice(idx, 1);
		const file = join(resolveMemoryDir(agentName, s, cwd), memoryFileForScope(s));
		writeFileSync(file, entries.map(serializeEntry).join("\n"), "utf-8");
		logActivity(agentName, s, cwd, `deleted memory "${name}"`);
		return true;
	}
	return false;
}

export function searchEntries(agentName: string, cwd: string, query: string, limit = 10): MemorySearchResult[] {
	const q = query.toLowerCase().trim();
	if (!q) return [];

	const results: MemorySearchResult[] = [];
	for (const entry of readAllEntries(agentName, cwd)) {
		const haystack = `${entry.name} ${entry.description} ${entry.content} ${entry.type} ${entry.scope}`.toLowerCase();
		if (!haystack.includes(q)) continue;

		let score = 0;
		if (entry.name.toLowerCase().includes(q)) score += 10;
		if (entry.description.toLowerCase().includes(q)) score += 5;
		if (entry.content.toLowerCase().includes(q)) score += 1;
		results.push({ ...entry, score });
	}

	return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function logActivity(agentName: string, scope: MemoryScope, cwd: string, message: string): void {
	const dir = ensureMemoryDir(agentName, scope, cwd);
	const file = join(dir, ACTIVITY_FILE);
	const line = `- ${new Date().toISOString()}: ${message}\n`;
	appendFileSync(file, line, "utf-8");
}

export interface MemoryStatus {
	scopes: Array<{
		scope: MemoryScope;
		entryCount: number;
		bytes: number;
		needsConsolidation: boolean;
		path: string;
	}>;
	totalEntries: number;
	lastActivity: string | null;
}

const CONSOLIDATION_LINE_THRESHOLD = 150;

export function getMemoryStatus(agentName: string, cwd: string): MemoryStatus {
	const scopes: MemoryStatus["scopes"] = [];
	let totalEntries = 0;
	let lastActivity: string | null = null;

	for (const scope of SCOPE_ORDER) {
		const dir = resolveMemoryDir(agentName, scope, cwd);
		const file = join(dir, memoryFileForScope(scope));
		const content = safeReadFile(file);
		const entries = content ? parseMemoryFile(content, scope) : [];
		const bytes = content ? Buffer.byteLength(content, "utf-8") : 0;
		const lines = content ? content.split("\n").length : 0;

		if (entries.length > 0 || existsSync(dir)) {
			scopes.push({
				scope,
				entryCount: entries.length,
				bytes,
				needsConsolidation: lines > CONSOLIDATION_LINE_THRESHOLD,
				path: dir,
			});
			totalEntries += entries.length;
		}

		const activityFile = join(dir, ACTIVITY_FILE);
		const activity = safeReadFile(activityFile);
		if (activity) {
			const lastLine = activity
				.split("\n")
				.filter((l) => l.trim())
				.pop();
			const m = lastLine?.match(/^- (\S+)/);
			if (m && (!lastActivity || m[1]! > lastActivity)) {
				lastActivity = m[1]!;
			}
		}
	}

	return { scopes, totalEntries, lastActivity };
}

export function consolidateScope(
	agentName: string,
	scope: MemoryScope,
	cwd: string,
	summarizer?: (archived: string) => string,
): { consolidated: boolean; archivedCount: number } {
	const dir = resolveMemoryDir(agentName, scope, cwd);
	const file = join(dir, memoryFileForScope(scope));
	const content = safeReadFile(file);
	if (!content) return { consolidated: false, archivedCount: 0 };

	const lines = content.split("\n");
	if (lines.length <= CONSOLIDATION_LINE_THRESHOLD) {
		return { consolidated: false, archivedCount: 0 };
	}

	const entries = parseMemoryFile(content, scope);
	const keep = entries.slice(0, Math.min(20, entries.length));
	const archive = entries.slice(keep.length);

	const archiveDir = join(dir, ARCHIVE_DIR);
	if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const archivePath = join(archiveDir, `MEMORY-${timestamp}.md`);
	writeFileSync(archivePath, archive.map(serializeEntry).join("\n"), "utf-8");

	if (summarizer && archive.length > 0) {
		const summary = summarizer(archive.map((e) => `${e.name}: ${e.description}\n${e.content}`).join("\n\n"));
		keep.push({
			name: `archive-summary-${timestamp.slice(0, 10)}`,
			description: "Consolidated archive summary",
			type: "reference",
			scope,
			content: summary,
		});
	}

	writeFileSync(file, keep.map(serializeEntry).join("\n"), "utf-8");
	logActivity(agentName, scope, cwd, `consolidated ${archive.length} entries to archive`);

	return { consolidated: true, archivedCount: archive.length };
}

const MEMORY_RULES_HEADER = [
	"",
	"# Persistent Memory",
	"",
	"Layered memory (user → project → local → session).",
	"NEVER use read/edit/write on .quake-code/agent-memory/** or MEMORY.md — those paths are blocked.",
	"Always use memory_remember to save, memory_recall to search, memory_forget to delete.",
	"Treat repo files as source of truth; memory holds preferences and stable conventions only.",
	"",
] as const;

/** Build layered injection text for system prompt (user → project → local → session). */
export function buildMemoryInjectionBlock(agentName: string, cwd: string): string {
	const sections: string[] = [];
	let totalLines = 0;
	let totalBytes = 0;

	for (const scope of SCOPE_ORDER) {
		const entries = readScopeEntries(agentName, scope, cwd);
		if (entries.length === 0) continue;

		const header = `### ${scope} memory (${entries.length} entries)`;
		const body = entries.map((e) => `**${e.name}** (${e.type}): ${e.description}\n${e.content}`).join("\n\n");

		const chunk = `${header}\n${body}`;
		const chunkLines = chunk.split("\n").length;
		const chunkBytes = Buffer.byteLength(chunk, "utf-8");

		if (totalLines + chunkLines > MEMORY_INJECT_MAX_LINES || totalBytes + chunkBytes > MEMORY_INJECT_MAX_BYTES) {
			sections.push(`${header}\n(truncated — use memory_recall for full content)`);
			break;
		}

		sections.push(chunk);
		totalLines += chunkLines;
		totalBytes += chunkBytes;
	}

	if (sections.length === 0) {
		return [...MEMORY_RULES_HEADER, "(no entries yet — use memory_remember for stable preferences)", ""].join("\n");
	}

	return [...MEMORY_RULES_HEADER, ...sections, ""].join("\n");
}

export function clearScopeMemory(agentName: string, scope: MemoryScope, cwd: string): void {
	const dir = resolveMemoryDir(agentName, scope, cwd);
	const file = join(dir, memoryFileForScope(scope));
	if (existsSync(file)) {
		writeFileSync(file, "", "utf-8");
		logActivity(agentName, scope, cwd, "cleared all entries");
	}
}

export function clearAllMemory(agentName: string, cwd: string): void {
	for (const scope of SCOPE_ORDER) {
		clearScopeMemory(agentName, scope, cwd);
	}
}

export function getDefaultAgentName(): string {
	return DEFAULT_AGENT;
}

export function formatEntryForDisplay(entry: MemoryEntry): string {
	return [
		`${entry.scope}/${entry.name} (${entry.type})`,
		entry.description ? `  ${entry.description}` : "",
		entry.content.split("\n").slice(0, 3).join("\n"),
		entry.content.split("\n").length > 3 ? "  …" : "",
	]
		.filter(Boolean)
		.join("\n");
}
