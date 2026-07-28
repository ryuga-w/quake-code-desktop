/**
 * Durable guardian allow-list (S-TRUST.1).
 *
 * File: ~/.quake-code/desktop/guardian-always.json
 * Shape:
 *   { "commandKeys": ["tool::summary"], "prefixes": [["npm","test"]], "hosts": { "allow": [], "deny": [] } }
 *
 * Session clear must NOT wipe this store — only clearDurableGuardianAllows / remove APIs do.
 * MCP always-allow is a separate store (mcp-always-allows.json).
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setExtraDurableHostChecker } from "../network-policy/durable-hosts.js";

export type GuardianDurableHosts = {
	allow: string[];
	deny: string[];
};

export type GuardianDurableSnapshot = {
	commandKeys: string[];
	prefixes: string[][];
	hosts: GuardianDurableHosts;
};

export type GuardianDurableFile = GuardianDurableSnapshot & {
	version: 1;
	updatedAt?: string;
};

/** Default durable path; overridable for tests via configureGuardianAlwaysStore. */
let storePath = join(homedir(), ".quake-code", "desktop", "guardian-always.json");
/** When false, remember/clear/remove only touch memory (safe for pure unit tests). */
let persistEnabled = false;
let pendingWrite: Promise<void> = Promise.resolve();

const commandKeys = new Set<string>();
const prefixes: string[][] = [];
const hostAllow = new Set<string>();
const hostDeny = new Set<string>();

export function defaultGuardianAlwaysPath(): string {
	return join(homedir(), ".quake-code", "desktop", "guardian-always.json");
}

export function getGuardianAlwaysStorePath(): string {
	return storePath;
}

/**
 * Configure durable store path. Resets memory when `resetMemory` is true.
 * Does not enable persistence until loadDurableGuardianAllows() is called.
 */
export function configureGuardianAlwaysStore(options: {
	path: string;
	resetMemory?: boolean;
}): void {
	storePath = options.path;
	persistEnabled = false;
	if (options.resetMemory !== false) {
		clearMemory();
	}
	wireNetworkDurableChecker();
}

/**
 * Compose guardian-always hosts into the S-NET durable network-hosts checker
 * (sessionNetworkPolicy consults both layers).
 */
function wireNetworkDurableChecker(): void {
	setExtraDurableHostChecker({
		isAllowed: isGuardianAlwaysHostAllowed,
		isDenied: isGuardianAlwaysHostDenied,
	});
}

// Wire once on module load so boot/import paths share host durable sources.
wireNetworkDurableChecker();

export function isGuardianAlwaysCommandKey(key: string): boolean {
	return commandKeys.has(key);
}

export function matchesGuardianAlwaysPrefix(tokens: string[]): boolean {
	if (!tokens.length || !prefixes.length) return false;
	return prefixes.some((prefix) => prefixMatchTokens(tokens, prefix));
}

export function isGuardianAlwaysHostAllowed(host: string): boolean {
	const h = normalizeHostLocal(host);
	if (!h) return false;
	for (const rule of hostAllow) {
		if (hostMatchesLocal(h, rule)) return true;
	}
	return false;
}

export function isGuardianAlwaysHostDenied(host: string): boolean {
	const h = normalizeHostLocal(host);
	if (!h) return false;
	for (const rule of hostDeny) {
		if (hostMatchesLocal(h, rule)) return true;
	}
	return false;
}

export function listDurableGuardianAllows(): GuardianDurableSnapshot {
	return {
		commandKeys: [...commandKeys].sort((a, b) => a.localeCompare(b, "en")),
		prefixes: prefixes.map((p) => [...p]),
		hosts: {
			allow: [...hostAllow].sort((a, b) => a.localeCompare(b, "en")),
			deny: [...hostDeny].sort((a, b) => a.localeCompare(b, "en")),
		},
	};
}

/**
 * Load durable always-allows from disk into memory and enable write-through.
 * Safe to call more than once; replaces in-memory durable sets from file.
 */
