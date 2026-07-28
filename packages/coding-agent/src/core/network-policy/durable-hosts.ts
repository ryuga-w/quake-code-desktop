/**
 * Durable (cross-session) network host allow/deny policy (S-NET.1).
 *
 * Default path: ~/.quake-code/agent/network-hosts.json
 * Path is process-configurable for tests via configureDurableNetworkHostsPath / load(path).
 *
 * Wired into sessionNetworkPolicy via setDurableHostChecker (with guardian-always hosts
 * when that module is loaded). Durable deny hard-blocks; durable allow skips ask.
 *
 * Not a MITM — host list only.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "../../config.js";
import { hostMatches, normalizeHost } from "./normalize.js";
import { sessionNetworkPolicy } from "./policy.js";

export interface DurableNetworkHostsSnapshot {
	allowed: string[];
	denied: string[];
}

export interface DurableNetworkHostsFile {
	version: 1;
	allowed: string[];
	denied: string[];
	updatedAt?: string;
}

const DEFAULT_FILE_NAME = "network-hosts.json";

function defaultStorePath(): string {
	return join(getAgentDir(), DEFAULT_FILE_NAME);
}

let storePath = defaultStorePath();
/** When false, mutations stay in memory only (safe for pure unit tests / until load). */
let persistEnabled = false;
let pendingWrite: Promise<void> = Promise.resolve();

const allowed = new Set<string>();
const denied = new Set<string>();

/**
 * Optional extra durable layer (guardian-always hosts). Composed into the same
 * sessionNetworkPolicy checker so both S-NET.1 and S-TRUST.1 hosts apply.
 */
let extraChecker: {
	isAllowed: (host: string) => boolean;
	isDenied: (host: string) => boolean;
} | null = null;

export function getDefaultDurableNetworkHostsPath(): string {
	return defaultStorePath();
}

/**
 * Compose another durable host checker (e.g. guardian-always) with this store.
 * Called from guardian durable-allows on module load.
 */
export function setExtraDurableHostChecker(
	checker: { isAllowed: (host: string) => boolean; isDenied: (host: string) => boolean } | null,
): void {
	extraChecker = checker;
	wireNetworkPolicyChecker();
}

/** Install combined durable checker on sessionNetworkPolicy. */
export function wireNetworkPolicyChecker(): void {
	sessionNetworkPolicy.setDurableHostChecker({
		isAllowed: (host) => isDurableHostAllowed(host) || Boolean(extraChecker?.isAllowed(host)),
		isDenied: (host) => isDurableHostDenied(host) || Boolean(extraChecker?.isDenied(host)),
	});
}

// Wire on load so network-hosts durable rules apply even without guardian import.
wireNetworkPolicyChecker();

/** Absolute path of the durable host store (diagnostics / tests). */
export function getDurableNetworkHostsPath(): string {
	return storePath;
}

/**
 * Configure durable store path. Resets in-memory durable hosts when `resetMemory` is true.
 * Does not enable persistence until loadDurableNetworkHosts() is called.
 */
export function configureDurableNetworkHostsPath(options: {
	path: string;
	resetMemory?: boolean;
}): void {
	storePath = options.path;
	persistEnabled = false;
	if (options.resetMemory !== false) {
		allowed.clear();
		denied.clear();
	}
	wireNetworkPolicyChecker();
}

/** Reset module state for tests (path + memory + persist flag). Keeps policy checker wired. */
export function resetDurableNetworkHostsForTests(): void {
	storePath = defaultStorePath();
	persistEnabled = false;
	pendingWrite = Promise.resolve();
	allowed.clear();
	denied.clear();
	wireNetworkPolicyChecker();
}

function addNormalized(set: Set<string>, host: string): string | null {
	const h = normalizeHost(host);
	if (!h) return null;
	set.add(h);
	return h;
}

function matchesAny(host: string, rules: Set<string>): boolean {
	const h = normalizeHost(host);
	if (!h) return false;
	for (const rule of rules) {
		if (hostMatches(h, rule)) return true;
	}
	return false;
}

export function isDurableHostAllowed(host: string): boolean {
	return matchesAny(host, allowed);
}

export function isDurableHostDenied(host: string): boolean {
	return matchesAny(host, denied);
}

/**
 * Load durable hosts from disk into memory and enable write-through.
 * Safe to call more than once; replaces in-memory sets from file.
 */
