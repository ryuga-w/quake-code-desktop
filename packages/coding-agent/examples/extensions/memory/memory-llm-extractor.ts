/**
 * LLM-Based Memory Extraction — Higher quality extraction via model API.
 *
 * Faz 3: session_before_compact sırasında LLM çağrısı yaparak
 * yapılandırılmış anılar çıkarır. Pattern-based extraction'dan daha
 * pahalı ama çok daha doğru.
 *
 * Kullanım:
 *   - Otomatik: compaction sırasında (configurable)
 *   - Manuel: /memory llm-extract komutu ile
 *
 * Bağımlılık: @mrquake/quakecode-ai (alias üzerinden erişilebilir)
 */

import type { AgentMessage } from "@mrquake/quakecode-agent-core";
import { completeSimple, type Model } from "@mrquake/quakecode-ai";
import type { MemoryStore } from "./memory-store.js";
import type { MemoryNamespace, MemoryType } from "./types.js";

// ============================================================================
// Config
// ============================================================================

export interface LlmExtractorConfig {
	/** Extract on compaction (session_before_compact) */
	extractOnCompaction: boolean;
	/** Max tokens for LLM extraction response */
	maxResponseTokens: number;
	/** Minimum confidence to save extracted memories */
	minConfidence: number;
	/** Model temperature for extraction (lower = more consistent) */
	temperature: number;
}

export const DEFAULT_LLM_EXTRACTOR_CONFIG: LlmExtractorConfig = {
	extractOnCompaction: true,
	maxResponseTokens: 1024,
	minConfidence: 0.6,
	temperature: 0.1,
};

// ============================================================================
// LLM Extraction Prompt
// ============================================================================

const EXTRACTION_PROMPT = `You are a memory extraction assistant integrated into a coding assistant.

Your task: Analyze the conversation messages below and extract important information that should be remembered for future sessions.

Extract ONLY memories that are:
1. **Important** — Would affect future coding decisions
2. **Stable** — Not temporary or speculative
3. **Actionable** — Would help future coding sessions
4. **Specific** — Concrete facts, not vague statements

For each memory, provide:
- key: kebab-case unique identifier (e.g., "arch-db-choice", "build-fix-cache")
- title: Short human-readable title
- content: Detailed explanation (1-2 sentences)
- summary: One-line summary (max 120 chars)
- type: "fact" | "decision" | "preference" | "learning" | "pattern"
- namespace: "project" | "learnings" | "user" | "wip"
- tags: Array of relevant technology tags
- confidence: 0.0-1.0 (how important is this for future work?)

IMPORTANT: Return ONLY valid JSON. No markdown, no explanations.

{"memories": [...]}`;

// ============================================================================
// LLM Memory Extractor
// ============================================================================

export class LlmMemoryExtractor {
	private store: MemoryStore;
	private config: LlmExtractorConfig;
	private lastModel: Model<any> | null = null;
	private totalTokens: { prompt: number; completion: number } = { prompt: 0, completion: 0 };

	constructor(store: MemoryStore, config: Partial<LlmExtractorConfig> = {}) {
		this.store = store;
		this.config = { ...DEFAULT_LLM_EXTRACTOR_CONFIG, ...config };
	}

	setConfig(partial: Partial<LlmExtractorConfig>): void {
		this.config = { ...this.config, ...partial };
	}

	setModel(model: Model<any> | null): void {
		this.lastModel = model;
	}

	getTotalTokens(): { prompt: number; completion: number } {
		return { ...this.totalTokens };
	}

	// =========================================================================
	// Main extraction method
	// =========================================================================

