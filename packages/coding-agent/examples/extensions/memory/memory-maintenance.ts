/**
 * Memory Maintenance — Self-cleaning, dedup, expiry, linking.
 *
 * Üç temel işlev:
 * 1. DEDUP: Benzer anıları tespit et → birleştir
 * 2. EXPIRY: Düşük-confidence / eski anıları otomatik temizle
 * 3. LINKING: İlgili anılar arasında relatedKeys bağlantısı kur
 */

import type { MemoryStore } from "./memory-store.js";
import type { MemoryEntry, MemoryNamespace, MemoryType } from "./types.js";

// ============================================================================
// Config
// ============================================================================

export interface MaintenanceConfig {
	/** Max age in days for low-confidence entries (confidence < 0.5) */
	lowConfidenceMaxAgeDays: number;
	/** Max age in days for medium-confidence entries (confidence 0.5-0.8) */
	mediumConfidenceMaxAgeDays: number;
	/** Minimum similarity score (0-1) for dedup merge */
	dedupSimilarityThreshold: number;
	/** Max entries before triggering merge pass */
	mergeThreshold: number;
	/** Whether to auto-link related memories */
	autoLink: boolean;
	/** Whether to auto-forget expired entries */
	autoForget: boolean;
}

export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
	lowConfidenceMaxAgeDays: 7,
	mediumConfidenceMaxAgeDays: 30,
	dedupSimilarityThreshold: 0.7,
	mergeThreshold: 100,
	autoLink: true,
	autoForget: true,
};

// ============================================================================
// Text Similarity
// ============================================================================

/** Simple Jaccard similarity on token sets */
function tokenize(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.replace(/[^a-z0-9çğıöşü\s]/g, " ")
			.split(/\s+/)
			.filter((t) => t.length > 2),
	);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 1;
	let intersection = 0;
	for (const item of a) {
		if (b.has(item)) intersection++;
	}
	const union = a.size + b.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

// ============================================================================
// Memory Maintenance
// ============================================================================

export class MemoryMaintenance {
	private store: MemoryStore;
	private config: MaintenanceConfig;

	constructor(store: MemoryStore, config: Partial<MaintenanceConfig> = {}) {
		this.store = store;
		this.config = { ...DEFAULT_MAINTENANCE_CONFIG, ...config };
	}

	setConfig(partial: Partial<MaintenanceConfig>): void {
		this.config = { ...this.config, ...partial };
	}

	// =========================================================================
	// Run all maintenance tasks
	// =========================================================================

	runAll(): MaintenanceResult {
		const result: MaintenanceResult = {
			forgotten: 0,
			merged: 0,
			linked: 0,
			beforeTotal: this.store.getStats().total,
			afterTotal: 0,
			details: [],
		};

		// 1. Auto-forget expired entries
		if (this.config.autoForget) {
			const forgot = this.runExpiry();
			result.forgotten = forgot.count;
			result.details.push(...forgot.details);
		}

		// 2. Dedup & merge similar entries
		result.merged = this.runDedup();
		if (result.merged > 0) {
			result.details.push(`Merged ${result.merged} similar memory groups`);
		}

		// 3. Auto-link related memories
		if (this.config.autoLink) {
			result.linked = this.runLinking();
			if (result.linked > 0) {
				result.details.push(`Linked ${result.linked} related memories`);
			}
		}

		result.afterTotal = this.store.getStats().total;
		return result;
	}

	// =========================================================================
	// Expiry — auto-forget old/low-confidence entries
	// =========================================================================

	runExpiry(): { count: number; details: string[] } {
		const now = Date.now();
		const forgotten: string[] = [];
		const details: string[] = [];

		const entries = this.store.getAllEntries();

		for (const entry of entries) {
			const ageDays = (now - new Date(entry.updatedAt).getTime()) / (1000 * 60 * 60 * 24);

			if (entry.confidence < 0.5 && ageDays > this.config.lowConfidenceMaxAgeDays) {
				this.store.deleteEntry(entry.id);
				forgotten.push(entry.key);
				details.push(
					`Forgot low-confidence entry '${entry.key}' (age: ${Math.round(ageDays)}d, confidence: ${entry.confidence})`,
				);
			} else if (entry.confidence < 0.8 && ageDays > this.config.mediumConfidenceMaxAgeDays) {
				this.store.deleteEntry(entry.id);
				forgotten.push(entry.key);
				details.push(
					`Forgot medium-confidence entry '${entry.key}' (age: ${Math.round(ageDays)}d, confidence: ${entry.confidence})`,
				);
			}
		}

		return { count: forgotten.length, details };
	}

