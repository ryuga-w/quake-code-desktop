// NEVER convert to top-level imports - breaks browser/Vite builds (web-ui)
let _existsSync: typeof import("node:fs").existsSync | null = null;
let _readFileSync: typeof import("node:fs").readFileSync | null = null;
let _writeFileSync: typeof import("node:fs").writeFileSync | null = null;
let _chmodSync: typeof import("node:fs").chmodSync | null = null;
let _renameSync: typeof import("node:fs").renameSync | null = null;
let _homedir: typeof import("node:os").homedir | null = null;
let _join: typeof import("node:path").join | null = null;

type DynamicImport = (specifier: string) => Promise<unknown>;
const dynamicImport: DynamicImport = (specifier) => import(specifier);
const NODE_FS_SPECIFIER = "node:" + "fs";
const NODE_OS_SPECIFIER = "node:" + "os";
const NODE_PATH_SPECIFIER = "node:" + "path";

let nodeModulesReadyPromise: Promise<void> | null = null;

function assignNodeModules(
	fs: typeof import("node:fs"),
	os: typeof import("node:os"),
	path: typeof import("node:path"),
): void {
	_existsSync = fs.existsSync;
	_readFileSync = fs.readFileSync;
	_writeFileSync = fs.writeFileSync;
	_chmodSync = fs.chmodSync;
	_renameSync = fs.renameSync;
	_homedir = os.homedir;
	_join = path.join;
}

if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
	nodeModulesReadyPromise = Promise.all([
		dynamicImport(NODE_FS_SPECIFIER),
		dynamicImport(NODE_OS_SPECIFIER),
		dynamicImport(NODE_PATH_SPECIFIER),
	]).then(([fsMod, osMod, pathMod]) => {
		assignNodeModules(
			fsMod as typeof import("node:fs"),
			osMod as typeof import("node:os"),
			pathMod as typeof import("node:path"),
		);
	});
}

const DEFAULT_GROK_CLI_VERSION = "0.2.64";
const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_OAUTH_DISCOVERY_URL = "https://auth.x.ai/.well-known/openid-configuration";
const XAI_TOKEN_ENDPOINT_FALLBACK = "https://auth.x.ai/oauth2/token";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;

let cachedAuthToken: string | undefined | null = null;
let cachedCliVersion: string | null = null;
let cachedTokenEndpoint: string | null = null;
let refreshInFlight: Promise<string | undefined> | null = null;

export type GrokAuthTokenSource = "env" | "file" | "xai-env" | "none";

export type GrokAuthInfo = {
	configured: boolean;
	tokenSource: GrokAuthTokenSource;
	tokenPreview?: string;
	expiresAt?: Date;
	cliVersion: string;
	grokHome?: string;
	authFilePath?: string;
	hasRefreshToken: boolean;
	autoRefreshEnabled: boolean;
};

export type GrokRefreshOptions = {
	/** Refresh even if token is not near expiry. */
	force?: boolean;
};

type GrokAuthFileEntry = {
	key?: string;
	expires_at?: string;
	refresh_token?: string;
	email?: string;
	oidc_client_id?: string;
};

type AuthStorageLocation = {
	storageKey?: string;
	isFlat: boolean;
	entry: GrokAuthFileEntry;
};

function grokDir(): string | undefined {
	if (!_homedir || !_join) return undefined;
	const envDir = process.env.GROK_HOME;
	if (envDir) {
		if (envDir === "~") return _homedir();
		if (envDir.startsWith("~/")) return _homedir() + envDir.slice(1);
		return envDir;
	}
	return _join(_homedir(), ".grok");
}

function readJsonFile(path: string): unknown | undefined {
	if (!_existsSync || !_readFileSync || !_existsSync(path)) return undefined;
	try {
		return JSON.parse(_readFileSync(path, "utf-8")) as unknown;
	} catch {
		return undefined;
	}
}

