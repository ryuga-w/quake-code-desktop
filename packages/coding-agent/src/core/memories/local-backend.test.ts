import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalMemoriesBackend, makeAdHocFilename, validateAdHocFilename } from "./local-backend.js";
import { MemoriesError } from "./types.js";

describe("Codex LocalMemoriesBackend", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const d of dirs) {
			try {
				rmSync(d, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
		dirs.length = 0;
	});

	function tempBackend() {
		const root = mkdtempSync(join(tmpdir(), "quake-memories-"));
		dirs.push(root);
		return new LocalMemoriesBackend(root);
	}

	it("seeds MEMORY.md and memory_summary.md plus layout dirs", () => {
		const b = tempBackend();
		b.ensureRoot();
		const list = b.list({ max_results: 50 });
		const names = list.entries.map((e) => e.path);
		expect(names).toContain("MEMORY.md");
		expect(names).toContain("memory_summary.md");
		expect(names).toContain("rollout_summaries");
		expect(names).toContain("skills");
		expect(names).toContain("extensions");
		expect(names).toContain("stage1");
	});

	it("adds ad-hoc note with Codex filename rules", () => {
		const b = tempBackend();
		const filename = makeAdHocFilename("prefer-tabs");
		validateAdHocFilename(filename);
		const res = b.addAdHocNote({
			filename,
			note: "# Prefer tabs\n\nUser wants tabs in this project.\n",
		});
		expect(res.path).toContain("extensions/ad_hoc/notes/");
		const listed = b.list({ path: "extensions/ad_hoc/notes", max_results: 20 });
		expect(listed.entries.some((e) => e.path.endsWith(filename))).toBe(true);
		const read = b.read({ path: res.path, line_offset: 1, max_tokens: 2000 });
		expect(read.content).toContain("Prefer tabs");
	});

	it("rejects invalid ad-hoc filenames", () => {
		expect(() => validateAdHocFilename("note.md")).toThrow(MemoriesError);
		expect(() => validateAdHocFilename("2026-01-01T00-00-00-BadSlug.md")).toThrow(MemoriesError);
		expect(() => validateAdHocFilename("2026-01-01T00-00-00-ok.txt")).toThrow(MemoriesError);
	});

	it("searches memory files (any mode)", () => {
		const b = tempBackend();
		const filename = makeAdHocFilename("search-me");
		b.addAdHocNote({ filename, note: "UniqueTokenXYZ for search test\n" });
		const found = b.search({
			queries: ["UniqueTokenXYZ"],
			match_mode: { type: "any" },
			context_lines: 1,
			case_sensitive: true,
			normalized: false,
			max_results: 50,
		});
		expect(found.matches.length).toBeGreaterThan(0);
		expect(found.matches[0].content).toContain("UniqueTokenXYZ");
		expect(found.truncated).toBe(false);
	});

	it("match_mode all_on_same_line requires every query on one line", () => {
		const b = tempBackend();
		const filename = makeAdHocFilename("same-line");
		b.addAdHocNote({
			filename,
			note: "alpha and beta together\ngamma alone\n",
		});
		const hit = b.search({
			queries: ["alpha", "beta"],
			match_mode: { type: "all_on_same_line" },
			context_lines: 0,
			case_sensitive: true,
			normalized: false,
			max_results: 50,
		});
		expect(hit.matches.length).toBeGreaterThan(0);
		expect(hit.matches[0].matched_queries).toEqual(["alpha", "beta"]);

		const miss = b.search({
			queries: ["alpha", "gamma"],
			match_mode: { type: "all_on_same_line" },
			context_lines: 0,
			case_sensitive: true,
			normalized: false,
			max_results: 50,
		});
		expect(miss.matches.length).toBe(0);
	});

	it("match_mode all_within_lines matches across a window", () => {
		const b = tempBackend();
		const filename = makeAdHocFilename("within-lines");
		b.addAdHocNote({
			filename,
			note: "line with FOO\nline with BAR\n",
		});
		const hit = b.search({
			queries: ["FOO", "BAR"],
			match_mode: { type: "all_within_lines", line_count: 2 },
			context_lines: 0,
			case_sensitive: true,
			normalized: false,
			max_results: 50,
		});
		expect(hit.matches.length).toBeGreaterThan(0);
	});

	it("reads with line_offset", () => {
		const b = tempBackend();
		b.ensureRoot();
		const r = b.read({ path: "MEMORY.md", line_offset: 1, max_lines: 2, max_tokens: 500 });
		expect(r.start_line_number).toBe(1);
		expect(r.content.split("\n").length).toBeLessThanOrEqual(2);
		expect(typeof r.truncated).toBe("boolean");
	});

	it("rejects path traversal and absolute paths", () => {
		const b = tempBackend();
		b.ensureRoot();
		expect(() => b.list({ path: "../outside", max_results: 10 })).toThrow(MemoriesError);
		expect(() => b.read({ path: "foo/../../etc/passwd", line_offset: 1, max_tokens: 100 })).toThrow(
			MemoriesError,
		);
		expect(() => b.search({
			queries: ["x"],
			match_mode: { type: "any" },
			path: "/etc",
			context_lines: 0,
			case_sensitive: true,
			normalized: false,
			max_results: 10,
		})).toThrow(MemoriesError);
		expect(() => b.list({ path: "C:\\Windows", max_results: 10 })).toThrow(MemoriesError);
	});

	it("rejects empty search query", () => {
		const b = tempBackend();
		b.ensureRoot();
		expect(() =>
			b.search({
				queries: ["  "],
				match_mode: { type: "any" },
				context_lines: 0,
				case_sensitive: true,
				normalized: false,
				max_results: 10,
			}),
		).toThrow(MemoriesError);
	});

	it("list pagination exposes next_cursor and truncated", () => {
		const b = tempBackend();
		const notesDir = join(b.root, "extensions", "ad_hoc", "notes");
		mkdirSync(notesDir, { recursive: true });
		for (let i = 0; i < 5; i += 1) {
			const name = makeAdHocFilename(`n${i}`, new Date(2026, 0, 1, 0, 0, i));
			writeFileSync(join(notesDir, name), `note ${i}\n`, "utf-8");
		}
		const page1 = b.list({ path: "extensions/ad_hoc/notes", max_results: 2 });
		expect(page1.entries.length).toBe(2);
		expect(page1.truncated).toBe(true);
		expect(page1.next_cursor).toBe("2");
		const page2 = b.list({ path: "extensions/ad_hoc/notes", max_results: 2, cursor: page1.next_cursor });
		expect(page2.entries.length).toBe(2);
	});
});