export async function loadDurableGuardianAllows(path?: string): Promise<GuardianDurableSnapshot> {
	if (path) storePath = path;
	await pendingWrite.catch(() => {});
	const data = await readGuardianAlwaysFromDisk(storePath);
	applySnapshotToMemory(data);
	persistEnabled = true;
	return listDurableGuardianAllows();
}

/** Hydrate memory from a snapshot without enabling persistence (tests / inject). */
export function hydrateDurableGuardianAllows(snapshot: GuardianDurableSnapshot): void {
	applySnapshotToMemory(normalizeSnapshot(snapshot));
}

export function rememberGuardianAlwaysCommandKey(key: string): void {
	const cleaned = String(key || "").trim();
	if (!cleaned || !cleaned.includes("::")) return;
	if (commandKeys.has(cleaned)) return;
	commandKeys.add(cleaned);
	schedulePersist();
}

export function rememberGuardianAlwaysPrefix(prefix: string[]): void {
	const cleaned = prefix.map((p) => String(p || "").trim()).filter(Boolean);
	if (!cleaned.length) return;
	const key = cleaned.join("\0");
	if (prefixes.some((p) => p.join("\0") === key)) return;
	prefixes.push(cleaned);
	schedulePersist();
}

export function rememberGuardianAlwaysHost(host: string, action: "allow" | "deny"): void {
	const h = normalizeHostLocal(host);
	if (!h) return;
	if (action === "deny") {
		hostAllow.delete(h);
		hostDeny.add(h);
	} else {
		hostDeny.delete(h);
		hostAllow.add(h);
	}
	schedulePersist();
}

export function removeGuardianAlwaysCommandKey(key: string): boolean {
	const cleaned = String(key || "").trim();
	const existed = commandKeys.delete(cleaned);
	if (existed) schedulePersist();
	return existed;
}

/** Remove one prefix by exact argv sequence (joined with spaces for API convenience). */
export function removeGuardianAlwaysPrefix(prefix: string[] | string): boolean {
	const cleaned = Array.isArray(prefix)
		? prefix.map((p) => String(p || "").trim()).filter(Boolean)
		: String(prefix || "")
				.trim()
				.split(/\s+/)
				.filter(Boolean);
	if (!cleaned.length) return false;
	const key = cleaned.join("\0");
	const idx = prefixes.findIndex((p) => p.join("\0") === key);
	if (idx < 0) return false;
	prefixes.splice(idx, 1);
	schedulePersist();
	return true;
}

export function removeGuardianAlwaysHost(host: string, action?: "allow" | "deny"): boolean {
	const h = normalizeHostLocal(host);
	if (!h) return false;
	let existed = false;
	if (!action || action === "allow") {
		if (hostAllow.delete(h)) existed = true;
	}
	if (!action || action === "deny") {
		if (hostDeny.delete(h)) existed = true;
	}
	if (existed) schedulePersist();
	return existed;
}

/** Clear only durable always-allows (memory + disk when persistence enabled). Does not touch session caches. */
export function clearDurableGuardianAllows(): void {
	const empty =
		commandKeys.size === 0 && prefixes.length === 0 && hostAllow.size === 0 && hostDeny.size === 0;
	clearMemory();
	if (!empty || persistEnabled) schedulePersist();
}

/** Await queued disk writes (tests / shutdown). */
export async function flushGuardianAlwaysWrites(): Promise<void> {
	await pendingWrite.catch(() => {});
}

function clearMemory(): void {
	commandKeys.clear();
	prefixes.length = 0;
	hostAllow.clear();
	hostDeny.clear();
}

function applySnapshotToMemory(data: GuardianDurableSnapshot): void {
	clearMemory();
	for (const key of data.commandKeys) {
		const cleaned = String(key || "").trim();
		if (cleaned.includes("::")) commandKeys.add(cleaned);
	}
	for (const prefix of data.prefixes) {
		const cleaned = (Array.isArray(prefix) ? prefix : [])
			.map((p) => String(p || "").trim())
			.filter(Boolean);
		if (!cleaned.length) continue;
		const key = cleaned.join("\0");
		if (prefixes.some((p) => p.join("\0") === key)) continue;
		prefixes.push(cleaned);
	}
	for (const host of data.hosts.allow) {
		const h = normalizeHostLocal(host);
		if (h) hostAllow.add(h);
	}
	for (const host of data.hosts.deny) {
		const h = normalizeHostLocal(host);
		if (h) {
			hostAllow.delete(h);
			hostDeny.add(h);
		}
	}
}