function writeJsonFileAtomic(path: string, data: unknown): void {
	if (!_writeFileSync || !_chmodSync || !_renameSync || !_join) return;
	const dir = _join(path, "..");
	const tmpPath = _join(dir, `.auth.json.${process.pid}.${Date.now()}.tmp`);
	const payload = `${JSON.stringify(data, null, 2)}\n`;
	_writeFileSync(tmpPath, payload, { encoding: "utf-8", mode: 0o600 });
	_chmodSync(tmpPath, 0o600);
	_renameSync(tmpPath, path);
	_chmodSync(path, 0o600);
}

function locateAuthEntry(data: unknown): AuthStorageLocation | undefined {
	if (!data || typeof data !== "object") return undefined;
	const record = data as Record<string, unknown>;

	if (typeof record.key === "string" && record.key.length > 0) {
		return {
			isFlat: true,
			entry: {
				key: record.key,
				expires_at: typeof record.expires_at === "string" ? record.expires_at : undefined,
				refresh_token: typeof record.refresh_token === "string" ? record.refresh_token : undefined,
				email: typeof record.email === "string" ? record.email : undefined,
				oidc_client_id:
					typeof record.oidc_client_id === "string"
						? record.oidc_client_id
						: typeof record.client_id === "string"
							? record.client_id
							: undefined,
			},
		};
	}

	for (const [storageKey, value] of Object.entries(record)) {
		if (!value || typeof value !== "object") continue;
		const entry = value as Record<string, unknown>;
		if (typeof entry.key === "string" && entry.key.length > 0) {
			return {
				storageKey,
				isFlat: false,
				entry: {
					key: entry.key,
					expires_at: typeof entry.expires_at === "string" ? entry.expires_at : undefined,
					refresh_token: typeof entry.refresh_token === "string" ? entry.refresh_token : undefined,
					email: typeof entry.email === "string" ? entry.email : undefined,
					oidc_client_id:
						typeof entry.oidc_client_id === "string"
							? entry.oidc_client_id
							: typeof entry.client_id === "string"
								? entry.client_id
								: storageKey.includes("::")
									? storageKey.split("::")[1]
									: undefined,
				},
			};
		}
	}

	return undefined;
}

function extractAuthEntry(data: unknown): GrokAuthFileEntry | undefined {
	return locateAuthEntry(data)?.entry;
}

function extractAccessToken(data: unknown): string | undefined {
	return extractAuthEntry(data)?.key;
}

function nodeFsReady(): boolean {
	return !!(_existsSync && _readFileSync && _writeFileSync && _chmodSync && _renameSync && _homedir && _join);
}

function isNodeRuntime(): boolean {
	return typeof process !== "undefined" && !!(process.versions?.node || process.versions?.bun);
}

function usesEnvGrokToken(): boolean {
	return !!(process.env.GROK_AUTH_TOKEN || process.env.XAI_API_KEY);
}

function grokUserAgent(): string {
	return `GrokBuild/${getGrokCliVersion()}`;
}

/** Await Node fs/os/path modules before reading ~/.grok (avoids startup race). */
export async function ensureGrokAuthReady(): Promise<void> {
	if (nodeFsReady()) return;
	if (!nodeModulesReadyPromise) return;
	await nodeModulesReadyPromise;
}

