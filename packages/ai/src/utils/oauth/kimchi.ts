/**
 * Kimchi OAuth (browser token callback) — ports 9router/Kimchi CLI flow.
 *
 * Flow:
 *  1. Start loopback HTTP server
 *  2. Open https://app.kimchi.dev/cli-auth?callback=...&state=...
 *  3. Callback receives ?token=...&state=...
 *  4. Validate token, return OAuthCredentials (Bearer for llm.kimchi.dev)
 *
 * Also accepts a pasted raw token via onManualCodeInput.
 */
import { oauthErrorHtml, oauthSuccessHtml } from "./oauth-page.js";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.js";

export const KIMCHI_BASE_URL = "https://llm.kimchi.dev/openai/v1";
export const KIMCHI_USER_AGENT = "kimchi/0.1.50";
export const KIMCHI_WEB_APP_URL = "https://app.kimchi.dev";
export const KIMCHI_VALIDATION_URL = "https://api.cast.ai/v1/llm/openai/supported-providers";
export const KIMCHI_ME_URL = "https://app.kimchi.dev/api/v1/me";
export const KIMCHI_MODELS_URL = "https://llm.kimchi.dev/v1/models/metadata?include_in_cli=true";

const CALLBACK_PATH = "/callback";
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

// Lazy Node http (browser-safe)
let _createServer: typeof import("node:http").createServer | null = null;
let _httpImportPromise: Promise<void> | null = null;
if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
	_httpImportPromise = import("node:http").then((m) => {
		_createServer = m.createServer;
	});
}

async function getCreateServer(): Promise<typeof import("node:http").createServer> {
	if (_createServer) return _createServer;
	if (_httpImportPromise) await _httpImportPromise;
	if (_createServer) return _createServer;
	throw new Error("Kimchi OAuth is only available in Node.js");
}

function generateState(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function buildAuthUrl(callbackUrl: string, state: string): string {
	const params = new URLSearchParams({ callback: callbackUrl, state });
	return `${KIMCHI_WEB_APP_URL}/cli-auth?${params.toString()}`;
}

function extractTokenFromInput(input: string): string | undefined {
	const trimmed = input.trim();
	if (!trimmed) return undefined;
	// Raw token paste
	if (!trimmed.includes("://") && !trimmed.includes("?") && trimmed.length > 20) {
		return trimmed;
	}
	try {
		const url = new URL(trimmed);
		const token = url.searchParams.get("token");
		if (token) return token;
	} catch {
		/* ignore */
	}
	// token=... fragment
	const match = trimmed.match(/[?&#]token=([^&#\s]+)/i);
	if (match?.[1]) return decodeURIComponent(match[1]);
	return undefined;
}

async function validateKimchiToken(token: string): Promise<{ valid: boolean; error?: string }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 10_000);
	try {
		const res = await fetch(KIMCHI_VALIDATION_URL, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
			},
			signal: controller.signal,
		});
		if (res.status === 200) return { valid: true };
		if (res.status === 401) return { valid: false, error: "Kimchi token invalid or expired" };
		if (res.status === 403) return { valid: false, error: "Kimchi token lacks required scope" };
		// Fail-open on other statuses
		return { valid: true };
	} catch {
		return { valid: true };
	} finally {
		clearTimeout(timer);
	}
}

async function fetchKimchiProfile(token: string): Promise<{ email?: string; name?: string; username?: string }> {
	try {
		const res = await fetch(KIMCHI_ME_URL, {
			headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
		});
		if (!res.ok) return {};
		const j = (await res.json()) as { email?: string; name?: string; username?: string; id?: string };
		return {
			email: j.email || (j.id ? `kimchi-user-${j.id}` : undefined),
			name: j.name,
			username: j.username,
		};
	} catch {
		return {};
	}
}

type CallbackServer = {
	port: number;
	close: () => void;
	waitForToken: () => Promise<{ token: string; state: string } | null>;
	cancelWait: () => void;
};

