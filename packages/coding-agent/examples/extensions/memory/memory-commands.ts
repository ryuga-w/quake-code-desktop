/**
 * Memory Extension - User commands (/memory)
 *
 * Interactive commands for users to manage memory.
 */

import type { LlmMemoryExtractor } from "./memory-llm-extractor.js";
import type { MemoryMaintenance } from "./memory-maintenance.js";
import { formatMemoryForRecall, formatMemoryShort } from "./memory-prompts.js";
import type { MemoryStore } from "./memory-store.js";

export function registerMemoryCommands(
	quake: any,
	memoryStore: MemoryStore,
	maintenance?: MemoryMaintenance,
	llmExtractor?: LlmMemoryExtractor,
): void {
	// =========================================================================
	// /memory list
	// =========================================================================

	quake.registerCommand("memory", {
		description:
			"Manage persistent memory. Usage: /memory <list|search|show|delete|stats|export|import|clear> [args...]",
		handler: async (args: string, ctx: any) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0]?.toLowerCase() || "list";
			const subArgs = parts.slice(1);

			switch (subcommand) {
				case "list":
					await handleList(memoryStore, subArgs, ctx);
					break;
				case "search":
					await handleSearch(memoryStore, subArgs, ctx);
					break;
				case "show":
					await handleShow(memoryStore, subArgs, ctx);
					break;
				case "delete":
					await handleDelete(memoryStore, subArgs, ctx);
					break;
				case "stats":
					await handleStats(memoryStore, ctx);
					break;
				case "export":
					await handleExport(memoryStore, subArgs, ctx);
					break;
				case "clear":
					await handleClear(memoryStore, ctx);
					break;
				case "maintain":
					if (maintenance) {
						await handleMaintain(maintenance, ctx);
					} else {
						ctx.ui.notify("❌ Memory maintenance not initialized", "error");
					}
					break;
				case "llm-extract":
				case "llm":
					if (llmExtractor) {
						await handleLlmExtract(memoryStore, llmExtractor, ctx);
					} else {
						ctx.ui.notify("❌ LLM extractor not initialized", "error");
					}
					break;
				case "dashboard":
				case "dash":
					await handleDashboard(memoryStore, ctx);
					break;
				case "graph":
					await handleGraph(memoryStore, subArgs, ctx);
					break;
				default:
					ctx.ui.notify(
						`Unknown subcommand: ${subcommand}. Usage: /memory <list|search|show|delete|stats|export|clear|maintain|llm|dash|graph>`,
						"warning",
					);
			}
		},
	});
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleList(store: MemoryStore, args: string[], ctx: any): Promise<void> {
	const namespace = args[0] as any;
	const limit = parseInt(args[1], 10) || 20;

	const result = store.query({
		namespace: namespace || undefined,
		limit,
	});

	if (result.entries.length === 0) {
		ctx.ui.notify("📭 No memories stored yet. Ask the agent to remember something!", "info");
		return;
	}

	const lines = result.entries.map((e) => formatMemoryShort(e));
	const header = `🧠 Memories ${namespace ? `(${namespace})` : ""} (${result.total} total):\n`;
	const output = header + lines.map((l) => `  ${l}`).join("\n");

	if (ctx.hasUI) {
		await ctx.ui.editor("Memory List", output);
	} else {
		ctx.ui.notify(output, "info");
	}
}

async function handleSearch(store: MemoryStore, args: string[], ctx: any): Promise<void> {
	if (args.length === 0) {
		ctx.ui.notify("Usage: /memory search <query>", "warning");
		return;
	}

	const query = args.join(" ");
	const result = store.search(query, { limit: 10 });

	if (result.entries.length === 0) {
		ctx.ui.notify(`📭 No memories matching "${query}"`, "info");
		return;
	}

	const lines = result.entries.map((e) => formatMemoryShort(e));
	const header = `🔍 Memories matching "${query}" (${result.total}):\n`;
	const output = header + lines.map((l) => `  ${l}`).join("\n");

	if (ctx.hasUI) {
		await ctx.ui.editor("Memory Search", output);
	} else {
		ctx.ui.notify(output, "info");
	}
}

