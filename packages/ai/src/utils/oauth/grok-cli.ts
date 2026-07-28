/**
 * Grok Build CLI OAuth (device code) — xAI auth.x.ai → cli-chat-proxy.grok.com
 *
 * Mirrors official Grok CLI / 9router grok-cli provider:
 *  - client_id b1a00492-073a-47ea-816f-4c329264a828
 *  - device code + token endpoints on auth.x.ai
 *  - scope includes grok-cli:access
 *  - tokens persisted to ~/.grok/auth.json for Grok CLI compatibility
 */
import { clearGrokAuthCache, ensureGrokAuthReady } from "../../grok-auth.js";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.js";

const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";
const SCOPE =
	"openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";
const USER_AGENT = "grok-shell/0.2.99 (quake-code)";

// NEVER convert to top-level imports - breaks browser/Vite builds
let _existsSync: typeof import("node:fs").existsSync | null = null;
let _readFileSync: typeof import("node:fs").readFileSync | null = null;
let _writeFileSync: typeof import("node:fs").writeFileSync | null = null;
let _chmodSync: typeof import("node:fs").chmodSync | null = null;
let _renameSync: typeof import("node:fs").renameSync | null = null;
let _homedir: typeof import("node:os").homedir | null = null;
let _join: typeof import("node:path").join | null = null;

type DynamicImport = (specifier: string) => Promise<unknown>;
const dynamicImport: DynamicImport = (specifier) => import(specifier);

async function ensureNodeFs(): Promise<void> {
	if (_existsSync && _join) return;
	const [fs, os, path] = await Promise.all([
		dynamicImport("node:fs") as Promise<typeof import("node:fs")>,
		dynamicImport("node:os") as Promise<typeof import("node:os")>,
		dynamicImport("node:path") as Promise<typeof import("node:path")>,
	]);
	_existsSync = fs.existsSync;
	_readFileSync = fs.readFileSync;
	_writeFileSync = fs.writeFileSync;
	_chmodSync = fs.chmodSync;
	_renameSync = fs.renameSync;
	_homedir = os.homedir;
	_join = path.join;
}

function grokHome(): string {
	const envDir = process.env.GROK_HOME;
	if (envDir && _homedir) {
		if (envDir === "~") return _homedir();
		if (envDir.startsWith("~/")) return _homedir() + envDir.slice(1);
		return envDir;
	}
	return _join!(_homedir!(), ".grok");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Request was aborted"));
			return;
		}
		const t = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(t);
			reject(new Error("Request was aborted"));
		});
	});
}

type DeviceCodeResponse = {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete?: string;
	interval: number;
	expires_in: number;
};

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
	const res = await fetch(DEVICE_CODE_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
			"User-Agent": USER_AGENT,
		},
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			scope: SCOPE,
		}),
	});
	if (!res.ok) {
		throw new Error(`Grok device code failed: ${res.status} ${await res.text()}`);
	}
	const data = (await res.json()) as Record<string, unknown>;
	if (
		typeof data.device_code !== "string" ||
		typeof data.user_code !== "string" ||
		typeof data.verification_uri !== "string"
	) {
		throw new Error("Invalid Grok device code response");
	}
	return {
		device_code: data.device_code,
		user_code: data.user_code,
		verification_uri: data.verification_uri,
		verification_uri_complete:
			typeof data.verification_uri_complete === "string" ? data.verification_uri_complete : undefined,
		interval: typeof data.interval === "number" ? data.interval : 5,
		expires_in: typeof data.expires_in === "number" ? data.expires_in : 900,
	};
}

async function pollForToken(
	deviceCode: string,
	intervalSec: number,
	expiresIn: number,
	signal?: AbortSignal,
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
	const deadline = Date.now() + expiresIn * 1000;
	let interval = Math.max(intervalSec, 3) * 1000;

	while (Date.now() < deadline) {
		if (signal?.aborted) throw new Error("Request was aborted");
		await sleep(interval, signal);

		const res = await fetch(TOKEN_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
				"User-Agent": USER_AGENT,
			},
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				device_code: deviceCode,
				client_id: CLIENT_ID,
			}),
		});

		const text = await res.text();
		let json: Record<string, unknown> = {};
		try {
			json = JSON.parse(text) as Record<string, unknown>;
		} catch {
			/* ignore */
		}

		if (res.ok && typeof json.access_token === "string") {
			return {
				access_token: json.access_token,
				refresh_token: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
				expires_in: typeof json.expires_in === "number" ? json.expires_in : undefined,
			};
		}

		const error = typeof json.error === "string" ? json.error : "";
		if (error === "authorization_pending" || error === "slow_down") {
			if (error === "slow_down") interval = Math.min(interval + 2000, 15_000);
			continue;
		}
		if (error === "expired_token" || error === "access_denied") {
			throw new Error(`Grok login ${error}`);
		}
		if (!res.ok) {
			throw new Error(`Grok token poll failed: ${res.status} ${text}`);
		}
	}

	throw new Error("Grok device code expired — try again");
}

