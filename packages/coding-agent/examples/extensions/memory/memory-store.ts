/**
 * Memory Store - Persistent JSON file storage for memory entries.
 *
 * CRUD + indexing + full-text search.
 * Uses proper-lockfile for concurrent access safety (same pattern as auth.json).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	MEMORY_FILE_VERSION,
	type MemoryEntry,
	type MemoryIndexes,
	type MemoryQuery,
	type MemoryQueryResult,
	type MemoryStoreData,
	type MemoryStoreMetadata,
} from "./types.js";

// ============================================================================
// Helpers
// ============================================================================

let _cachedAgentDir: string | undefined;

function getAgentDir(): string {
	if (_cachedAgentDir) return _cachedAgentDir;
	const home = os.homedir();
	_cachedAgentDir = path.join(home, ".quake-code", "agent");
	return _cachedAgentDir;
}

function getMemoryPath(): string {
	return path.join(getAgentDir(), "memory.json");
}

function generateId(): string {
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function now(): string {
	return new Date().toISOString();
}

// ============================================================================
// Index Builder
// ============================================================================

function buildIndexes(entries: MemoryEntry[]): MemoryIndexes {
	const byKey: Record<string, string> = {};
	const byNamespace: Record<string, string[]> = {};
	const byTag: Record<string, string[]> = {};
	const byScope: Record<string, string[]> = {};
	const byType: Record<string, string[]> = {};

	for (const entry of entries) {
		byKey[entry.key] = entry.id;

		// namespace index
		if (!byNamespace[entry.namespace]) byNamespace[entry.namespace] = [];
		byNamespace[entry.namespace].push(entry.id);

		// scope index
		if (!byScope[entry.scope]) byScope[entry.scope] = [];
		byScope[entry.scope].push(entry.id);

		// type index
		if (!byType[entry.type]) byType[entry.type] = [];
		byType[entry.type].push(entry.id);

		// tag index
		for (const tag of entry.tags) {
			const lowerTag = tag.toLowerCase();
			if (!byTag[lowerTag]) byTag[lowerTag] = [];
			byTag[lowerTag].push(entry.id);
		}
	}

	return { byKey, byNamespace, byTag, byScope, byType };
}

// ============================================================================
// Text Search
// ============================================================================

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9çğıöşüäëïöüéèêàâùûç\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length > 1);
}

interface InMemoryEntry {
	tokens: string[];
	entry: MemoryEntry;
}

function buildTextSearchIndex(entries: MemoryEntry[]): InMemoryEntry[] {
	return entries.map((entry) => ({
		tokens: [
			...tokenize(entry.title),
			...tokenize(entry.content),
			...tokenize(entry.summary || ""),
			...tokenize(entry.key),
			...entry.tags,
		],
		entry,
	}));
}

function scoreEntry(inMem: InMemoryEntry, queryTokens: string[]): number {
	let score = 0;
	for (const qt of queryTokens) {
		for (const et of inMem.tokens) {
			if (et === qt) score += 3;
			else if (et.startsWith(qt) || qt.startsWith(et)) score += 1;
			else if (et.includes(qt) || qt.includes(et)) score += 0.5;
		}
	}
	return score;
}

// ============================================================================
// MemoryStore Class
// ============================================================================

export class MemoryStore {
	private entries: MemoryEntry[] = [];
	private indexes: MemoryIndexes = {
		byKey: {},
		byNamespace: {},
		byTag: {},
		byScope: {},
		byType: {},
	};
	private textIndex: InMemoryEntry[] = [];
	private metadata: MemoryStoreMetadata = {
		lastExtractedAt: undefined,
		totalEntries: 0,
		sessionCount: 0,
	};
	private memoryPath: string;
	private dirty = false;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(memoryPath?: string) {
		this.memoryPath = memoryPath ?? getMemoryPath();
	}

	// =========================================================================
	// Load / Save
	// =========================================================================

	load(): void {
		try {
			if (!fs.existsSync(this.memoryPath)) {
				this.entries = [];
				this.rebuildIndexes();
				return;
			}

			const raw = fs.readFileSync(this.memoryPath, "utf-8");
			const data: MemoryStoreData = JSON.parse(raw);

			// Migration: handle older versions
			if (data.version && data.version < MEMORY_FILE_VERSION) {
				this.migrate(data);
			}

			// Validate & clean entries
			const valid: MemoryEntry[] = [];
			let skipped = 0;
			for (const entry of data.entries ?? []) {
				if (this.validateEntry(entry)) {
					valid.push(entry);
				} else {
					skipped++;
				}
			}

			if (skipped > 0) {
				console.warn(`[memory] Skipped ${skipped} invalid entries on load`);
			}

			this.entries = valid;
			this.metadata = data.metadata ?? {
				lastExtractedAt: undefined,
				totalEntries: 0,
				sessionCount: 0,
			};
			this.rebuildIndexes();

			// Re-save if migration happened or entries were cleaned
			if (data.version !== MEMORY_FILE_VERSION || skipped > 0) {
				data.version = MEMORY_FILE_VERSION;
				this.markDirty();
			}
		} catch (err) {
			console.error(`[memory] Failed to load memory store: ${err}`);

			// Backup corrupted file before resetting
			try {
				const backupPath = this.memoryPath + ".corrupted." + Date.now() + ".bak";
				fs.copyFileSync(this.memoryPath, backupPath);
				console.warn(`[memory] Backed up corrupted file to ${backupPath}`);
			} catch {}

			this.entries = [];
			this.rebuildIndexes();
		}
	}

	/** Validate a single entry has all required fields */
	private validateEntry(entry: any): entry is MemoryEntry {
		if (!entry || typeof entry !== "object") return false;
		if (typeof entry.id !== "string" || !entry.id) return false;
		if (typeof entry.key !== "string" || !entry.key) return false;
		if (typeof entry.title !== "string") return false;
		if (typeof entry.content !== "string") return false;
		if (typeof entry.type !== "string") return false;
		if (typeof entry.namespace !== "string") return false;
		if (typeof entry.scope !== "string") entry.scope = "project"; // fix missing
		if (typeof entry.confidence !== "number") entry.confidence = 0.5;
		if (typeof entry.createdAt !== "string") entry.createdAt = new Date().toISOString();
		if (typeof entry.updatedAt !== "string") entry.updatedAt = entry.createdAt;
		if (!Array.isArray(entry.tags)) entry.tags = [];
		if (typeof entry.summary !== "string") entry.summary = entry.content.slice(0, 120);
		return true;
	}

	/** Migrate data from older versions */
	private migrate(data: MemoryStoreData): void {
		const fromVersion = data.version ?? 0;

		// v0 → v1: Add 'summary' field if missing
		if (fromVersion < 1) {
			for (const entry of data.entries ?? []) {
				if (!entry.summary && entry.content) {
					entry.summary = entry.content.slice(0, 120);
				}
			}
			console.log(`[memory] Migrated ${data.entries?.length ?? 0} entries from v0 to v1`);
		}

		// v1 → v2: Add 'relatedKeys' if missing
		if (fromVersion < 2) {
			for (const entry of data.entries ?? []) {
				if (!entry.relatedKeys) {
					entry.relatedKeys = [];
				}
			}
			console.log(`[memory] Migrated from v${fromVersion} to v2`);
		}

		data.version = MEMORY_FILE_VERSION;
	}

	save(): void {
		if (!this.dirty) return;

		try {
			const dir = path.dirname(this.memoryPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
			}

			this.metadata.totalEntries = this.entries.length;

			const data: MemoryStoreData = {
				version: MEMORY_FILE_VERSION,
				entries: this.entries,
				indexes: this.indexes,
				metadata: this.metadata,
			};

			fs.writeFileSync(this.memoryPath, JSON.stringify(data, null, 2), "utf-8");
			if (fs.chmodSync) {
				try {
					fs.chmodSync(this.memoryPath, 0o600);
				} catch {}
			}
			this.dirty = false;
		} catch (err) {
			console.error(`[memory] Failed to save memory store: ${err}`);
		}
	}

	private markDirty(): void {
		this.dirty = true;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => this.save(), 500);
	}

	private rebuildIndexes(): void {
		this.indexes = buildIndexes(this.entries);
		this.textIndex = buildTextSearchIndex(this.entries);
	}

	// =========================================================================
	// CRUD
	// =========================================================================

	getEntryById(id: string): MemoryEntry | undefined {
		return this.entries.find((e) => e.id === id);
	}

	getEntryByKey(key: string): MemoryEntry | undefined {
		const id = this.indexes.byKey[key];
		if (!id) return undefined;
		return this.getEntryById(id);
	}

	getAllEntries(): MemoryEntry[] {
		return [...this.entries];
	}

	addEntry(entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">): MemoryEntry {
		// Check if key already exists → update instead
		const existing = this.getEntryByKey(entry.key);
		if (existing) {
			return this.updateEntry(existing.id, entry);
		}

		const newEntry: MemoryEntry = {
			...entry,
			id: generateId(),
			createdAt: now(),
			updatedAt: now(),
			tags: entry.tags ?? [],
			confidence: entry.confidence ?? 1,
			sourceMessages: entry.sourceMessages ?? [],
			relatedKeys: entry.relatedKeys ?? [],
		};

		this.entries.push(newEntry);
		this.rebuildIndexes();
		this.markDirty();
		return newEntry;
	}

	updateEntry(id: string, updates: Partial<Omit<MemoryEntry, "id" | "createdAt">>): MemoryEntry {
		const idx = this.entries.findIndex((e) => e.id === id);
		if (idx === -1) {
			throw new Error(`Memory entry not found: ${id}`);
		}

		this.entries[idx] = {
			...this.entries[idx],
			...updates,
			id, // immutable
			createdAt: this.entries[idx].createdAt, // immutable
			updatedAt: now(),
		};

		this.rebuildIndexes();
		this.markDirty();
		return this.entries[idx];
	}

	deleteEntry(id: string): boolean {
		const idx = this.entries.findIndex((e) => e.id === id);
		if (idx === -1) return false;

		this.entries.splice(idx, 1);
		this.rebuildIndexes();
		this.markDirty();
		return true;
	}

	deleteEntryByKey(key: string): boolean {
		const entry = this.getEntryByKey(key);
		if (!entry) return false;
		return this.deleteEntry(entry.id);
	}

	// =========================================================================
	// Query / Search
	// =========================================================================

	query(q: MemoryQuery): MemoryQueryResult {
		let filtered = [...this.entries];
		const limit = q.limit ?? 20;
		const offset = q.offset ?? 0;

		// Filter by key
		if (q.key) {
			const entry = this.getEntryByKey(q.key);
			filtered = entry ? [entry] : [];
			return { entries: filtered.slice(offset, offset + limit), total: filtered.length, query: q };
		}

		// Filter by namespace
		if (q.namespace) {
			const ids = this.indexes.byNamespace[q.namespace] ?? [];
			filtered = filtered.filter((e) => ids.includes(e.id));
		}

		// Filter by scope
		if (q.scope) {
			const ids = this.indexes.byScope[q.scope] ?? [];
			filtered = filtered.filter((e) => ids.includes(e.id));
		}

		// Filter by type
		if (q.type) {
			const ids = this.indexes.byType[q.type] ?? [];
			filtered = filtered.filter((e) => ids.includes(e.id));
		}

		// Filter by tags
		if (q.tags && q.tags.length > 0) {
			filtered = filtered.filter((e) => q.tags!.some((t) => e.tags.includes(t)));
		}

		// Full-text search
		if (q.search) {
			const queryTokens = tokenize(q.search);
			if (queryTokens.length > 0) {
				const inMemItems = filtered.map((entry) => ({
					tokens: [
						...tokenize(entry.title),
						...tokenize(entry.content),
						...tokenize(entry.summary || ""),
						...tokenize(entry.key),
						...entry.tags,
					],
					entry,
				}));

				const scored = inMemItems
					.map((item) => ({ entry: item.entry, score: scoreEntry(item, queryTokens) }))
					.filter((item) => item.score > 0);

				scored.sort((a, b) => b.score - a.score);
				filtered = scored.map((s) => s.entry);
			}
		}

		// Sort by updatedAt (most recent first)
		filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

		const total = filtered.length;
		return {
			entries: filtered.slice(offset, offset + limit),
			total,
			query: q,
		};
	}

	search(query: string, opts?: { namespace?: string; limit?: number }): MemoryQueryResult {
		return this.query({
			search: query,
			namespace: opts?.namespace as any,
			limit: opts?.limit,
		});
	}

	/** Get all entries formatted as a compact string for context injection */
	getFormattedSummary(maxTokens: number): string {
		const lines: string[] = [];
		let estimatedTokens = 0;

		// Priortize by namespace: project > learnings > wip > user
		const priority: Record<string, number> = {
			project: 0,
			learnings: 1,
			wip: 2,
			user: 3,
			session: 4,
		};

		const sorted = [...this.entries].sort((a, b) => {
			const pa = priority[a.namespace] ?? 99;
			const pb = priority[b.namespace] ?? 99;
			if (pa !== pb) return pa - pb;
			return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
		});

		for (const entry of sorted) {
			const summary = entry.summary || entry.content.slice(0, 120);
			const line = `[${entry.namespace}/${entry.type}] ${entry.key}: ${summary}`;
			// Rough token estimate: ~4 chars per token
			const lineTokens = Math.ceil(line.length / 4) + 2;
			if (estimatedTokens + lineTokens > maxTokens) break;
			lines.push(line);
			estimatedTokens += lineTokens;
		}

		return lines.join("\n");
	}

	// =========================================================================
	// Metadata
	// =========================================================================

	getStats(): { total: number; byNamespace: Record<string, number>; byType: Record<string, number> } {
		const byNamespace: Record<string, number> = {};
		const byType: Record<string, number> = {};

		for (const entry of this.entries) {
			byNamespace[entry.namespace] = (byNamespace[entry.namespace] ?? 0) + 1;
			byType[entry.type] = (byType[entry.type] ?? 0) + 1;
		}

		return { total: this.entries.length, byNamespace, byType };
	}

	// =========================================================================
	// Import / Export
	// =========================================================================

	importEntries(entries: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">[]): number {
		let count = 0;
		for (const entry of entries) {
			try {
				this.addEntry(entry);
				count++;
			} catch {}
		}
		return count;
	}

	exportEntries(): MemoryEntry[] {
		return [...this.entries];
	}

	clear(): void {
		this.entries = [];
		this.rebuildIndexes();
		this.markDirty();
	}
}

// Singleton instance
let _instance: MemoryStore | null = null;

export function getMemoryStore(memoryPath?: string): MemoryStore {
	if (!_instance) {
		_instance = new MemoryStore(memoryPath);
		_instance.load();
	}
	return _instance;
}

export function resetMemoryStore(): void {
	if (_instance) {
		_instance.save();
		_instance = null;
	}
}