async function handleShow(store: MemoryStore, args: string[], ctx: any): Promise<void> {
	if (args.length === 0) {
		ctx.ui.notify("Usage: /memory show <key>", "warning");
		return;
	}

	const key = args[0];
	const entry = store.getEntryByKey(key);

	if (!entry) {
		ctx.ui.notify(`❌ Memory with key "${key}" not found`, "error");
		return;
	}

	const output = [
		`Key: ${entry.key}`,
		`Title: ${entry.title}`,
		`Type: ${entry.type} | Namespace: ${entry.namespace} | Scope: ${entry.scope}`,
		`Tags: ${entry.tags.join(", ") || "none"}`,
		`Created: ${new Date(entry.createdAt).toLocaleString()}`,
		`Updated: ${new Date(entry.updatedAt).toLocaleString()}`,
		`Confidence: ${entry.confidence}`,
		``,
		entry.content,
	].join("\n");

	if (ctx.hasUI) {
		await ctx.ui.editor(`Memory: ${entry.key}`, output);
	} else {
		ctx.ui.notify(output, "info");
	}
}

async function handleDelete(store: MemoryStore, args: string[], ctx: any): Promise<void> {
	if (args.length === 0) {
		ctx.ui.notify("Usage: /memory delete <key>", "warning");
		return;
	}

	const key = args[0];
	const confirmed = await ctx.ui.confirm("Confirm Delete", `Delete memory "${key}"?`);

	if (!confirmed) {
		ctx.ui.notify("Cancelled", "info");
		return;
	}

	const deleted = store.deleteEntryByKey(key);
	if (deleted) {
		store.save();
		ctx.ui.notify(`🗑️ Deleted: ${key}`, "info");
	} else {
		ctx.ui.notify(`❌ Memory "${key}" not found`, "error");
	}
}

async function handleStats(store: MemoryStore, ctx: any): Promise<void> {
	const stats = store.getStats();

	const lines = [
		`🧠 Memory Store Stats`,
		`Total entries: ${stats.total}`,
		``,
		`By namespace:`,
		...Object.entries(stats.byNamespace).map(([ns, count]) => `  ${ns}: ${count}`),
		``,
		`By type:`,
		...Object.entries(stats.byType).map(([t, count]) => `  ${t}: ${count}`),
	];

	if (ctx.hasUI) {
		await ctx.ui.editor("Memory Stats", lines.join("\n"));
	} else {
		ctx.ui.notify(lines.join("\n"), "info");
	}
}

async function handleExport(store: MemoryStore, args: string[], ctx: any): Promise<void> {
	const entries = store.exportEntries();
	const json = JSON.stringify(entries, null, 2);

	if (args[0]) {
		try {
			const fs = await import("node:fs");
			fs.writeFileSync(args[0], json, "utf-8");
			ctx.ui.notify(`✅ Exported ${entries.length} memories to ${args[0]}`, "info");
		} catch (err) {
			ctx.ui.notify(`❌ Export failed: ${err}`, "error");
		}
	} else if (ctx.hasUI) {
		await ctx.ui.editor(`Memory Export (${entries.length} entries)`, json);
	} else {
		ctx.ui.notify(`📋 ${entries.length} memories (use /memory export <file> to save)`, "info");
	}
}

async function handleClear(store: MemoryStore, ctx: any): Promise<void> {
	const stats = store.getStats();
	if (stats.total === 0) {
		ctx.ui.notify("📭 No memories to clear", "info");
		return;
	}

	const confirmed = await ctx.ui.confirm(
		"⚠️ Clear All Memories",
		`Delete ALL ${stats.total} memories? This cannot be undone.`,
	);

	if (!confirmed) {
		ctx.ui.notify("Cancelled", "info");
		return;
	}

	// Double confirm for safety
	const really = await ctx.ui.confirm("Are you sure?", "This will permanently delete all stored memories.");

	if (!really) {
		ctx.ui.notify("Cancelled", "info");
		return;
	}

	store.clear();
	store.save();
	ctx.ui.notify(`🗑️ Cleared all ${stats.total} memories`, "info");
}