export async function refreshGrokCliToken(refreshToken: string): Promise<OAuthCredentials> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
			"User-Agent": USER_AGENT,
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}),
	});
	if (!res.ok) {
		throw new Error(`Grok token refresh failed: ${res.status} ${await res.text()}`);
	}
	const data = (await res.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
	};
	if (!data.access_token) throw new Error("Grok refresh returned no access_token");

	const expiresIn = data.expires_in ?? 3600;
	const credentials: OAuthCredentials = {
		access: data.access_token,
		refresh: data.refresh_token || refreshToken,
		expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
	};

	await persistToGrokAuthFile(credentials);
	return credentials;
}

async function persistToGrokAuthFile(credentials: OAuthCredentials & { email?: string }): Promise<void> {
	await ensureNodeFs();
	await ensureGrokAuthReady();
	const home = grokHome();
	const authPath = _join!(home, "auth.json");
	const storageKey = `https://auth.x.ai::${CLIENT_ID}`;

	let existing: Record<string, unknown> = {};
	if (_existsSync!(authPath)) {
		try {
			existing = JSON.parse(_readFileSync!(authPath, "utf-8") as string) as Record<string, unknown>;
		} catch {
			existing = {};
		}
	}

	const prev =
		existing[storageKey] && typeof existing[storageKey] === "object"
			? (existing[storageKey] as Record<string, unknown>)
			: {};

	const expiresAt = new Date(
		typeof credentials.expires === "number" && credentials.expires > 0
			? credentials.expires
			: Date.now() + 3600_000,
	).toISOString();

	existing[storageKey] = {
		...prev,
		key: credentials.access,
		refresh_token: credentials.refresh,
		expires_at: expiresAt,
		oidc_client_id: CLIENT_ID,
		oidc_issuer: "https://auth.x.ai",
		email: credentials.email || prev.email,
		auth_mode: "oauth",
	};

	const dir = home;
	const tmp = _join!(dir, `.auth.json.${process.pid}.${Date.now()}.tmp`);
	const payload = `${JSON.stringify(existing, null, 2)}\n`;
	// ensure dir exists via write path
	try {
		const fs = (await dynamicImport("node:fs")) as typeof import("node:fs");
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	} catch {
		/* ignore */
	}
	_writeFileSync!(tmp, payload, { encoding: "utf-8", mode: 0o600 });
	_chmodSync?.(tmp, 0o600);
	_renameSync!(tmp, authPath);
	_chmodSync?.(authPath, 0o600);
	clearGrokAuthCache();
}

export async function loginGrokCli(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	callbacks.onProgress?.("Requesting Grok Build device code…");
	const device = await requestDeviceCode();

	const openUrl = device.verification_uri_complete || device.verification_uri;
	callbacks.onAuth({
		url: openUrl,
		instructions: `Open the link and enter code ${device.user_code} (or confirm if pre-filled). Waiting for authorization…`,
	});

	// Surface code via prompt UI for devices without browser auto-fill
	void callbacks
		.onPrompt({
			message: `Grok Build login code: ${device.user_code}\nBrowser: ${openUrl}\n(Leave empty — auto-poll continues)`,
			placeholder: device.user_code,
			allowEmpty: true,
		})
		.catch(() => undefined);

	callbacks.onProgress?.("Waiting for browser approval…");
	const tokens = await pollForToken(device.device_code, device.interval, device.expires_in, callbacks.signal);

	const expiresIn = tokens.expires_in ?? 3600;
	const credentials: OAuthCredentials = {
		access: tokens.access_token,
		refresh: tokens.refresh_token || tokens.access_token,
		expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
	};

	// Best-effort email from JWT payload
	try {
		const payload = JSON.parse(
			Buffer.from(tokens.access_token.split(".")[1] || "", "base64url").toString("utf8"),
		) as { email?: string; preferred_username?: string };
		if (payload.email) credentials.email = payload.email;
		else if (payload.preferred_username) credentials.email = payload.preferred_username;
	} catch {
		/* ignore */
	}

	await persistToGrokAuthFile(credentials);
	callbacks.onProgress?.("Grok Build login saved to ~/.grok/auth.json");
	return credentials;
}

export const grokCliOAuthProvider: OAuthProviderInterface = {
	id: "grok-cli",
	name: "Grok Build CLI",
	usesCallbackServer: false,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		return loginGrokCli(callbacks);
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		return refreshGrokCliToken(credentials.refresh);
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
