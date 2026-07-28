// NEVER convert to top-level imports - breaks browser/Vite builds (web-ui)
let _existsSync: typeof import("node:fs").existsSync | null = null;
let _readFileSync: typeof import("node:fs").readFileSync | null = null;
let _homedir: typeof import("node:os").homedir | null = null;
let _join: typeof import("node:path").join | null = null;

type DynamicImport = (specifier: string) => Promise<unknown>;
const dynamicImport: DynamicImport = (specifier) => import(specifier);
const NODE_FS_SPECIFIER = "node:" + "fs";
const NODE_OS_SPECIFIER = "node:" + "os";
const NODE_PATH_SPECIFIER = "node:" + "path";

function initSyncNodeModules(): void {
	if (_existsSync && _readFileSync && _homedir && _join) return;
	if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const fs = require("node:fs");
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const os = require("node:os");
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const path = require("node:path");
			_existsSync = fs.existsSync;
			_readFileSync = fs.readFileSync;
			_homedir = os.homedir;
			_join = path.join;
		} catch {
			// Ignore in web/bundler environment
		}
	}
}

initSyncNodeModules();

let nodeModulesReadyPromise: Promise<void> | null = null;

if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
	nodeModulesReadyPromise = Promise.all([
		dynamicImport(NODE_FS_SPECIFIER),
		dynamicImport(NODE_OS_SPECIFIER),
		dynamicImport(NODE_PATH_SPECIFIER),
	]).then(([fsMod, osMod, pathMod]) => {
		_existsSync = (fsMod as typeof import("node:fs")).existsSync;
		_readFileSync = (fsMod as typeof import("node:fs")).readFileSync;
		_homedir = (osMod as typeof import("node:os")).homedir;
		_join = (pathMod as typeof import("node:path")).join;
	});
}

let cachedAuthToken: string | undefined | null = null;

function minimaxDir(): string | undefined {
	initSyncNodeModules();
	if (!_homedir || !_join) return undefined;
	const envDir = process.env.MINIMAX_HOME;
	if (envDir) {
		if (envDir === "~") return _homedir();
		if (envDir.startsWith("~/")) return _homedir() + envDir.slice(1);
		return envDir;
	}
	return _join(_homedir(), ".minimax");
}

function readJsonFile(path: string): unknown | undefined {
	initSyncNodeModules();
	if (!_existsSync || !_readFileSync || !_existsSync(path)) return undefined;
	try {
		return JSON.parse(_readFileSync(path, "utf-8")) as unknown;
	} catch {
		return undefined;
	}
}

/** Await Node fs/os/path modules before reading ~/.minimax (avoids startup race). */
export async function ensureMiniMaxAuthReady(): Promise<void> {
	initSyncNodeModules();
	if (_existsSync && _readFileSync && _homedir && _join) return;
	if (!nodeModulesReadyPromise) return;
	await nodeModulesReadyPromise;
}

/** Access token from `~/.minimax/local-runtime.auth.json` or MINIMAX_API_KEY */
export function getMiniMaxAuthToken(): string | undefined {
	if (process.env.MINIMAX_API_KEY) {
		return process.env.MINIMAX_API_KEY;
	}

	if (cachedAuthToken !== null) {
		return cachedAuthToken;
	}

	initSyncNodeModules();
	if (!_existsSync || !_readFileSync || !_homedir || !_join) {
		return undefined;
	}

	const dir = minimaxDir();
	if (!dir) {
		cachedAuthToken = undefined;
		return undefined;
	}

	const authFile = _join(dir, "local-runtime.auth.json");
	const data = readJsonFile(authFile) as { auth?: { accessToken?: string } } | undefined;
	const token = data?.auth?.accessToken;
	cachedAuthToken = token ?? undefined;
	return cachedAuthToken;
}

export function clearMiniMaxAuthCache(): void {
	cachedAuthToken = null;
}
