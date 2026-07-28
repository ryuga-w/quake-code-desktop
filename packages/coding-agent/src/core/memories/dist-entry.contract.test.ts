/**
 * Contract against the SHIPPED package entry (dist/), not just src.
 * Fails if someone updates src but forgets `npm run build` — AC1 gating path.
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "../../..");
const distSdk = join(pkgRoot, "dist/core/sdk.js");
const distTools = join(pkgRoot, "dist/core/tools/index.js");
const distMemories = join(pkgRoot, "dist/core/memories/index.js");
const distCodexTools = join(pkgRoot, "dist/core/tools/codex-memory-tools.js");

const NEED = [
	"memories_list",
	"memories_read",
	"memories_search",
	"memories_add_ad_hoc_note",
] as const;

describe("shipped dist entry (createAgentSession package path)", () => {
	it("dist artifacts exist after build", () => {
		expect(existsSync(distSdk), "dist/core/sdk.js missing — run npm run build").toBe(true);
		expect(existsSync(distTools), "dist/core/tools/index.js missing").toBe(true);
		expect(existsSync(distMemories), "dist/core/memories missing").toBe(true);
		expect(existsSync(distCodexTools), "dist codex-memory-tools.js missing").toBe(true);
	});

	it("DEFAULT_SESSION_ACTIVE_TOOL_NAMES from dist includes all memories_*", async () => {
		const sdk = await import(pathToFileURL(distSdk).href);
		const names: string[] = sdk.DEFAULT_SESSION_ACTIVE_TOOL_NAMES;
		expect(Array.isArray(names)).toBe(true);
		for (const n of NEED) {
			expect(names).toContain(n);
		}
	});

	it("dist allTools registry includes memories_* handlers", async () => {
		const tools = await import(pathToFileURL(distTools).href);
		for (const n of NEED) {
			expect(tools.allTools[n], `allTools.${n}`).toBeDefined();
		}
		expect(tools.codexMemoryTools).toBeDefined();
		for (const n of NEED) {
			expect(tools.codexMemoryTools[n]).toBeDefined();
		}
	});

	it("dist LocalMemoriesBackend + citations + phase + extensions helpers are importable", async () => {
		const mem = await import(pathToFileURL(distMemories).href);
		expect(typeof mem.LocalMemoriesBackend).toBe("function");
		expect(typeof mem.runPhase1).toBe("function");
		expect(typeof mem.runPhase2).toBe("function");
		expect(typeof mem.parseMemoryCitation).toBe("function");
		expect(typeof mem.buildMemoryToolDeveloperInstructions).toBe("function");
		expect(typeof mem.runMemoryStartup).toBe("function");
		expect(typeof mem.seedAdHocInstructions).toBe("function");
		expect(typeof mem.pruneOldExtensionResources).toBe("function");
		expect(typeof mem.clearMemoryRootContents).toBe("function");
		expect(typeof mem.rateLimitsOk).toBe("function");
		expect(typeof mem.prepareMemoryWorkspace).toBe("function");
		expect(typeof mem.runPhase1Async).toBe("function");
		expect(typeof mem.runMemoryStartupAsync).toBe("function");
		expect(typeof mem.rebuildFromStage1Dir).toBe("function");
		expect(typeof mem.threadIdsFromMemoryCitation).toBe("function");
		expect(existsSync(join(pkgRoot, "dist/core/memories/extensions.js"))).toBe(true);
		expect(existsSync(join(pkgRoot, "dist/core/memories/workspace.js"))).toBe(true);
		expect(existsSync(join(pkgRoot, "dist/core/memories/guard.js"))).toBe(true);
		expect(existsSync(join(pkgRoot, "dist/core/memories/write-prompts.js"))).toBe(true);
	});
});
