import { describe, expect, it } from "vitest";
import { normalizeSearchQuery, normalizeWebSearchResults, WebSearchRuntimeError } from "../src/core/tools/web-runtime.js";

describe("web runtime normalization", () => {
	it("normalizes equivalent search queries", () => {
		expect(normalizeSearchQuery("  Quake Code?!  Web   Search ")).toBe("quake code web search");
	});

	it("deduplicates URLs, strips trackers, and rejects invalid schemes", () => {
		const results = normalizeWebSearchResults([
			{ title: " First result ", url: "https://example.com/docs?utm_source=test#intro", snippet: "  Useful   docs  " },
			{ title: "Duplicate", url: "https://example.com/docs" },
			{ title: "Unsafe", url: "javascript:alert(1)" },
		]);
		expect(results).toEqual([
			{
				title: "First result",
				url: "https://example.com/docs",
				hostname: "example.com",
				snippet: "Useful docs",
			},
		]);
	});

	it("caps normalized results", () => {
		const items = Array.from({ length: 20 }, (_, index) => ({
			title: `Result ${index}`,
			url: `https://example${index}.com/`,
		}));
		expect(normalizeWebSearchResults(items, 4)).toHaveLength(4);
	});

	it("exposes typed runtime failures", () => {
		const error = new WebSearchRuntimeError("blocked", "Provider blocked", ["duckduckgo: captcha"]);
		expect(error.code).toBe("blocked");
		expect(error.diagnostics).toEqual(["duckduckgo: captcha"]);
	});
});
