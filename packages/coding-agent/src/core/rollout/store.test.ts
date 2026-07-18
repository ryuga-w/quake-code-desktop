import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RolloutStore, listRolloutFiles, writeRolloutIndex } from "./store.js";

describe("rollout store", () => {
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

	it("appends and reads events", () => {
		const root = mkdtempSync(join(tmpdir(), "quake-roll-"));
		dirs.push(root);
		const store = new RolloutStore({ rootDir: root, sessionId: "sess-1" });
		store.append("session_start", { cwd: "/x" });
		store.append("tool_call", { name: "bash" });
		const all = store.readAll();
		expect(all).toHaveLength(2);
		expect(all[0].type).toBe("session_start");
		const sum = store.summary();
		expect(sum.events).toBe(2);
		expect(sum.types.tool_call).toBe(1);
		writeRolloutIndex(root);
		expect(listRolloutFiles(root).length).toBeGreaterThan(0);
	});
});