function normalizeSnapshot(raw: unknown): GuardianDurableSnapshot {
	if (!raw || typeof raw !== "object") {
		return { commandKeys: [], prefixes: [], hosts: { allow: [], deny: [] } };
	}
	const obj = raw as Record<string, unknown>;
	const commandKeysRaw = Array.isArray(obj.commandKeys) ? obj.commandKeys : [];
	const prefixesRaw = Array.isArray(obj.prefixes) ? obj.prefixes : [];
	const hostsRaw =
		obj.hosts && typeof obj.hosts === "object" ? (obj.hosts as Record<string, unknown>) : {};
	const allowRaw = Array.isArray(hostsRaw.allow) ? hostsRaw.allow : [];
	const denyRaw = Array.isArray(hostsRaw.deny) ? hostsRaw.deny : [];
	return {
		commandKeys: commandKeysRaw.filter((k): k is string => typeof k === "string"),
		prefixes: prefixesRaw
			.filter((p): p is unknown[] => Array.isArray(p))
			.map((p) => p.filter((t): t is string => typeof t === "string")),
		hosts: {
			allow: allowRaw.filter((h): h is string => typeof h === "string"),
			deny: denyRaw.filter((h): h is string => typeof h === "string"),
		},
	};
}

function schedulePersist(): void {
	if (!persistEnabled) return;
	const snapshot = listDurableGuardianAllows();
	const path = storePath;
	const run = async () => {
		await writeGuardianAlwaysToDisk(path, snapshot);
	};
	pendingWrite = pendingWrite.then(run, run).then(
		() => undefined,
		() => undefined,
	);
}

async function readGuardianAlwaysFromDisk(path: string): Promise<GuardianDurableSnapshot> {
	if (!existsSync(path)) {
		return { commandKeys: [], prefixes: [], hosts: { allow: [], deny: [] } };
	}
	try {
		const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
		return normalizeSnapshot(raw);
	} catch {
		return { commandKeys: [], prefixes: [], hosts: { allow: [], deny: [] } };
	}
}

async function writeGuardianAlwaysToDisk(path: string, snapshot: GuardianDurableSnapshot): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const payload: GuardianDurableFile = {
		version: 1,
		commandKeys: snapshot.commandKeys,
		prefixes: snapshot.prefixes,
		hosts: snapshot.hosts,
		updatedAt: new Date().toISOString(),
	};
	const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	await rm(path, { force: true });
	await rename(tempPath, path);
}

function prefixMatchTokens(tokens: string[], prefix: string[]): boolean {
	if (!prefix.length || tokens.length < prefix.length) return false;
	for (let i = 0; i < prefix.length; i += 1) {
		if (tokens[i] !== prefix[i]) return false;
	}
	return true;
}

function normalizeHostLocal(host: string): string {
	let h = String(host || "")
		.trim()
		.toLowerCase();
	if (!h) return "";
	if (h.startsWith("[") && h.includes("]")) {
		h = h.slice(1, h.indexOf("]"));
	}
	h = h.replace(/\/.*$/, "");
	if (h.includes(":") && !h.includes("::") && /^[^:]+:\d+$/.test(h)) {
		h = h.replace(/:\d+$/, "");
	}
	if (h.includes("@")) h = h.split("@").pop() || h;
	return h;
}

function hostMatchesLocal(candidate: string, rule: string): boolean {
	const c = normalizeHostLocal(candidate);
	const r = normalizeHostLocal(rule);
	if (!c || !r) return false;
	if (c === r) return true;
	if (r.startsWith("*.")) {
		const suffix = r.slice(1);
		return c.endsWith(suffix) || c === r.slice(2);
	}
	return false;
}
