import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system-prompt.js";
import { DEFAULT_SESSION_ACTIVE_TOOL_NAMES } from "./sdk.js";
import { ALL_BUILTIN_TOOL_NAMES, allTools } from "./tools/index.js";

const FULL_CORE = [
	"read",
	"bash",
	"edit",
	"write",
	"apply_patch",
	"grep",
	"find",
	"ls",
	"web_search",
	"web_open_page",
	"web_find_in_page",
	"generate_image",
	"generate_video",
] as const;

describe("buildSystemPrompt — ALL tools always present", () => {
	it("lists full core set including web_search even when snippets are missing", () => {
		const prompt = buildSystemPrompt({
			selectedTools: [...FULL_CORE],
			toolSnippets: {},
		});
		for (const name of FULL_CORE) {
			expect(prompt).toContain(`- ${name}:`);
		}
		expect(prompt).toContain("## Core tools");
		expect(prompt).toContain("### web_search");
		expect(prompt).toContain("### generate_image");
		expect(prompt).toContain("*** Begin Patch");
		expect(prompt).toContain("call web_search immediately");
	});

	it("injects core tools into custom system prompts", () => {
		const prompt = buildSystemPrompt({
			customPrompt: "You are a custom agent.",
			selectedTools: [],
		});
		expect(prompt).toContain("## Core tools");
		expect(prompt).toContain("### bash");
		expect(prompt).toContain("### web_search");
		expect(prompt).toContain("*** Begin Patch");
	});

	it("DEFAULT_SESSION_ACTIVE_TOOL_NAMES === every allTools key (including web + media)", () => {
		const all = Object.keys(allTools).sort();
		const def = [...DEFAULT_SESSION_ACTIVE_TOOL_NAMES].sort();
		expect(def).toEqual(all);
		expect(ALL_BUILTIN_TOOL_NAMES.sort()).toEqual(all);
		for (const name of FULL_CORE) {
			expect(DEFAULT_SESSION_ACTIVE_TOOL_NAMES).toContain(name);
			expect(name in allTools).toBe(true);
		}
	});
});
