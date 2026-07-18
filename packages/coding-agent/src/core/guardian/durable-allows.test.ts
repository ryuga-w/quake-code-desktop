/**
 * Durable guardian always-allow store: load / save / remove / clear across "restarts".
 * Session clear must NOT wipe durable (covered via clearMemory only via clearDurable).
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearDurableGuardianAllows,
	configureGuardianAlwaysStore,
	flushGuardianAlwaysWrites,
	isGuardianAlwaysCommandKey,
	isGuardianAlwaysHostAllowed,
	isGuardianAlwaysHostDenied,
	listDurableGuardianAllows,
	loadDurableGuardianAllows,
	matchesGuardianAlwaysPrefix,
	rememberGuardianAlwaysCommandKey,
	rememberGuardianAlwaysHost,
	rememberGuardianAlwaysPrefix,
	removeGuardianAlwaysCommandKey,
	removeGuardianAlwaysHost,
	removeGuardianAlwaysPrefix,
} from "./durable-allows.js";
import { guardianRuntime } from "./runtime.js";
import { sessionNetworkPolicy } from "../network-policy/index.js";
import { tokenizeCommand } from "../execpolicy/policy.js";

describe("guardian durable always-allows", () => {
	let storePath = "";

	beforeEach(async () => {
		const dir = await mkdtemp(join(tmpdir(), "quake-guardian-always-"));
		storePath = join(dir, "guardian-always.json");
		configureGuardianAlwaysStore({ path: storePath, resetMemory: true });
		await loadDurableGuardianAllows(storePath);
		guardianRuntime.clearSessionApprovals();
		guardianRuntime.setPreset("auto");
		guardianRuntime.setUiHandler(undefined);
	});

	afterEach(async () => {
		clearDurableGuardianAllows();
		guardianRuntime.clearSessionApprovals();
		await flushGuardianAlwaysWrites();
		configureGuardianAlwaysStore({
			path: join(tmpdir(), "quake-guardian-always-disabled.json"),
			resetMemory: true,
		});
	});

	it("write-through remember survives load (restart simulation)", async () => {
		rememberGuardianAlwaysCommandKey("bash::sudo ls");
		rememberGuardianAlwaysPrefix(["npm", "test"]);
		rememberGuardianAlwaysHost("example.com", "allow");
		rememberGuardianAlwaysHost("evil.test", "deny");
		await flushGuardianAlwaysWrites();

		expect(isGuardianAlwaysCommandKey("bash::sudo ls")).toBe(true);
		expect(matchesGuardianAlwaysPrefix(tokenizeCommand("npm test --watch"))).toBe(true);
		expect(isGuardianAlwaysHostAllowed("example.com")).toBe(true);
		expect(isGuardianAlwaysHostDenied("evil.test")).toBe(true);

		// Simulate process restart: new memory + load from same file
		configureGuardianAlwaysStore({ path: storePath, resetMemory: true });
		expect(isGuardianAlwaysCommandKey("bash::sudo ls")).toBe(false);
		expect(isGuardianAlwaysHostAllowed("example.com")).toBe(false);

		await loadDurableGuardianAllows(storePath);
		expect(isGuardianAlwaysCommandKey("bash::sudo ls")).toBe(true);
		expect(matchesGuardianAlwaysPrefix(tokenizeCommand("npm test foo"))).toBe(true);
		expect(isGuardianAlwaysHostAllowed("example.com")).toBe(true);
		expect(isGuardianAlwaysHostDenied("evil.test")).toBe(true);

		const onDisk = JSON.parse(await readFile(storePath, "utf8"));
		expect(onDisk.version).toBe(1);
		expect(onDisk.commandKeys).toEqual(["bash::sudo ls"]);
		expect(onDisk.prefixes).toEqual([["npm", "test"]]);
		expect(onDisk.hosts.allow).toEqual(["example.com"]);
		expect(onDisk.hosts.deny).toEqual(["evil.test"]);
	});

	it("list / remove one / clear all update disk", async () => {
		rememberGuardianAlwaysCommandKey("bash::a");
		rememberGuardianAlwaysCommandKey("bash::b");
		rememberGuardianAlwaysPrefix(["git", "status"]);
		rememberGuardianAlwaysHost("api.example", "allow");
		await flushGuardianAlwaysWrites();

		const listed = listDurableGuardianAllows();
		expect(listed.commandKeys.sort()).toEqual(["bash::a", "bash::b"]);
		expect(listed.prefixes).toEqual([["git", "status"]]);
		expect(listed.hosts.allow).toEqual(["api.example"]);

		expect(removeGuardianAlwaysCommandKey("bash::a")).toBe(true);
		expect(removeGuardianAlwaysCommandKey("bash::a")).toBe(false);
		expect(removeGuardianAlwaysPrefix(["git", "status"])).toBe(true);
		expect(removeGuardianAlwaysHost("api.example", "allow")).toBe(true);
		await flushGuardianAlwaysWrites();

		expect(isGuardianAlwaysCommandKey("bash::a")).toBe(false);
		expect(isGuardianAlwaysCommandKey("bash::b")).toBe(true);
		const disk = JSON.parse(await readFile(storePath, "utf8"));
		expect(disk.commandKeys).toEqual(["bash::b"]);
		expect(disk.prefixes).toEqual([]);
		expect(disk.hosts.allow).toEqual([]);

		clearDurableGuardianAllows();
		await flushGuardianAlwaysWrites();
		expect(listDurableGuardianAllows()).toEqual({
			commandKeys: [],
			prefixes: [],
			hosts: { allow: [], deny: [] },
		});
		expect(JSON.parse(await readFile(storePath, "utf8")).commandKeys).toEqual([]);
	});

	it("clearSessionApprovals does not touch durable always", async () => {
		rememberGuardianAlwaysCommandKey("bash::always");
		guardianRuntime.rememberSessionApproval("bash", "session-only");
		guardianRuntime.rememberSessionPrefixAllow(["rm"]);
		sessionNetworkPolicy.allowHost("session.host");
		rememberGuardianAlwaysHost("durable.host", "allow");
		await flushGuardianAlwaysWrites();

		guardianRuntime.clearSessionApprovals();

		expect(isGuardianAlwaysCommandKey("bash::always")).toBe(true);
		expect(isGuardianAlwaysHostAllowed("durable.host")).toBe(true);
		// session pieces gone
		expect(guardianRuntime.isSessionApproved("bash", "session-only")).toBe(false);
		// durable still counts as approved via isSessionApproved hybrid check
		expect(guardianRuntime.isSessionApproved("bash", "always")).toBe(true);
		// session network cleared but durable host still evaluates allow
		expect(sessionNetworkPolicy.evaluateHost("durable.host")).toBe("allow");
		expect(sessionNetworkPolicy.snapshot().allowed).toEqual([]);
		expect(JSON.parse(await readFile(storePath, "utf8")).commandKeys).toEqual(["bash::always"]);
	});

	it("acceptAlways write-through + restart still auto-allows", async () => {
		guardianRuntime.setPreset("auto");
		guardianRuntime.setUiHandler(async () => "acceptAlways");
		const first = await guardianRuntime.requestApproval({
			tool: "bash",
			summary: "sudo unique-always-key",
			risk: "high",
			needsPrompt: true,
		});
		expect(first.allow).toBe(true);
		expect(first.decision).toBe("acceptAlways");
		await flushGuardianAlwaysWrites();

		// restart durable memory
		configureGuardianAlwaysStore({ path: storePath, resetMemory: true });
		await loadDurableGuardianAllows(storePath);
		guardianRuntime.clearSessionApprovals();

		guardianRuntime.setUiHandler(async () => {
			throw new Error("should not prompt — durable key");
		});
		const second = await guardianRuntime.requestApproval({
			tool: "bash",
			summary: "sudo unique-always-key",
			risk: "high",
			needsPrompt: true,
		});
		expect(second.allow).toBe(true);
		expect(second.decision).toBe("auto");
		expect(second.reason).toMatch(/durable|always/i);
	});

	it("memory-only mode (no load) does not write disk", async () => {
		configureGuardianAlwaysStore({ path: storePath, resetMemory: true });
		// no loadDurableGuardianAllows → persistEnabled false
		rememberGuardianAlwaysCommandKey("x::y");
		clearDurableGuardianAllows();
		await flushGuardianAlwaysWrites();
		await expect(readFile(storePath, "utf8")).rejects.toThrow();
	});
});
