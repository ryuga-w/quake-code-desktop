/**
 * Memory Extension - Type definitions
 *
 * Quake Memory System: kalıcı, çoklu-oturum, branching-aware bellek.
 */

// ============================================================================
// Memory Entry Types
// ============================================================================

export type MemoryType = "fact" | "decision" | "preference" | "learning" | "task" | "pattern";
export type MemoryNamespace = "project" | "user" | "session" | "learnings" | "wip";
export type MemoryScope = "global" | "project" | "session";

export interface MemoryEntry {
	id: string;
	type: MemoryType;
	namespace: MemoryNamespace;
	scope: MemoryScope;
	key: string;
	title: string;
	content: string;
	summary: string;
	tags: string[];
	createdAt: string;
	updatedAt: string;
	sessionId?: string;
	turnIndex?: number;
	confidence: number;
	sourceMessages?: string[];
	relatedKeys?: string[];
}

// ============================================================================
// Storage Types
// ============================================================================

export interface MemoryStoreData {
	version: number;
	entries: MemoryEntry[];
	indexes: MemoryIndexes;
	metadata: MemoryStoreMetadata;
}

export interface MemoryIndexes {
	byKey: Record<string, string>;
	byNamespace: Record<string, string[]>;
	byTag: Record<string, string[]>;
	byScope: Record<string, string[]>;
	byType: Record<string, string[]>;
}

export interface MemoryStoreMetadata {
	lastExtractedAt?: string;
	totalEntries: number;
	sessionCount: number;
}

// ============================================================================
// Query Types
// ============================================================================

export interface MemoryQuery {
	key?: string;
	namespace?: MemoryNamespace;
	tags?: string[];
	type?: MemoryType;
	scope?: MemoryScope;
	search?: string;
	limit?: number;
	offset?: number;
}

export interface MemoryQueryResult {
	entries: MemoryEntry[];
	total: number;
	query: MemoryQuery;
}

// ============================================================================
// Tool Parameter Types
// ============================================================================

export interface RememberParams {
	key: string;
	title: string;
	content: string;
	summary?: string;
	type?: MemoryType;
	namespace?: MemoryNamespace;
	tags?: string[];
}

export interface RecallParams {
	query?: string;
	key?: string;
	namespace?: MemoryNamespace;
	tags?: string[];
	type?: MemoryType;
	limit?: number;
}

export interface ForgetParams {
	key: string;
}

export interface RememberMultiParams {
	entries: RememberParams[];
}

// ============================================================================
// Config
// ============================================================================

export interface MemoryConfig {
	enabled: boolean;
	autoExtract: boolean;
	maxInjectTokens: number;
	maxDisplayEntries: number;
	namespaces: {
		project: { enabled: boolean; maxEntries: number };
		learnings: { enabled: boolean; maxEntries: number };
		user: { enabled: boolean; maxEntries: number };
		session: { enabled: boolean; maxEntries: number };
		wip: { enabled: boolean; maxEntries: number };
	};
	compaction: {
		preserveMemories: boolean;
		extractOnCompact: boolean;
	};
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
	enabled: true,
	autoExtract: true,
	maxInjectTokens: 2048,
	maxDisplayEntries: 10,
	namespaces: {
		project: { enabled: true, maxEntries: 100 },
		learnings: { enabled: true, maxEntries: 200 },
		user: { enabled: true, maxEntries: 50 },
		session: { enabled: true, maxEntries: 20 },
		wip: { enabled: true, maxEntries: 10 },
	},
	compaction: {
		preserveMemories: true,
		extractOnCompact: true,
	},
};

export const MEMORY_FILE_VERSION = 1;