	async extract(
		messages: AgentMessage[],
		model: Model<any> | null,
		options?: { force?: boolean },
	): Promise<LlmExtractResult> {
		// Store model reference for future use
		if (model) this.lastModel = model;
		model = model || this.lastModel;

		if (!model) {
			return { success: false, count: 0, memories: [], error: "No model available" };
		}

		if (messages.length === 0) {
			return { success: true, count: 0, memories: [], error: undefined };
		}

		// Build conversation text from messages
		const conversationText = this.formatMessages(messages);
		if (conversationText.length < 20) {
			return { success: true, count: 0, memories: [], error: undefined };
		}

		try {
			// Call LLM
			const result = await completeSimple(
				model,
				{
					systemPrompt: EXTRACTION_PROMPT,
					messages: [
						{ role: "user", content: `<messages>\n${conversationText}\n</messages>`, timestamp: Date.now() },
					],
				},
				{
					temperature: this.config.temperature,
					maxTokens: this.config.maxResponseTokens,
				},
			);

			const content = extractContentText(result);
			this.totalTokens.completion += content.length / 4; // rough estimate

			// Parse JSON response
			const parsed = this.parseResponse(content);
			if (!parsed || !Array.isArray(parsed.memories)) {
				return { success: false, count: 0, memories: [], error: "Invalid response format" };
			}

			// Save memories
			const saved: ExtractedMemory[] = [];
			for (const mem of parsed.memories.slice(0, 10)) {
				if ((mem.confidence ?? 0) < this.config.minConfidence) continue;

				try {
					this.store.addEntry({
						key: mem.key,
						title: mem.title || "",
						content: mem.content || "",
						summary: mem.summary || (mem.content?.slice(0, 120) ?? ""),
						type: this.normalizeType(mem.type),
						namespace: this.normalizeNamespace(mem.namespace),
						scope: "project",
						tags: mem.tags ?? [],
						sessionId: undefined,
						turnIndex: undefined,
						confidence: mem.confidence ?? this.config.minConfidence,
						sourceMessages: [],
						relatedKeys: [],
					});
					saved.push(mem);
				} catch {
					// Skip invalid entries
				}
			}

			return { success: true, count: saved.length, memories: saved, error: undefined };
		} catch (err: any) {
			return {
				success: false,
				count: 0,
				memories: [],
				error: err?.message ?? String(err),
			};
		}
	}

	// =========================================================================
	// Helpers
	// =========================================================================

	private formatMessages(messages: AgentMessage[]): string {
		return messages
			.map((msg) => {
				const role = msg.role;
				const content = getContentText(msg);
				if (!content || content.trim().length < 5) return null;
				return `<${role}>\n${content.trim()}\n</${role}>`;
			})
			.filter(Boolean)
			.join("\n\n");
	}

	private parseResponse(text: string): LlmResponse | null {
		// Try direct JSON parse first
		const trimmed = text.trim();
		if (trimmed.startsWith("{")) {
			try {
				return JSON.parse(trimmed) as LlmResponse;
			} catch {}
		}

		// Try to extract JSON from markdown code block
		const jsonMatch = trimmed.match(/```(?:json)?\s*\n?({[\s\S]*?})\n?\s*```/);
		if (jsonMatch) {
			try {
				return JSON.parse(jsonMatch[1]) as LlmResponse;
			} catch {}
		}

		// Try to find any JSON object in the text
		const anyJson = trimmed.match(/\{[\s\S]*"memories"[\s\S]*\}/);
		if (anyJson) {
			try {
				return JSON.parse(anyJson[0]) as LlmResponse;
			} catch {}
		}

		return null;
	}

	private normalizeType(t: string): MemoryType {
		const valid: MemoryType[] = ["fact", "decision", "preference", "learning", "pattern"];
		const lower = t?.toLowerCase() ?? "fact";
		if (valid.includes(lower as MemoryType)) return lower as MemoryType;
		return "fact";
	}

	private normalizeNamespace(ns: string): MemoryNamespace {
		const valid: MemoryNamespace[] = ["project", "learnings", "user", "wip"];
		const lower = ns?.toLowerCase() ?? "project";
		if (valid.includes(lower as MemoryNamespace)) return lower as MemoryNamespace;
		return "project";
	}
}

// ============================================================================
// Types
// ============================================================================

export interface ExtractedMemory {
	key: string;
	title: string;
	content: string;
	summary?: string;
	type: string;
	namespace: string;
	tags: string[];
	confidence: number;
}

interface LlmResponse {
	memories: ExtractedMemory[];
}

export interface LlmExtractResult {
	success: boolean;
	count: number;
	memories: ExtractedMemory[];
	error?: string;
}

// ============================================================================
// Helper
// ============================================================================

/** Extract text from AssistantMessage content (which is an array) */
function extractContentText(msg: any): string {
	if (!msg || !msg.content) return "";
	if (typeof msg.content === "string") return msg.content;
	if (Array.isArray(msg.content)) {
		return msg.content
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text || "")
			.join("\n");
	}
	return "";
}

function getContentText(msg: AgentMessage): string | undefined {
	if (msg.role === "assistant") {
		const content = (msg as any).content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.filter((c: any) => c.type === "text")
				.map((c: any) => c.text)
				.join("\n");
		}
		return undefined;
	}
	if (msg.role === "user") {
		const content = (msg as any).content;
		if (typeof content === "string") return content;
		return undefined;
	}
	if (msg.role === "toolResult") {
		const content = (msg as any).response;
		if (typeof content === "string") return content;
		return undefined;
	}
	return undefined;
}
