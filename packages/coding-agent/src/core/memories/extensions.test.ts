import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	AD_HOC_INSTRUCTIONS,
	parseExtensionResourceTimestamp,
	pruneOldExtensionResources,
	seedAdHocInstructions,
	seedExtensionInstructions,
} from "./extensions.js";
import { runPhase2 } from "./phase2.js";

describe("Codex memory extensions (seed + prune)", () => {
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

	function tempRoot(): string {
		const root = mkdtempSync(join(tmpdir(), "quake-mem-ext-"));
		dirs.push(root);
		return root;
	}

	it("seeds ad-hoc instructions once without overwriting", () => {
		const root = tempRoot();
		const first = seedAdHocInstructions(root);
		expect(first.seeded).toBe(true);
		expect(existsSync(first.path)).toBe(true);
		const body = readFileSync(first.path, "utf-8");
		expect(body).toContain("Ad-hoc notes");
		expect(body).toContain("[ad-hoc note]");
		expect(body).toBe(AD_HOC_INSTRUCTIONS);

		writeFileSync(first.path, "custom instructions", "utf-8");
		const second = seedAdHocInstructions(root);
		expect(second.seeded).toBe(false);
		expect(readFileSync(first.path, "utf-8")).toBe("custom instructions");
	});

	it("seedExtensionInstructions creates notes dir layout", () => {
		const root = tempRoot();
		seedExtensionInstructions(root);
		expect(existsSync(join(root, "extensions", "ad_hoc", "instructions.md"))).toBe(true);
		expect(existsSync(join(root, "extensions", "ad_hoc", "notes"))).toBe(true);
	});

	it("parseExtensionResourceTimestamp reads Codex filename prefix", () => {
		const d = parseExtensionResourceTimestamp("2026-01-01T00-00-00-keep.md");
		expect(d).toBeDefined();
		expect(d!.toISOString().startsWith("2026-01-01T00:00:00")).toBe(true);
		expect(parseExtensionResourceTimestamp("not-a-ts.md")).toBeUndefined();
	});

	it("prunes only old resources under extensions with instructions.md", () => {
		const root = tempRoot();
		const chronicle = join(root, "extensions", "chronicle");
		const resources = join(chronicle, "resources");
		mkdirSync(resources, { recursive: true });
		writeFileSync(join(chronicle, "instructions.md"), "instructions\n", "utf-8");

		// 10 days old → prune
		writeFileSync(join(resources, "2026-01-01T00-00-00-old.md"), "old\n", "utf-8");
		// recent → keep
		writeFileSync(join(resources, "2026-07-10T12-00-00-new.md"), "new\n", "utf-8");
		// no timestamp → keep
		writeFileSync(join(resources, "readme.md"), "meta\n", "utf-8");

		// extension without instructions → resources ignored
		const bare = join(root, "extensions", "bare", "resources");
		mkdirSync(bare, { recursive: true });
		writeFileSync(join(bare, "2026-01-01T00-00-00-orphan.md"), "x\n", "utf-8");

		const now = new Date("2026-07-15T00:00:00.000Z");
		const result = pruneOldExtensionResources(root, now, 7);
		expect(result.pruned).toBe(1);
		expect(existsSync(join(resources, "2026-01-01T00-00-00-old.md"))).toBe(false);
		expect(existsSync(join(resources, "2026-07-10T12-00-00-new.md"))).toBe(true);
		expect(existsSync(join(resources, "readme.md"))).toBe(true);
		expect(existsSync(join(bare, "2026-01-01T00-00-00-orphan.md"))).toBe(true);
	});

	it("phase2 runs extension prune and reports pruned_extension_resources", () => {
		const root = tempRoot();
		const resources = join(root, "extensions", "chronicle", "resources");
		mkdirSync(resources, { recursive: true });
		writeFileSync(join(root, "extensions", "chronicle", "instructions.md"), "i\n", "utf-8");
		writeFileSync(join(resources, "2020-01-01T00-00-00-stale.md"), "stale\n", "utf-8");

		const p2 = runPhase2({
			memoriesRoot: root,
			now: Date.parse("2026-07-15T00:00:00.000Z"),
		});
		expect(p2.ok).toBe(true);
		expect(p2.pruned_extension_resources).toBe(1);
		expect(existsSync(join(resources, "2020-01-01T00-00-00-stale.md"))).toBe(false);
	});
});
