/**
 * Memory Extractor — Pattern-based extraction at agent_end and compaction.
 *
 * Faz 2: Otomatik bellek çıkarımı.
 * - agent_end: Asistan mesajlarından pattern matching ile çıkarım
 * - session_before_compact: Compact edilen mesajlardan çıkarım
 *
 * Extraction yöntemleri:
 * 1. Pattern-based (ücretsiz, hızlı) — keyword/patern eşleştirme
 * 2. LLM-based (Faz 3) — compaction'da ayrı LLM çağrısı
 */

import type { AgentMessage } from "@mrquake/quakecode-agent-core";
import type { MemoryStore } from "./memory-store.js";
import type { MemoryEntry, MemoryNamespace, MemoryType } from "./types.js";

// ============================================================================
// Extraction Patterns
// ============================================================================

/** Decision pattern'leri — "we chose X", "let's use Y", "I prefer Z" */
const DECISION_PATTERNS = [
	// İngilizce
	/\b(?:we\s+(?:have\s+)?(?:decided|chosen|opted|selected|picked|settled)\s+(?:on|for|to\s+use))\s+(.+?)(?:\.|,|$)/i,
	/\b(?:let'?s\s+(?:use|go\s+with|stick\s+with|try))\s+(.+?)(?:\.|,|$)/i,
	/\b(?:I(?:'ve)?\s+(?:decided|chosen|opted|prefer|recommend|suggest)\s+(?:to\s+)?(?:use|go\s+with)?)\s+(.+?)(?:\.|,|$)/i,
	/\b(?:going\s+with|using|choosing)\s+(.+?)(?:\.|,|\s+because|\s+for|\s+since)/i,
	/\b(?:the\s+(?:best|right|correct)\s+(?:approach|way|solution|choice)\s+is)\s+(.+?)(?:\.|,|$)/i,
	// Türkçe
	/\b(?:karar\s+(?:verdik|verdim)|seçtik|kullanalım|kullanmaya\s+karar\s+verdik)\s+(.+?)(?:\.|,|$)/i,
	/\b(?:en\s+iyi\s+(?:yaklaşım|çözüm|yol)\s+(?:bu|şudur))\s+(.+?)(?:\.|,|$)/i,
];

/** Preference pattern'leri — "I like", "I don't like", "prefer X over Y" */
const PREFERENCE_PATTERNS = [
	/\b(?:I\s+(?:would\s+)?prefer\s+(?:to\s+)?(?:use\s+)?)\s+(.+?)(?:\.|,|$)/i,
	/\b(?:I\s+(?:really\s+|strongly\s+)?(?:like|love|enjoy|appreciate)\s+(?:using\s+)?)\s+(.+?)(?:\.|,|$)/i,
	/\b(?:I\s+don'?t\s+(?:like|want|prefer)\s+(?:to\s+)?(?:use\s+)?)\s+(.+?)(?:\.|,|$)/i,
	/\b(?:I'?m\s+(?:more\s+)?comfortable\s+with)\s+(.+?)(?:\.|,|$)/i,
	/\b(?:I\s+(?:usually|always|generally|normally)\s+(?:use|prefer))\s+(.+?)(?:\.|,|$)/i,
];

/** Learning pattern'leri — "note that", "important", "gotcha", "beware" */
const LEARNING_PATTERNS = [
	/\b(?:note\s+(?:that|:|−)|important\s+(?:note|point|to\s+know)|key\s+(?:takeaway|insight|learning))\s+(.+?)(?:\.|!|$)/i,
	/\b(?:one\s+(?:thing\s+to\s+)?(?:watch\s+out\s+for|be\s+careful\s+(?:about|with)|keep\s+in\s+mind))\s+(?:is\s+)?(.+?)(?:\.|!|$)/i,
	/\b(?:gotcha|pitfall|got\s+bit|tricky\s+part)\s+(?:is\s+|:)\s*(.+?)(?:\.|!|$)/i,
	/\b(?:this\s+is\s+(?:a\s+)?(?:common|frequent|known)\s+(?:issue|mistake|problem|pitfall))\s+(.+?)(?:\.|!|$)/i,
	/\b(?:be?\s+aware\s+that|beware\s+of)\s+(.+?)(?:\.|!|$)/i,
	// Türkçe
	/\b(?:önemli\s+(?:not|nokta|bilgi)|dikkat\s+(?:et|edin)|unutma\s+(?:ki|yın)|not\s+(?:et|al))\s+(.+?)(?:\.|!|$)/i,
];

/** Pattern pattern'leri — "pattern is", "common pattern", "best practice" */
const PATTERN_PATTERNS = [
	/\b(?:common\s+(?:pattern|approach|practice|idiom))\s+(?:is\s+|:)\s*(.+?)(?:\.|!|$)/i,
	/\b(?:the\s+(?:standard|common|usual|typical)\s+(?:way|pattern|approach))\s+(?:is\s+|to\s+)\s*(.+?)(?:\.|!|$)/i,
	/\b(?:this\s+(?:follows|matches|uses)\s+(?:the\s+)?(?:standard|common|typical)\s+(?:pattern|practice))\s+(.+?)(?:\.|!|$)/i,
];

/** Fact pattern'leri — "X is Y", "X uses Y", "the project has" */
const FACT_PATTERNS = [
	/\b(?:the\s+(?:project|app|codebase|repository)\s+(?:uses|is\s+built\s+with|is\s+written\s+in))\s+(.+?)(?:\.|,|$)/i,
	/\b(?:we'?re\s+(?:using|running|deploying\s+(?:on|with)|built\s+with))\s+(.+?)(?:\.|,|$)/i,
	/\b(?:this\s+(?:project|repo|app)\s+(?:requires|needs|depends\s+on))\s+(.+?)(?:\.|,|$)/i,
];

/** User identity pattern'leri — "I'm X", "my name is X", "ben X", "adım X" */
const IDENTITY_PATTERNS = [
	// İngilizce
	/\b(?:I(?:'?)m|my\s+name\s+is|call\s+me|you\s+can\s+call\s+me)\s+(\w+)(?:\.|,|!|$)/i,
	/\b(?:I\s+(?:am\s+called|go\s+by))\s+(\w+)(?:\.|,|!|$)/i,
	// Türkçe — ben <isim>, adım <isim>, ismim <isim>
	/\b(?:ben\s+)(\w+)(?:\s+(?:im|'?im|yım|yim|yum|yüm))?(?:\.|,|!|$)/i,
	/\b(?:(?:benim\s+)?(?:adım|ismim|nickim|rumuzum)\s+)(\w+)(?:\.|,|!|$)/i,
	/\bbana\s+(\w+)\s+de(?:\.|,|!|$)/i,
	/\b(?:kullanıcı\s+adım|rumuzum|nickim)\s+(\w+)(?:\.|,|!|$)/i,
];

// ============================================================================
// Extracted Memory Candidate
// ============================================================================

interface ExtractionCandidate {
	key: string;
	title: string;
	content: string;
	summary: string;
	type: MemoryType;
	namespace: MemoryNamespace;
	tags: string[];
	confidence: number;
}

// ============================================================================
// Extractor
// ============================================================================

export class MemoryExtractor {
	private memoryStore: MemoryStore;
	private enabled: boolean;

	constructor(memoryStore: MemoryStore, enabled = true) {
		this.memoryStore = memoryStore;
		this.enabled = enabled;
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	/**
	 * Extract memories from agent_end messages.
	 * Pattern matching on BOTH assistant and user messages.
	 */
	extractFromAgentEnd(messages: AgentMessage[]): ExtractionCandidate[] {
		if (!this.enabled) return [];

		const candidates: ExtractionCandidate[] = [];

		for (const msg of messages) {
			if (msg.role === "assistant") {
				const text = getAssistantText(msg);
				if (text) {
					candidates.push(...this.extractFromText(text, "assistant"));
				}
			} else if (msg.role === "user") {
				const text = getUserText(msg);
				if (text) {
					// User messages: identity patterns get priority + higher confidence
					candidates.push(...this.extractFromText(text, "user"));
				}
			}
		}

		// Save candidates with sufficient confidence
		let saved = 0;
		for (const c of candidates) {
			if (c.confidence >= 0.5) {
				this.memoryStore.addEntry({
					key: c.key,
					title: c.title,
					content: c.content,
					summary: c.summary,
					type: c.type,
					namespace: c.namespace,
					scope: "project",
					tags: c.tags,
					sessionId: undefined,
					turnIndex: undefined,
					confidence: c.confidence,
					sourceMessages: [],
					relatedKeys: [],
				});
				saved++;
			}
		}

		return candidates;
	}

	/**
	 * Extract memories from compaction entries.
	 * Higher confidence since compaction means older/important info.
	 */
	extractFromCompaction(entries: AgentMessage[]): ExtractionCandidate[] {
		if (!this.enabled) return [];

		const candidates = this.extractFromAgentEnd(entries);

		// Boost confidence for compaction entries (they're important enough to keep)
		for (const c of candidates) {
			c.confidence = Math.min(c.confidence + 0.2, 1.0);
		}

		return candidates;
	}

	/**
	 * Extract memories from text content using pattern matching.
	 */
	private extractFromText(text: string, source: "assistant" | "user" = "assistant"): ExtractionCandidate[] {
		const candidates: ExtractionCandidate[] = [];

		// Decision patterns
		// Identity patterns (high priority, user namespace)
		for (const pattern of IDENTITY_PATTERNS) {
			const match = text.match(pattern);
			if (match && match[1]) {
				const name = match[1].trim();
				if (name.length > 1 && name.length < 40) {
					const key = this.makeKey("user", name);
					candidates.push({
						key,
						title: `User name: ${name}`,
						content: `The user's name or identifier is "${name}". They introduced themselves.`,
						summary: `User name: ${name}`,
						type: "fact",
						namespace: "user",
						tags: ["user-identity", name.toLowerCase()],
						confidence: source === "user" ? 0.9 : 0.7,
					});
				}
			}
		}

		// Decision patterns
		for (const pattern of DECISION_PATTERNS) {
			const match = text.match(pattern);
			if (match && match[1]) {
				const extracted = match[1].trim();
				if (extracted.length > 5 && extracted.length < 200) {
					const key = this.makeKey("dec", extracted);
					candidates.push({
						key,
						title: extracted.slice(0, 60),
						content: extracted,
						summary: extracted.slice(0, 120),
						type: "decision",
						namespace: "project",
						tags: this.extractTags(extracted),
						confidence: 0.6,
					});
				}
			}
		}

		// Preference patterns
		for (const pattern of PREFERENCE_PATTERNS) {
			const match = text.match(pattern);
			if (match && match[1]) {
				const extracted = match[1].trim();
				if (extracted.length > 5 && extracted.length < 200) {
					const key = this.makeKey("pref", extracted);
					candidates.push({
						key,
						title: extracted.slice(0, 60),
						content: extracted,
						summary: extracted.slice(0, 120),
						type: "preference",
						namespace: "user",
						tags: this.extractTags(extracted),
						confidence: source === "user" ? 0.7 : 0.5,
					});
				}
			}
		}

		// Learning patterns
		for (const pattern of LEARNING_PATTERNS) {
			const match = text.match(pattern);
			if (match && match[1]) {
				const extracted = match[1].trim();
				if (extracted.length > 10 && extracted.length < 300) {
					const key = this.makeKey("learn", extracted);
					candidates.push({
						key,
						title: extracted.slice(0, 60),
						content: extracted,
						summary: extracted.slice(0, 120),
						type: "learning",
						namespace: "learnings",
						tags: this.extractTags(extracted),
						confidence: 0.7,
					});
				}
			}
		}

		// Pattern patterns
		for (const pattern of PATTERN_PATTERNS) {
			const match = text.match(pattern);
			if (match && match[1]) {
				const extracted = match[1].trim();
				if (extracted.length > 10 && extracted.length < 300) {
					const key = this.makeKey("pattern", extracted);
					candidates.push({
						key,
						title: extracted.slice(0, 60),
						content: extracted,
						summary: extracted.slice(0, 120),
						type: "pattern",
						namespace: "learnings",
						tags: this.extractTags(extracted),
						confidence: 0.6,
					});
				}
			}
		}

		// Fact patterns
		for (const pattern of FACT_PATTERNS) {
			const match = text.match(pattern);
			if (match && match[1]) {
				const extracted = match[1].trim();
				if (extracted.length > 5 && extracted.length < 200) {
					const key = this.makeKey("fact", extracted);
					candidates.push({
						key,
						title: extracted.slice(0, 60),
						content: extracted,
						summary: extracted.slice(0, 120),
						type: "fact",
						namespace: "project",
						tags: this.extractTags(extracted),
						confidence: 0.5,
					});
				}
			}
		}

		return candidates;
	}

	/** Generate a URL-safe key from text */
	private makeKey(prefix: string, text: string): string {
		const slug = text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40);
		const hash = Math.abs(hashCode(text)).toString(36).slice(0, 4);
		return `${prefix}-${slug}-${hash}`;
	}

	/** Extract relevant tags from text */
	private extractTags(text: string): string[] {
		const techWords = [
			"react",
			"vue",
			"angular",
			"svelte",
			"solid",
			"typescript",
			"javascript",
			"node",
			"deno",
			"bun",
			"python",
			"rust",
			"go",
			"java",
			"kotlin",
			"docker",
			"kubernetes",
			"aws",
			"gcp",
			"azure",
			"firebase",
			"postgres",
			"mysql",
			"sqlite",
			"mongodb",
			"redis",
			"prisma",
			"graphql",
			"rest",
			"grpc",
			"websocket",
			"tailwind",
			"bootstrap",
			"shadcn",
			"mui",
			"next",
			"nuxt",
			"remix",
			"astro",
			"vite",
			"jest",
			"vitest",
			"playwright",
			"cypress",
			"git",
			"github",
			"ci",
			"cd",
			"eslint",
			"prettier",
			"pnpm",
			"npm",
			"yarn",
			"webpack",
			"esbuild",
			"api",
			"cli",
			"sdk",
			"db",
			"sql",
			"orm",
		];

		const found: string[] = [];
		const lower = text.toLowerCase();
		for (const word of techWords) {
			if (lower.includes(word)) {
				found.push(word);
			}
		}
		return found;
	}
}

// ============================================================================
// Helpers
// ============================================================================

function getUserText(msg: AgentMessage): string | undefined {
	if (msg.role !== "user") return undefined;
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

function getAssistantText(msg: AgentMessage): string | undefined {
	if (msg.role !== "assistant") return undefined;
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

function hashCode(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash |= 0;
	}
	return hash;
}