async function startCallbackServer(expectedState: string): Promise<CallbackServer> {
	const createServer = await getCreateServer();
	let settle: ((value: { token: string; state: string } | null) => void) | undefined;
	const waitPromise = new Promise<{ token: string; state: string } | null>((resolve) => {
		let done = false;
		settle = (v) => {
			if (done) return;
			done = true;
			resolve(v);
		};
	});

	const server = createServer((req, res) => {
		try {
			const url = new URL(req.url || "", "http://127.0.0.1");
			if (url.pathname !== CALLBACK_PATH) {
				res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
				res.end(oauthErrorHtml("Callback route not found."));
				return;
			}
			const err = url.searchParams.get("error");
			if (err) {
				res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
				res.end(oauthErrorHtml("Kimchi authentication did not complete.", err));
				settle?.(null);
				return;
			}
			const token = url.searchParams.get("token");
			const state = url.searchParams.get("state") || "";
			if (!token) {
				res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
				res.end(oauthErrorHtml("No token returned by Kimchi."));
				return;
			}
			if (state !== expectedState) {
				res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
				res.end(oauthErrorHtml("OAuth state mismatch — restart Kimchi login."));
				return;
			}
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(oauthSuccessHtml("Kimchi authentication completed. You can close this window."));
			settle?.({ token, state });
		} catch (e) {
			res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
			res.end(oauthErrorHtml(e instanceof Error ? e.message : "Callback error"));
		}
	});

	const port = await new Promise<number>((resolve, reject) => {
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (addr && typeof addr === "object") resolve(addr.port);
			else reject(new Error("Failed to bind Kimchi callback server"));
		});
		server.on("error", reject);
	});

	return {
		port,
		close: () => {
			try {
				server.close();
			} catch {
				/* ignore */
			}
		},
		waitForToken: () => waitPromise,
		cancelWait: () => settle?.(null),
	};
}

async function credentialsFromToken(token: string): Promise<OAuthCredentials> {
	const check = await validateKimchiToken(token);
	if (!check.valid) throw new Error(check.error || "Kimchi token validation failed");
	const profile = await fetchKimchiProfile(token);
	return {
		access: token,
		// No refresh endpoint — reuse token as refresh stub for AuthStorage shape
		refresh: token,
		expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
		email: profile.email,
		login: profile.username || profile.name,
	};
}

export async function loginKimchi(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const state = generateState();
	callbacks.onProgress?.("Starting Kimchi browser login…");
	const server = await startCallbackServer(state);
	const callbackUrl = `http://127.0.0.1:${server.port}${CALLBACK_PATH}`;
	const authUrl = buildAuthUrl(callbackUrl, state);

	try {
		callbacks.onAuth({
			url: authUrl,
			instructions:
				"Complete sign-in in the browser. When done, the window should close automatically. You can also paste the callback URL or raw token.",
		});

		callbacks.onProgress?.("Waiting for Kimchi callback…");

		let token: string | undefined;

		if (callbacks.onManualCodeInput) {
			let manual: string | undefined;
			let manualErr: Error | undefined;
			const manualPromise = callbacks
				.onManualCodeInput()
				.then((input) => {
					manual = input;
					server.cancelWait();
				})
				.catch((err) => {
					manualErr = err instanceof Error ? err : new Error(String(err));
					server.cancelWait();
				});

			const timed = Promise.race([
				server.waitForToken(),
				new Promise<null>((resolve) => setTimeout(() => resolve(null), CALLBACK_TIMEOUT_MS)),
			]);

			const result = await timed;
			if (manualErr) throw manualErr;
			if (result?.token) {
				token = result.token;
			} else if (manual) {
				token = extractTokenFromInput(manual);
				if (!token) throw new Error("No Kimchi token found in pasted input");
			} else {
				await manualPromise;
				if (manualErr) throw manualErr;
				if (manual) token = extractTokenFromInput(manual);
			}
		} else {
			const result = await Promise.race([
				server.waitForToken(),
				new Promise<null>((resolve) => setTimeout(() => resolve(null), CALLBACK_TIMEOUT_MS)),
			]);
			token = result?.token;
		}

		if (!token) throw new Error("Kimchi login timed out or no token received");
		callbacks.onProgress?.("Validating Kimchi token…");
		return await credentialsFromToken(token);
	} finally {
		server.close();
	}
}

export async function refreshKimchiToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	// Kimchi browser tokens are not refreshable; re-validate and return as-is
	const token = credentials.access || credentials.refresh;
	if (!token) throw new Error("Missing Kimchi token");
	const check = await validateKimchiToken(token);
	if (!check.valid) throw new Error(check.error || "Kimchi token expired — please login again");
	return {
		...credentials,
		access: token,
		refresh: credentials.refresh || token,
		expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
	};
}

export const kimchiOAuthProvider: OAuthProviderInterface = {
	id: "kimchi",
	name: "Kimchi",
	usesCallbackServer: true,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		return loginKimchi(callbacks);
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		return refreshKimchiToken(credentials);
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