	// =========================================================================
	// Dedup — merge similar entries
	// =========================================================================

	runDedup(): number {
		const entries = this.store.getAllEntries();
		if (entries.length < 2) return 0;

		let mergedCount = 0;
		const processed = new Set<string>();

		for (let i = 0; i < entries.length; i++) {
			if (processed.has(entries[i].id)) continue;

			for (let j = i + 1; j < entries.length; j++) {
				if (processed.has(entries[j].id)) continue;

				const similarity = this.computeSimilarity(entries[i], entries[j]);

				if (similarity >= this.config.dedupSimilarityThreshold) {
					// Merge j into i
					this.mergeEntries(entries[i], entries[j]);
					this.store.deleteEntry(entries[j].id);
					processed.add(entries[j].id);
					mergedCount++;
				}
			}

			processed.add(entries[i].id);
		}

		return mergedCount;
	}

	private computeSimilarity(a: MemoryEntry, b: MemoryEntry): number {
		// Same namespace boost
		let score = 0;
		let factors = 0;

		// Title + content similarity
		const tokensA = tokenize(`${a.title} ${a.content}`);
		const tokensB = tokenize(`${b.title} ${b.content}`);
		score += jaccardSimilarity(tokensA, tokensB);
		factors++;

		// Summary similarity
		const summaryA = tokenize(a.summary || a.title);
		const summaryB = tokenize(b.summary || b.title);
		score += jaccardSimilarity(summaryA, summaryB);
		factors++;

		// Tag overlap
		if (a.tags.length > 0 && b.tags.length > 0) {
			const tagSetA = new Set(a.tags.map((t) => t.toLowerCase()));
			const tagSetB = new Set(b.tags.map((t) => t.toLowerCase()));
			score += jaccardSimilarity(tagSetA, tagSetB);
			factors++;
		}

		// Same namespace bonus
		if (a.namespace === b.namespace) {
			score += 0.15;
			factors++;
		}

		// Same type bonus
		if (a.type === b.type) {
			score += 0.1;
			factors++;
		}

		return score / factors;
	}

	private mergeEntries(target: MemoryEntry, source: MemoryEntry): void {
		// Combine tags (deduped)
		const allTags = [...new Set([...target.tags, ...source.tags])];

		// Combine related keys (deduped)
		const targetKeys = target.relatedKeys ?? [];
		const sourceKeys = source.relatedKeys ?? [];
		const allRelated = [...new Set([...targetKeys, ...sourceKeys, source.key])];

		// Pick the best content (longer = more detailed)
		const bestContent = source.content.length > target.content.length ? source.content : target.content;
		const bestTitle = source.title.length > target.title.length ? source.title : target.title;

		// Update target
		this.store.updateEntry(target.id, {
			title: bestTitle,
			content: bestContent,
			tags: allTags,
			relatedKeys: allRelated,
			confidence: Math.max(target.confidence, source.confidence) + 0.05,
			summary: target.summary || source.summary,
		});
	}

	// =========================================================================
	// Linking — automatically link related entries
	// =========================================================================

	runLinking(): number {
		const entries = this.store.getAllEntries();
		let linkedCount = 0;

		for (let i = 0; i < entries.length; i++) {
			for (let j = i + 1; j < entries.length; j++) {
				const ik = entries[i]!;
				const jk = entries[j]!;
				if ((ik.relatedKeys ?? []).includes(jk.key)) continue;
				if ((jk.relatedKeys ?? []).includes(ik.key)) continue;

				const similarity = this.computeSimilarity(entries[i], entries[j]);

				// Link if they share namespace or have high text similarity
				if ((ik.namespace === jk.namespace && similarity > 0.3) || similarity > 0.5) {
					// Add cross-reference
					const newRelatedI = [...(ik.relatedKeys ?? []), jk.key];
					const newRelatedJ = [...(jk.relatedKeys ?? []), ik.key];

					this.store.updateEntry(ik.id, { relatedKeys: newRelatedI });
					this.store.updateEntry(jk.id, { relatedKeys: newRelatedJ });

					linkedCount++;
				}
			}
		}

		return linkedCount;
	}
}

// ============================================================================
// Types
// ============================================================================

export interface MaintenanceResult {
	forgotten: number;
	merged: number;
	linked: number;
	beforeTotal: number;
	afterTotal: number;
	details: string[];
}
