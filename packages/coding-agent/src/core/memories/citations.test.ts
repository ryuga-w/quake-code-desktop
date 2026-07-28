import { describe, expect, it } from "vitest";
import {
	answerHasMemoryCitation,
	attachMemoryCitationIfNeeded,
	emitMemoryCitation,
	extractMemoryCitationFromAnswer,
	parseMemoryCitation,
	parseMemoryCitationEntry,
} from "./citations.js";

describe("memory citations (Codex read/citations)", () => {
	it("parseMemoryCitationEntry parses path:start-end|note=[…]", () => {
		const e = parseMemoryCitationEntry("MEMORY.md:1-2|note=[summary]");
		expect(e).toEqual({
			path: "MEMORY.md",
			line_start: 1,
			line_end: 2,
			note: "summary",
		});
	});

	it("rejects empty or malformed entry lines", () => {
		expect(parseMemoryCitationEntry("")).toBeUndefined();
		expect(parseMemoryCitationEntry("MEMORY.md:1-2")).toBeUndefined();
		expect(parseMemoryCitationEntry("nope")).toBeUndefined();
	});

	it("parseMemoryCitation supports memory_citation + rollout_ids", () => {
		const blob = `<memory_citation>
<citation_entries>
MEMORY.md:1-2|note=[summary]
rollout_summaries/foo.md:10-12|note=[details]
</citation_entries>
<rollout_ids>
thread-a
thread-b
thread-a
</rollout_ids>
</memory_citation>`;
		const parsed = parseMemoryCitation([blob]);
		expect(parsed).toBeDefined();
		expect(parsed!.entries).toHaveLength(2);
		expect(parsed!.entries[0]).toMatchObject({ path: "MEMORY.md", note: "summary" });
		expect(parsed!.rollout_ids).toEqual(["thread-a", "thread-b"]);
	});

	it("parseMemoryCitation supports legacy thread_ids and oai-mem-citation", () => {
		const blob = `<oai-mem-citation>
<citation_entries>
MEMORY.md:3-4|note=[x]
</citation_entries>
<thread_ids>
uuid-one
not-empty
</thread_ids>
</oai-mem-citation>`;
		const parsed = extractMemoryCitationFromAnswer(`Answer text.\n\n${blob}`);
		expect(parsed?.entries[0]?.line_start).toBe(3);
		expect(parsed?.rollout_ids).toEqual(["uuid-one", "not-empty"]);
	});

	it("returns undefined for empty citations", () => {
		expect(parseMemoryCitation([])).toBeUndefined();
		expect(parseMemoryCitation(["no markers here"])).toBeUndefined();
	});

	it("emitMemoryCitation round-trips", () => {
		const emitted = emitMemoryCitation({
			entries: [{ path: "MEMORY.md", line_start: 1, line_end: 2, note: "n" }],
			rollout_ids: ["rid-1"],
		});
		expect(emitted).toContain("<oai-mem-citation>");
		expect(emitted).toContain("MEMORY.md:1-2|note=[n]");
		const again = parseMemoryCitation([emitted]);
		expect(again?.entries[0]?.note).toBe("n");
		expect(again?.rollout_ids).toEqual(["rid-1"]);
	});

	it("attachMemoryCitationIfNeeded appends only when missing", () => {
		const citation = {
			entries: [{ path: "MEMORY.md", line_start: 1, line_end: 1, note: "used" }],
			rollout_ids: [] as string[],
		};
		const first = attachMemoryCitationIfNeeded("Final answer.", citation);
		expect(answerHasMemoryCitation(first)).toBe(true);
		const second = attachMemoryCitationIfNeeded(first, citation);
		expect(second).toBe(first);
	});
});
