import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildMemoryInjectionBlock,
	forgetEntry,
	listEntries,
	parseMemoryFile,
	rememberEntry,
	searchEntries,
} from "../src/core/memory/memory-store.js";

describe("memory-store", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "quake-mem-"));

	it("parses frontmatter entries", () => {
		const raw = `---
name: test-entry
description: A test
type: fact
scope: project
---
Hello world
`;
		const entries = parseMemoryFile(raw, "project");
		expect(entries).toHaveLength(1);
		expect(entries[0]?.name).toBe("test-entry");
		expect(entries[0]?.content).toBe("Hello world");
	});

	it("remembers and recalls entries", () => {
		rememberEntry("default-agent", cwd, {
			name: "prefer-tr",
			description: "Turkish UI",
			content: "User prefers Turkish responses",
			scope: "user",
			type: "preference",
			overwrite: true,
		});
		const hits = searchEntries("default-agent", cwd, "turkish");
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0]?.name).toBe("prefer-tr");
	});

	it("forgets entries", () => {
		rememberEntry("default-agent", cwd, {
			name: "temp",
			description: "temp",
			content: "remove me",
			scope: "session",
			type: "session",
			overwrite: true,
		});
		expect(forgetEntry("default-agent", cwd, "temp", "session")).toBe(true);
		expect(listEntries("default-agent", cwd, { scope: "session" })).toHaveLength(0);
	});

	it("builds injection block with scopes", () => {
		const block = buildMemoryInjectionBlock("default-agent", cwd);
		expect(block).toContain("Persistent Memory");
		expect(block).toContain("user memory");
	});
});