// ============================================================================
// /memory maintain
// ============================================================================

async function handleMaintain(maintenance: MemoryMaintenance, ctx: any): Promise<void> {
	ctx.ui.notify("🔄 Running memory maintenance...", "info");

	const result = maintenance.runAll();

	const lines = [
		`🧹 Memory Maintenance Complete`,
		`Before: ${result.beforeTotal} entries`,
		`After:  ${result.afterTotal} entries`,
		`Forgotten: ${result.forgotten}`,
		`Merged:    ${result.merged}`,
		`Linked:    ${result.linked}`,
		result.details.length > 0 ? `` : null,
		...result.details,
	]
		.filter(Boolean)
		.join("\n");

	if (ctx.hasUI) {
		await ctx.ui.editor("Memory Maintenance", lines);
	} else {
		ctx.ui.notify(lines, "info");
	}
}

// ============================================================================
// /memory llm-extract
// ============================================================================

async function handleLlmExtract(store: MemoryStore, llmExtractor: LlmMemoryExtractor, ctx: any): Promise<void> {
	const stats = store.getStats();
	const tokens = llmExtractor.getTotalTokens();

	const lines = [
		`🤖 LLM Extractor Status`,
		`Model available: ${ctx.model ? "✅" : "❌"}`,
		`Total memories: ${stats.total}`,
		`Total prompt tokens (est.): ${tokens.prompt}`,
		`Total completion tokens (est.): ${tokens.completion}`,
		`Total LLM extractions so far in this session.`,
	];

	if (ctx.hasUI) {
		await ctx.ui.editor("LLM Extractor", lines.join("\n"));
	} else {
		ctx.ui.notify(lines.join("\n"), "info");
	}
}

// ============================================================================
// /memory dashboard — single-panel overview
// ============================================================================

async function handleDashboard(store: MemoryStore, ctx: any): Promise<void> {
	const stats = store.getStats();
	const all = store.getAllEntries();

	// Recent memories (last 5)
	const recent = [...all]
		.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
		.slice(0, 5);

	// Top confidence memories
	const topConfidence = [...all].sort((a, b) => b.confidence - a.confidence).slice(0, 5);

	// Linked count
	const linkedCount = all.filter((e) => (e.relatedKeys ?? []).length > 0).length;

	// Namespace bar
	const nsTotal = Object.values(stats.byNamespace).reduce((a, b) => a + b, 0) || 1;
	const nsBar = Object.entries(stats.byNamespace)
		.sort(([, a], [, b]) => b - a)
		.map(([ns, count]) => {
			const pct = Math.round((count / nsTotal) * 20);
			const bar = "█".repeat(pct) + "░".repeat(20 - pct);
			return `  ${ns.padEnd(12)} ${bar} ${count}`;
		})
		.join("\n");

	// Type distribution
	const typeTotal = Object.values(stats.byType).reduce((a, b) => a + b, 0) || 1;
	const typeBar = Object.entries(stats.byType)
		.sort(([, a], [, b]) => b - a)
		.map(([t, count]) => {
			const pct = Math.round((count / typeTotal) * 20);
			const bar = "█".repeat(pct) + "░".repeat(20 - pct);
			return `  ${t.padEnd(12)} ${bar} ${count}`;
		})
		.join("\n");

	const lines = [
		`╔══════════════════════════════════════╗`,
		`║      🧠  MEMORY DASHBOARD           ║`,
		`╚══════════════════════════════════════╝`,
		``,
		`📊 Overview`,
		`  Total:     ${stats.total} entries`,
		`  Linked:    ${linkedCount} entries have relationships`,
		`  Orphans:   ${stats.total - linkedCount} entries (no links)`,
		``,
		`📂 Namespace Distribution`,
		nsBar,
		``,
		`🏷️ Type Distribution`,
		typeBar,
		``,
		`🕐 Recent Memories`,
		...recent.map((e) => `  [${e.namespace}] ${e.key}: ${e.summary?.slice(0, 60) ?? e.title.slice(0, 60)}`),
		``,
		`⭐ Top Confidence`,
		...topConfidence.map((e) => `  ${(e.confidence * 100).toFixed(0)}% ${e.key}: ${e.title.slice(0, 50)}`),
		``,
		`💡 Tips`,
		`  • Use /memory search <query> to find memories`,
		`  • Use /memory graph <key> to see relationships`,
		`  • Use /memory maintain to clean up`,
		`  • Use /memory llm for LLM extractor status`,
	].join("\n");

	if (ctx.hasUI) {
		await ctx.ui.editor("🧠 Memory Dashboard", lines);
	} else {
		ctx.ui.notify(lines, "info");
	}
}

