/**
 * Static/source contract: tool names, layout constants, injection entry points.
 * Asserts the SHIPPED createAgentSession default path (sdk.ts), not dead fallbacks.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_ACTIVE_TOOL_NAMES } from "../sdk.js";
import {
	DEFAULT_CODEX_MEMORY_ACTIVE_TOOL_NAMES,
	allTools,
	codexMemoryTools,
} from "../tools/index.js";
import {
	AD_HOC_NOTES_REL,
	MEMORIES_ADD_AD_HOC_NOTE,
	MEMORIES_HOME_DIRNAME,
	MEMORIES_LIST,
	MEMORIES_READ,
	MEMORIES_SEARCH,
} from "./constants.js";
import { LocalMemoriesBackend } from "./local-backend.js";
import { buildMemoryToolDeveloperInstructions } from "./prompts.js";

const here = dirname(fileURLToPath(import.meta.url));
const codingAgentSrc = join(here, "../..");

describe("Codex memories source contract", () => {
	it("registers four flat tool names matching Codex memories namespace", () => {
		expect(MEMORIES_LIST).toBe("memories_list");
		expect(MEMORIES_READ).toBe("memories_read");
		expect(MEMORIES_SEARCH).toBe("memories_search");
		expect(MEMORIES_ADD_AD_HOC_NOTE).toBe("memories_add_ad_hoc_note");
		expect(DEFAULT_CODEX_MEMORY_ACTIVE_TOOL_NAMES).toEqual([
			MEMORIES_LIST,
			MEMORIES_READ,
			MEMORIES_SEARCH,
			MEMORIES_ADD_AD_HOC_NOTE,
		]);
		for (const name of DEFAULT_CODEX_MEMORY_ACTIVE_TOOL_NAMES) {
			expect(codexMemoryTools[name]).toBeDefined();
			expect(allTools[name]).toBeDefined();
		}
	});

	it("layout constants match Codex store shape", () => {
		expect(MEMORIES_HOME_DIRNAME).toBe("memories");
		expect(AD_HOC_NOTES_REL).toEqual(["extensions", "ad_hoc", "notes"]);
	});

	it("createAgentSession DEFAULT_SESSION_ACTIVE_TOOL_NAMES includes memories_* (real entry path)", () => {
		// This is the list used when options.tools is omitted (desktop/CLI runtime).
		for (const name of [
			MEMORIES_LIST,
			MEMORIES_READ,
			MEMORIES_SEARCH,
			MEMORIES_ADD_AD_HOC_NOTE,
		] as const) {
			expect(DEFAULT_SESSION_ACTIVE_TOOL_NAMES).toContain(name);
			expect(name in allTools).toBe(true);
		}
		// sdk.ts must reference the exported default (not a stale private copy).
		const sdkSrc = readFileSync(join(codingAgentSrc, "core/sdk.ts"), "utf-8");
		expect(sdkSrc).toContain("DEFAULT_SESSION_ACTIVE_TOOL_NAMES");
		expect(sdkSrc).toContain("DEFAULT_CODEX_MEMORY_ACTIVE_TOOL_NAMES");
		expect(sdkSrc).toMatch(/initialActiveToolNames[\s\S]*DEFAULT_SESSION_ACTIVE_TOOL_NAMES/);
	});

	it("agent-session fallback and session-start hook still reference memories", () => {
		const sessionSrc = readFileSync(join(codingAgentSrc, "core/agent-session.ts"), "utf-8");
		expect(sessionSrc).toContain("memories_list");
		expect(sessionSrc).toContain("runMemoryStartup");
	});

	it("resource-loader injects buildMemoryToolDeveloperInstructions", () => {
		const loader = readFileSync(join(codingAgentSrc, "core/resource-loader.ts"), "utf-8");
		expect(loader).toContain("buildMemoryToolDeveloperInstructions");
		expect(loader).toContain("LocalMemoriesBackend");
	});

	it("buildMemoryToolDeveloperInstructions embeds summary and tool names", () => {
		const root = mkdtempSync(join(tmpdir(), "quake-mem-prompt-"));
		try {
			const b = new LocalMemoriesBackend(root);
			b.ensureRoot();
			const text = buildMemoryToolDeveloperInstructions(root);
			expect(text).toBeDefined();
			expect(text).toContain("memories_search");
			expect(text).toContain("MEMORY_SUMMARY");
			expect(text).toContain("memory_summary.md");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
