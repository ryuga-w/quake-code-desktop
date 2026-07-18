/**
 * Quake Memory Extension — Ana giriş noktası
 *
 * Faz 1: remember/recall/forget tool'ları, context inject, system prompt
 * Faz 2: Pattern-based auto-extraction, compaction integration, branching
 *
 * Yükleme:
 *   quake --extension examples/extensions/memory
 *   veya ~/.quake-code/agent/extensions/ dizinine kopyala
 */

import type { AgentMessage } from "@mrquake/quakecode-agent-core";
import type { ExtensionAPI } from "@mrquake/quakecode-cli";
import { registerMemoryCommands } from "./memory-commands.js";
import { MemoryExtractor } from "./memory-extractor.js";
import {
	DEFAULT_INJECTOR_OPTIONS,
	getMemorySystemPrompt,
	type InjectorOptions,
	injectMemories,
} from "./memory-injector.js";
import { LlmMemoryExtractor } from "./memory-llm-extractor.js";
import { DEFAULT_MAINTENANCE_CONFIG, MemoryMaintenance } from "./memory-maintenance.js";
import { getMemoryStore } from "./memory-store.js";
import { createForgetTool, createRecallTool, createRememberMultiTool, createRememberTool } from "./memory-tools.js";

export default function (quake: ExtensionAPI) {
	// =========================================================================
	// Initialize
	// =========================================================================

	console.log("[memory] Extension loading...");
	const memoryStore = getMemoryStore();
	const extractor = new MemoryExtractor(memoryStore);
	const maintenance = new MemoryMaintenance(memoryStore);
	const llmExtractor = new LlmMemoryExtractor(memoryStore);
	const injectorOptions: InjectorOptions = { ...DEFAULT_INJECTOR_OPTIONS };
	let lastExtractionCount = 0;
	let sessionTurnCount = 0;

	// =========================================================================
	// Tools
	// =========================================================================

	quake.registerTool(createRememberTool(memoryStore));
	quake.registerTool(createRecallTool(memoryStore));
	quake.registerTool(createForgetTool(memoryStore));
	quake.registerTool(createRememberMultiTool(memoryStore));

	// =========================================================================
	// Commands
	// =========================================================================

	registerMemoryCommands(quake, memoryStore, maintenance, llmExtractor);

	// =========================================================================
	// Event: session_start — load memory from disk
	// =========================================================================

	quake.on("session_start", async (_event, ctx) => {
		console.log("[memory] Session started — loading memory store...");
		memoryStore.load();

		const flag = quake.getFlag("memory-max-tokens");
		if (typeof flag === "string") {
			const parsed = parseInt(flag, 10);
			if (!isNaN(parsed) && parsed > 0) {
				injectorOptions.maxInjectTokens = parsed;
			}
		}

		// Auto-extract flag
		const extractFlag = quake.getFlag("memory-auto-extract");
		if (extractFlag === "false" || extractFlag === "0") {
			extractor.setEnabled(false);
		}

		sessionTurnCount = 0;

		// Run maintenance on every 5th session start
		const stats = memoryStore.getStats();
		if (stats.total > 0) {
			ctx.ui.notify(`🧠 Memory loaded: ${stats.total} entries`, "info");

			// Maintenance every 5th session (track via metadata)
			const meta = (memoryStore as any).metadata;
			const sessionMod = (meta?.sessionCount ?? 0) % 5;
			if (sessionMod === 0 && stats.total > 20) {
				maintainAndNotify(extractor, maintenance, ctx);
			}
		}
	});

	// =========================================================================
	// Event: context — inject working memory
	// =========================================================================

	quake.on("context", (event) => {
		if (!injectorOptions.enabled) return;

		const modified = injectMemories(event.messages, memoryStore, injectorOptions);
		if (modified !== event.messages) {
			return { messages: modified };
		}
	});

	// =========================================================================
	// Event: before_agent_start — augment system prompt
	// =========================================================================

	quake.on("before_agent_start", () => {
		if (memoryStore.getAllEntries().length === 0) return;
		return { systemPrompt: getMemorySystemPrompt() };
	});

	// =========================================================================
	// Event: agent_end — auto-extract + save
	// =========================================================================
	//
	// Faz 2: Pattern matching ile asistan mesajlarından memory çıkarımı.
	// Düşük maliyetli, hiçbir ek LLM çağrısı yapmaz.

	quake.on("agent_end", (event, ctx) => {
		sessionTurnCount++;

		// Pattern-based extraction
		const extracted = extractor.extractFromAgentEnd(event.messages);
		if (extracted.length > 0) {
			lastExtractionCount = extracted.length;

			// Take a session snapshot for branching
			quake.appendEntry("memory::snapshot", {
				timestamp: new Date().toISOString(),
				totalEntries: memoryStore.getStats().total,
				lastExtracted: extracted.map((e) => ({ key: e.key, type: e.type })),
			});

			if (ctx.hasUI) {
				const types = extracted.map((e) => e.type);
				const uniqueTypes = [...new Set(types)];
				ctx.ui.notify(`🧠 ${extracted.length} memory/memories extracted (${uniqueTypes.join(", ")})`, "info");
			}
		}

		// Log extraction stats
		if (extracted.length > 0) {
			console.log(
				`[memory] Auto-extracted ${extracted.length} memories (${extracted.map((e) => e.key).join(", ")})`,
			);
		}

		// Persist to disk
		memoryStore.save();
	});

	// =========================================================================
	// Event: session_before_compact — preserve memories during compaction
	// =========================================================================
	//
	// Faz 2: Pattern-based extraction (ücretsiz)
	// Faz 3: LLM-based extraction (daha doğru, compaction'da)
	//
	// NOT: Bu handler ASYNC olarak işaretlenmiştir, compaction'ı bekletir.
	// LLM çağrısı timeout/cancel durumlarında sessizce atlanır.

	quake.on("session_before_compact", async (event, ctx) => {
		try {
			const allMessages = event.preparation.messagesToSummarize;

			// Faz 2: Pattern-based (always, cheap)
			const assistantMessages = allMessages.filter((m: AgentMessage) => m.role === "assistant");
			if (assistantMessages.length > 0) {
				extractor.extractFromCompaction(assistantMessages);
			}

			// Faz 3: LLM-based (if model available, higher quality)
			if (ctx.model && !event.signal.aborted) {
				llmExtractor.setModel(ctx.model);
				const result = await Promise.race([
					llmExtractor.extract(allMessages, ctx.model),
					new Promise<null>((resolve) => {
						const onAbort = () => {
							resolve(null);
							event.signal.removeEventListener("abort", onAbort);
						};
						event.signal.addEventListener("abort", onAbort);
					}),
				]);
				if (result && result.success && result.count > 0 && ctx.hasUI) {
					ctx.ui.notify(`🤖 LLM extracted ${result.count} memories from compaction`, "info");
				}
			}
		} catch (err) {
			// LLM extraction failed silently — compaction should never block
			console.error(`[memory] session_before_compact error: ${err}`);
		}
	});

	// =========================================================================
	// Event: session_tree — branching snapshot
	// =========================================================================
	//
	// Faz 2: Dal değiştiğinde memory durumunu snapshot'la.

	quake.on("session_tree", () => {
		try {
			quake.appendEntry("memory::branch", {
				timestamp: new Date().toISOString(),
				stats: memoryStore.getStats(),
				recentKeys: memoryStore
					.getAllEntries()
					.slice(-10)
					.map((e) => e.key),
			});
		} catch (err) {
			console.error(`[memory] session_tree error: ${err}`);
		}
	});

	// =========================================================================
	// =========================================================================
	// Event: session_shutdown — final save + maintenance
	// =========================================================================

	quake.on("session_shutdown", () => {
		const stats = memoryStore.getStats();
		console.log(`[memory] Session ended. ${stats.total} memories stored.`);

		// Auto-maintenance after 10+ turns
		if (sessionTurnCount >= 10) {
			maintenance.runAll();
		}
		memoryStore.save();
	});

	// =========================================================================
	// Helper
	// =========================================================================

	function maintainAndNotify(_extractor: MemoryExtractor, _maintenance: MemoryMaintenance, ctx: any) {
		const result = _maintenance.runAll();
		if (result.forgotten > 0 || result.merged > 0 || result.linked > 0) {
			ctx.ui.notify(
				`🧹 Memory maintenance: ${result.forgotten} forgotten, ${result.merged} merged, ${result.linked} linked (${result.beforeTotal} → ${result.afterTotal})`,
				"info",
			);
		}
	}

	// =========================================================================
	// CLI Flags
	// =========================================================================

	console.log("[memory] Extension loaded successfully!");

	quake.registerFlag("memory-max-tokens", {
		description: "Maximum tokens for memory context injection (default: 2048)",
		type: "string",
		default: "2048",
	});

	quake.registerFlag("memory-auto-extract", {
		description: "Enable auto-extraction at agent_end (default: true)",
		type: "string",
		default: "true",
	});
}