// ============================================================================
// /memory graph <key> — relationship tree
// ============================================================================

async function handleGraph(store: MemoryStore, args: string[], ctx: any): Promise<void> {
	if (args.length === 0) {
		ctx.ui.notify("Usage: /memory graph <key>", "warning");
		return;
	}

	const rootKey = args[0];
	const root = store.getEntryByKey(rootKey);

	if (!root) {
		ctx.ui.notify(`❌ Memory with key "${rootKey}" not found`, "error");
		return;
	}

	const visited = new Set<string>();
	const lines: string[] = [];
	lines.push(`🧠 Memory Graph: ${rootKey}`);
	lines.push(`   "${root.title}"`);
	lines.push(`   [${root.namespace}/${root.type}] — confidence: ${(root.confidence * 100).toFixed(0)}%`);
	lines.push("");

	// Render tree (2 levels deep)
	renderGraphNode(store, root, 0, 2, visited, lines, true);

	if (lines.length <= 4) {
		lines.push("  (no related memories)");
		lines.push("");
		lines.push("  💡 Use /memory maintain to auto-link related memories");
	}

	if (ctx.hasUI) {
		await ctx.ui.editor(`Graph: ${rootKey}`, lines.join("\n"));
	} else {
		ctx.ui.notify(lines.join("\n"), "info");
	}
}

function renderGraphNode(
	store: MemoryStore,
	entry: any,
	depth: number,
	maxDepth: number,
	visited: Set<string>,
	lines: string[],
	isRoot: boolean,
): void {
	if (depth > maxDepth) return;
	if (visited.has(entry.key)) {
		if (!isRoot) lines.push(`${"  ".repeat(depth)}  ↺ ${entry.key} (already shown)`);
		return;
	}
	visited.add(entry.key);

	const relatedKeys = entry.relatedKeys ?? [];
	if (relatedKeys.length === 0) return;

	for (let i = 0; i < relatedKeys.length; i++) {
		const relKey = relatedKeys[i];
		const isLast = i === relatedKeys.length - 1;
		const prefix = isLast ? "└── " : "├── ";
		const childPrefix = isLast ? "    " : "│   ";

		const related = store.getEntryByKey(relKey);
		if (!related) {
			lines.push(`${depth > 0 ? "  ".repeat(depth) : ""}${prefix}❓ ${relKey} (not found)`);
			continue;
		}

		const relationSymbol = related.namespace === entry.namespace ? "→" : "↷";
		lines.push(
			`${depth > 0 ? "  ".repeat(depth) : ""}${prefix}${relationSymbol} [${related.namespace}] ${related.key}`,
		);
		lines.push(`${depth > 0 ? "  ".repeat(depth) : ""}${childPrefix}  "${related.title.slice(0, 50)}"`);

		if (!isRoot) {
			renderGraphNode(store, related, depth + 1, maxDepth, visited, lines, false);
		}
	}
}