export async function loadDurableNetworkHosts(path?: string): Promise<DurableNetworkHostsSnapshot> {
	if (path) storePath = path;
	await pendingWrite.catch(() => {});
	const snapshot = await readHostsFromDisk(storePath);
	allowed.clear();
	denied.clear();
	for (const h of snapshot.allowed) allowed.add(h);
	for (const h of snapshot.denied) denied.add(h);
	persistEnabled = true;
	return listDurableNetworkHosts();
}

/** Persist current memory snapshot to disk (no-op if persist not enabled and path unset). */
export async function saveDurableNetworkHosts(): Promise<void> {
	await pendingWrite.catch(() => {});
	const snapshot = listDurableNetworkHosts();
	await writeHostsToDisk(storePath, snapshot);
	persistEnabled = true;
}

export function listDurableNetworkHosts(): DurableNetworkHostsSnapshot {
	return {
		allowed: [...allowed].sort((a, b) => a.localeCompare(b, "en")),
		denied: [...denied].sort((a, b) => a.localeCompare(b, "en")),
	};
}

/** Allow host durably (removes from deny if present). Write-through when loaded. */
export function allowDurableHost(host: string): void {
	const h = addNormalized(allowed, host);
	if (!h) return;
	denied.delete(h);
	schedulePersist();
}

/** Deny host durably (removes from allow if present). Write-through when loaded. */
export function denyDurableHost(host: string): void {
	const h = addNormalized(denied, host);
	if (!h) return;
	allowed.delete(h);
	schedulePersist();
}

/**
 * Remove host from both durable allow and deny lists.
 * Returns true if it existed in either set.
 */
export function removeDurableHost(host: string): boolean {
	const h = normalizeHost(host);
	if (!h) return false;
	const existed = allowed.delete(h) || denied.delete(h);
	if (existed) schedulePersist();
	return existed;
}

/** Clear durable memory; empties file when persistence is enabled. */
export function clearDurableNetworkHosts(): void {
	if (allowed.size === 0 && denied.size === 0) {
		if (persistEnabled) schedulePersist();
		return;
	}
	allowed.clear();
	denied.clear();
	schedulePersist();
}

/** Await queued disk writes (tests / shutdown). */
export async function flushDurableNetworkHostsWrites(): Promise<void> {
	await pendingWrite.catch(() => {});
}

function schedulePersist(): void {
	if (!persistEnabled) return;
	const snapshot = listDurableNetworkHosts();
	const path = storePath;
	const run = async () => {
		await writeHostsToDisk(path, snapshot);
	};
	pendingWrite = pendingWrite.then(run, run).then(
		() => undefined,
		() => undefined,
	);
}

async function readHostsFromDisk(path: string): Promise<DurableNetworkHostsSnapshot> {
	if (!existsSync(path)) return { allowed: [], denied: [] };
	try {
		const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
		return normalizeHostsFile(raw);
	} catch {
		return { allowed: [], denied: [] };
	}
}

function normalizeHostsFile(raw: unknown): DurableNetworkHostsSnapshot {
	const allowedOut = new Set<string>();
	const deniedOut = new Set<string>();

	if (!raw || typeof raw !== "object") {
		return { allowed: [], denied: [] };
	}

	const obj = raw as {
		allowed?: unknown;
		denied?: unknown;
		// tolerate alternate keys
		allow?: unknown;
		deny?: unknown;
	};

	const allowList = Array.isArray(obj.allowed)
		? obj.allowed
		: Array.isArray(obj.allow)
			? obj.allow
			: [];
	const denyList = Array.isArray(obj.denied) ? obj.denied : Array.isArray(obj.deny) ? obj.deny : [];

	for (const item of allowList) {
		if (typeof item !== "string") continue;
		const h = normalizeHost(item);
		if (h) allowedOut.add(h);
	}
	for (const item of denyList) {
		if (typeof item !== "string") continue;
		const h = normalizeHost(item);
		if (h) {
			deniedOut.add(h);
			allowedOut.delete(h); // deny wins on conflict in file
		}
	}

	return {
		allowed: [...allowedOut],
		denied: [...deniedOut],
	};
}

async function writeHostsToDisk(path: string, snapshot: DurableNetworkHostsSnapshot): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const payload: DurableNetworkHostsFile = {
		version: 1,
		allowed: snapshot.allowed,
		denied: snapshot.denied,
		updatedAt: new Date().toISOString(),
	};
	const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	await rm(path, { force: true });
	await rename(tempPath, path);
}