function previewToken(token: string): string {
	if (token.length <= 12) return "••••••••";
	return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

function parseExpiresAt(value: string | undefined): Date | undefined {
	if (!value) return undefined;
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

function decodeJwtExp(token: string): Date | undefined {
	const parts = token.split(".");
	if (parts.length < 2) return undefined;
	try {
		const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("utf-8");
		const payload = JSON.parse(json) as { exp?: unknown };
		return typeof payload.exp === "number" ? new Date(payload.exp * 1000) : undefined;
	} catch {
		return undefined;
	}
}

function resolveTokenExpiry(token: string, expiresAt?: string): Date | undefined {
	return parseExpiresAt(expiresAt) ?? decodeJwtExp(token);
}

function tokenNeedsRefresh(expiresAt: Date | undefined, force = false): boolean {
	if (force) return true;
	if (!expiresAt) return false;
	return expiresAt.getTime() - Date.now() <= REFRESH_BUFFER_MS;
}

async function resolveTokenEndpoint(): Promise<string> {
	if (cachedTokenEndpoint) return cachedTokenEndpoint;
	try {
		const response = await fetch(XAI_OAUTH_DISCOVERY_URL, {
			headers: {
				Accept: "application/json",
				"User-Agent": grokUserAgent(),
			},
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (response.ok) {
			const json = (await response.json()) as { token_endpoint?: unknown };
			if (typeof json.token_endpoint === "string" && json.token_endpoint.startsWith("https://auth.x.ai/")) {
				cachedTokenEndpoint = json.token_endpoint;
				return cachedTokenEndpoint;
			}
		}
	} catch {
		// fall through to default endpoint
	}
	cachedTokenEndpoint = XAI_TOKEN_ENDPOINT_FALLBACK;
	return cachedTokenEndpoint;
}

type RefreshTokenResponse = {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
};

async function exchangeRefreshToken(refreshToken: string, clientId: string): Promise<RefreshTokenResponse> {
	const tokenEndpoint = await resolveTokenEndpoint();
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		client_id: clientId,
	});

	const response = await fetch(tokenEndpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
			"User-Agent": grokUserAgent(),
		},
		body,
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		payload = null;
	}

	if (!response.ok) {
		const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
		const description =
			typeof record.error_description === "string"
				? record.error_description
				: typeof record.error === "string"
					? record.error
					: `HTTP ${response.status}`;
		throw new Error(`Grok token refresh failed: ${description}`);
	}

	return (payload ?? {}) as RefreshTokenResponse;
}

function persistRefreshedEntry(
	authFilePath: string,
	location: AuthStorageLocation,
	accessToken: string,
	refreshToken: string,
	expiresAt: string,
): void {
	const current = readJsonFile(authFilePath);
	if (!current || typeof current !== "object") return;

	const record = { ...(current as Record<string, unknown>) };
	const nextEntry: Record<string, unknown> = {
		...(location.isFlat ? record : (record[location.storageKey!] as Record<string, unknown>)),
		key: accessToken,
		refresh_token: refreshToken,
		expires_at: expiresAt,
	};

	if (location.isFlat) {
		Object.assign(record, nextEntry);
	} else if (location.storageKey) {
		record[location.storageKey] = nextEntry;
	}

	writeJsonFileAtomic(authFilePath, record);
}

async function refreshGrokAuthFromFile(options: GrokRefreshOptions = {}): Promise<string | undefined> {
	await ensureGrokAuthReady();
	if (!nodeFsReady() || usesEnvGrokToken()) return getGrokAuthToken();

	const dir = grokDir();
	if (!dir) return undefined;
	const authFilePath = _join!(dir, "auth.json");
	const raw = readJsonFile(authFilePath);
	const location = locateAuthEntry(raw);
	if (!location?.entry.key) return undefined;
	if (!location.entry.refresh_token) return location.entry.key;

	const expiresAt = resolveTokenExpiry(location.entry.key, location.entry.expires_at);
	if (!tokenNeedsRefresh(expiresAt, options.force)) {
		cachedAuthToken = location.entry.key;
		return location.entry.key;
	}

	const clientId = location.entry.oidc_client_id || XAI_OAUTH_CLIENT_ID;
	const refreshed = await exchangeRefreshToken(location.entry.refresh_token, clientId);
	const accessToken = refreshed.access_token;
	if (!accessToken) {
		throw new Error("Grok token refresh failed: missing access_token");
	}

	const nextRefreshToken = refreshed.refresh_token || location.entry.refresh_token;
	const nextExpiresAt =
		typeof refreshed.expires_in === "number"
			? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
			: (decodeJwtExp(accessToken)?.toISOString() ??
				location.entry.expires_at ??
				new Date(Date.now() + 3600_000).toISOString());

	persistRefreshedEntry(authFilePath, location, accessToken, nextRefreshToken, nextExpiresAt);
	cachedAuthToken = accessToken;
	return accessToken;
}

/**
 * Return a fresh Grok JWT from ~/.grok/auth.json, refreshing via OIDC when near expiry.
 * Skips refresh when GROK_AUTH_TOKEN or XAI_API_KEY is set.
 */
export async function ensureFreshGrokAuthToken(options: GrokRefreshOptions = {}): Promise<string | undefined> {
	if (process.env.GROK_AUTH_TOKEN) return process.env.GROK_AUTH_TOKEN;
	if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY;

	if (options.force) {
		try {
			return await refreshGrokAuthFromFile(options);
		} catch {
			clearGrokAuthCache();
			return getGrokAuthToken();
		}
	}

	if (!refreshInFlight) {
		refreshInFlight = refreshGrokAuthFromFile(options).finally(() => {
			refreshInFlight = null;
		});
	}

	try {
		return await refreshInFlight;
	} catch {
		clearGrokAuthCache();
		return getGrokAuthToken();
	}
}

/** JWT access token from `~/.grok/auth.json` (set by `grok login`). */
export function getGrokAuthToken(): string | undefined {
	if (!nodeFsReady()) {
		if (!isNodeRuntime()) {
			cachedAuthToken = undefined;
		}
		return undefined;
	}

	if (cachedAuthToken !== null) {
		return cachedAuthToken;
	}

	const dir = grokDir();
	if (!dir) {
		cachedAuthToken = undefined;
		return undefined;
	}

	const token = extractAccessToken(readJsonFile(_join!(dir, "auth.json")));
	cachedAuthToken = token;
	return token;
}

/** Installed Grok CLI version from `~/.grok/version.json` (required for cli-chat-proxy). */
export function getGrokCliVersion(): string {
	if (cachedCliVersion !== null) {
		return cachedCliVersion;
	}

	if (!nodeFsReady()) {
		return DEFAULT_GROK_CLI_VERSION;
	}

	const dir = grokDir();
	if (!dir) {
		cachedCliVersion = DEFAULT_GROK_CLI_VERSION;
		return cachedCliVersion;
	}

	const versionData = readJsonFile(_join!(dir, "version.json")) as { version?: unknown } | undefined;
	const version = typeof versionData?.version === "string" ? versionData.version : DEFAULT_GROK_CLI_VERSION;
	cachedCliVersion = version;
	return version;
}

/** Detailed Grok auth status for CLI diagnostics. */
export function getGrokAuthInfo(): GrokAuthInfo {
	const cliVersion = getGrokCliVersion();
	const home = grokDir();
	const authFilePath = home && _join ? _join(home, "auth.json") : undefined;

	if (process.env.GROK_AUTH_TOKEN) {
		const token = process.env.GROK_AUTH_TOKEN;
		return {
			configured: true,
			tokenSource: "env",
			tokenPreview: previewToken(token),
			expiresAt: decodeJwtExp(token),
			cliVersion,
			grokHome: home,
			authFilePath,
			hasRefreshToken: false,
			autoRefreshEnabled: false,
		};
	}

	if (nodeFsReady() && authFilePath) {
		const entry = extractAuthEntry(readJsonFile(authFilePath));
		if (entry?.key) {
			return {
				configured: true,
				tokenSource: "file",
				tokenPreview: previewToken(entry.key),
				expiresAt: resolveTokenExpiry(entry.key, entry.expires_at),
				cliVersion,
				grokHome: home,
				authFilePath,
				hasRefreshToken: !!entry.refresh_token,
				autoRefreshEnabled: !!entry.refresh_token,
			};
		}
	}

	if (process.env.XAI_API_KEY) {
		const token = process.env.XAI_API_KEY;
		return {
			configured: true,
			tokenSource: "xai-env",
			tokenPreview: previewToken(token),
			cliVersion,
			grokHome: home,
			authFilePath,
			hasRefreshToken: false,
			autoRefreshEnabled: false,
		};
	}

	return {
		configured: false,
		tokenSource: "none",
		cliVersion,
		grokHome: home,
		authFilePath,
		hasRefreshToken: false,
		autoRefreshEnabled: false,
	};
}

export function clearGrokAuthCache(): void {
	cachedAuthToken = null;
	cachedCliVersion = null;
	cachedTokenEndpoint = null;
	// Billing reads depend on auth; invalidate together.
	void import("./grok-billing.js").then((m) => m.clearGrokBillingCache()).catch(() => {});
}
