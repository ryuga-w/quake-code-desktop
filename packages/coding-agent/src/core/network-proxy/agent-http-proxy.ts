/**
 * Cooperative loopback HTTP(S)_PROXY for agent bash children (T2.P2 / S-NET.2).
 *
 * Env flag `QUAKE_AGENT_HTTP_PROXY` remains off unless set. Product may auto-enable
 * for non-full-access via `shouldAutoEnableAgentHttpProxy` (desktop first-boot).
 * Not a transparent MITM: only clients that honor HTTP_PROXY/HTTPS_PROXY are covered.
 * Mid-flight unknown hosts (`ask`) are fail-closed (deny) — pre-exec tool-gate should
 * have allowlisted hosts before the child runs.
 *
 * See apps/quake-desktop/docs/CODEX_WINDOWS_SANDBOX.md and PROGRAM_TRACKS.md.
 */

import * as http from "node:http";
import * as net from "node:net";
import type { HostDecision } from "../network-policy/policy.js";
import { sessionNetworkPolicy } from "../network-policy/policy.js";

export const AGENT_HTTP_PROXY_ENV_FLAG = "QUAKE_AGENT_HTTP_PROXY";

const DEFAULT_NO_PROXY = "localhost,127.0.0.1,::1";
const DEFAULT_PROXY_AUDIT_CAPACITY = 200;

export type HostEvaluator = (host: string) => HostDecision;

/** Ring-buffer entry for CONNECT / absolute-form proxy decisions (S-NET.2). */
export interface ProxyAuditEntry {
	host: string;
	/** Policy decision from evaluateHost */
	decision: HostDecision;
	/** Whether the proxy allowed the tunnel/request */
	allowed: boolean;
	ts: number;
	method: "CONNECT" | "HTTP";
	reason?: string;
}

let proxyAuditLog: ProxyAuditEntry[] = [];
let proxyAuditCapacity = DEFAULT_PROXY_AUDIT_CAPACITY;

function recordProxyAudit(entry: Omit<ProxyAuditEntry, "ts"> & { ts?: number }): void {
	const full: ProxyAuditEntry = {
		...entry,
		ts: entry.ts ?? Date.now(),
	};
	proxyAuditLog.push(full);
	if (proxyAuditLog.length > proxyAuditCapacity) {
		proxyAuditLog = proxyAuditLog.slice(proxyAuditLog.length - proxyAuditCapacity);
	}
}

/** Last N CONNECT/HTTP proxy decisions (newest last). Copy for tests/UI. */
export function getProxyAuditLog(): ProxyAuditEntry[] {
	return [...proxyAuditLog];
}

/** Clear audit ring buffer (tests / session reset). */
export function clearProxyAuditLog(): void {
	proxyAuditLog = [];
}

/** Max ring size (default 200). Shrinks buffer if already larger. */
export function setProxyAuditCapacity(n: number): void {
	proxyAuditCapacity = Math.max(1, Math.floor(n) || DEFAULT_PROXY_AUDIT_CAPACITY);
	if (proxyAuditLog.length > proxyAuditCapacity) {
		proxyAuditLog = proxyAuditLog.slice(proxyAuditLog.length - proxyAuditCapacity);
	}
}

/**
 * Whether cooperative agent HTTP proxy should auto-enable for a given approval
 * preset / terminal policy. Default-on for non-full-access (S-NET.2).
 *
 * Accepts preset ids (`auto`, `read-only`, `full-access`) or terminal policy
 * modes (`safe`, `allow-all`, `disabled`).
 */
export function shouldAutoEnableAgentHttpProxy(
	preset: string | { id?: string } | null | undefined,
): boolean {
	const raw =
		typeof preset === "string"
			? preset
			: String(preset?.id ?? "").trim();
	const id = raw.toLowerCase().trim();
	if (!id) return true;
	// Full access / allow-all: policy is open; cooperative fail-closed proxy is not the default
	if (
		id === "full-access" ||
		id === "allow-all" ||
		id === "danger-full-access" ||
		id === "danger"
	) {
		return false;
	}
	// safe / auto / read-only / disabled / untrusted / on-request → default on
	return true;
}

export interface AgentHttpProxyInfo {
	/** Bound loopback host (always 127.0.0.1 for this phase) */
	host: string;
	port: number;
	/** e.g. http://127.0.0.1:PORT */
	url: string;
}

export interface StartAgentHttpProxyOptions {
	/** Override policy evaluation (tests). Default: sessionNetworkPolicy.evaluateHost */
	evaluateHost?: HostEvaluator;
	/** Listen host. Default 127.0.0.1 */
	host?: string;
	/** Listen port. Default 0 (ephemeral) */
	port?: number;
	/**
	 * Start even when QUAKE_AGENT_HTTP_PROXY is off (unit tests).
	 * Production callers should leave this false and rely on the flag.
	 */
	force?: boolean;
}

interface ProxyState {
	server: http.Server;
	host: string;
	port: number;
	evaluateHost: HostEvaluator;
}

let state: ProxyState | null = null;
let startPromise: Promise<AgentHttpProxyInfo> | null = null;

/** True when QUAKE_AGENT_HTTP_PROXY is 1/true/on/yes (case-insensitive). Default off. */
export function isAgentHttpProxyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const raw = String(env[AGENT_HTTP_PROXY_ENV_FLAG] ?? "")
		.toLowerCase()
		.trim();
	return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

/** Parse CONNECT authority (`host:port` or `[ipv6]:port`). */
export function parseConnectAuthority(authority: string): { host: string; port: number } | null {
	const s = String(authority || "").trim();
	if (!s) return null;

	if (s.startsWith("[")) {
		const end = s.indexOf("]");
		if (end < 0) return null;
		const host = s.slice(1, end);
		const rest = s.slice(end + 1);
		const port = rest.startsWith(":") ? Number.parseInt(rest.slice(1), 10) : 443;
		if (!host || !Number.isFinite(port) || port <= 0) return null;
		return { host, port };
	}

	const idx = s.lastIndexOf(":");
	if (idx <= 0) {
		// CONNECT without port is unusual; default 443 for host-only.
		return { host: s, port: 443 };
	}
	const host = s.slice(0, idx);
	const port = Number.parseInt(s.slice(idx + 1), 10);
	if (!host || !Number.isFinite(port) || port <= 0) return null;
	return { host, port };
}

function defaultEvaluateHost(host: string): HostDecision {
	return sessionNetworkPolicy.evaluateHost(host);
}

/**
 * Live proxy enforcement: allow only if already allowlisted.
 * `ask` and `deny` both reject (fail-closed for unknown mid-flight hosts).
 */
export function decideProxyHost(
	host: string,
	evaluateHost: HostEvaluator = defaultEvaluateHost,
): { allow: boolean; decision: HostDecision; reason?: string } {
	const decision = evaluateHost(host);
	if (decision === "allow") return { allow: true, decision };
	if (decision === "deny") {
		return {
			allow: false,
			decision,
			reason: `network policy denied host: ${host}`,
		};
	}
	return {
		allow: false,
		decision,
		reason: `network policy requires pre-exec approval for host: ${host} (live proxy fail-closed on ask)`,
	};
}

function writeConnectReject(socket: net.Socket, status: number, reason: string): void {
	const body = reason;
	const msg =
		`HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : "Bad Request"}\r\n` +
		`Connection: close\r\n` +
		`Content-Type: text/plain; charset=utf-8\r\n` +
		`Content-Length: ${Buffer.byteLength(body)}\r\n` +
		`\r\n` +
		body;
	try {
		socket.write(msg);
	} catch {
		// ignore
	}
	try {
		socket.destroy();
	} catch {
		// ignore
	}
}

function handleConnect(
	req: http.IncomingMessage,
	clientSocket: net.Socket,
	head: Buffer,
	evaluateHost: HostEvaluator,
): void {
	const authority = req.url || "";
	const target = parseConnectAuthority(authority);
	if (!target) {
		writeConnectReject(clientSocket, 400, `invalid CONNECT target: ${authority}`);
		return;
	}

	const verdict = decideProxyHost(target.host, evaluateHost);
	recordProxyAudit({
		host: target.host,
		decision: verdict.decision,
		allowed: verdict.allow,
		method: "CONNECT",
		reason: verdict.reason,
	});
	if (!verdict.allow) {
		writeConnectReject(clientSocket, 403, verdict.reason || `denied: ${target.host}`);
		return;
	}

	const serverSocket = net.connect(target.port, target.host, () => {
		try {
			clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
			if (head.length) serverSocket.write(head);
			serverSocket.pipe(clientSocket);
			clientSocket.pipe(serverSocket);
		} catch {
			serverSocket.destroy();
			clientSocket.destroy();
		}
	});

	serverSocket.on("error", () => {
		if (!clientSocket.destroyed) {
			writeConnectReject(clientSocket, 502, `bad gateway: ${target.host}:${target.port}`);
		}
	});
	clientSocket.on("error", () => {
		serverSocket.destroy();
	});
}

function handleAbsoluteForm(
	clientReq: http.IncomingMessage,
	clientRes: http.ServerResponse,
	evaluateHost: HostEvaluator,
): void {
	const rawUrl = clientReq.url || "";
	let hostname: string;
	let port: number;
	let pathWithQuery: string;

	try {
		// Absolute-form: http://host:port/path
		if (/^https?:\/\//i.test(rawUrl)) {
			const u = new URL(rawUrl);
			hostname = u.hostname;
			port = u.port ? Number.parseInt(u.port, 10) : u.protocol === "https:" ? 443 : 80;
			pathWithQuery = `${u.pathname}${u.search}`;
		} else {
			// Origin-form with Host header (some clients)
			const hostHeader = clientReq.headers.host || "";
			const parsed = parseConnectAuthority(hostHeader);
			if (!parsed) {
				clientRes.writeHead(400, { "Content-Type": "text/plain" });
				clientRes.end("missing or invalid Host");
				return;
			}
			hostname = parsed.host;
			port = parsed.port === 443 && !hostHeader.includes(":") ? 80 : parsed.port;
			// If Host had no port, prefer 80 for plain HTTP
			if (!hostHeader.includes(":") && !hostHeader.includes("]")) {
				port = 80;
			}
			pathWithQuery = rawUrl || "/";
		}
	} catch {
		clientRes.writeHead(400, { "Content-Type": "text/plain" });
		clientRes.end("invalid request URL");
		return;
	}

	const verdict = decideProxyHost(hostname, evaluateHost);
	recordProxyAudit({
		host: hostname,
		decision: verdict.decision,
		allowed: verdict.allow,
		method: "HTTP",
		reason: verdict.reason,
	});
	if (!verdict.allow) {
		clientRes.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
		clientRes.end(verdict.reason || `denied: ${hostname}`);
		return;
	}

	const headers = { ...clientReq.headers };
	// Avoid hop-by-hop proxy loops
	delete headers["proxy-connection"];
	delete headers["proxy-authorization"];

	const upstream = http.request(
		{
			hostname,
			port,
			path: pathWithQuery,
			method: clientReq.method,
			headers,
		},
		(upRes) => {
			clientRes.writeHead(upRes.statusCode || 502, upRes.headers);
			upRes.pipe(clientRes);
		},
	);

	upstream.on("error", () => {
		if (!clientRes.headersSent) {
			clientRes.writeHead(502, { "Content-Type": "text/plain" });
		}
		clientRes.end(`bad gateway: ${hostname}:${port}`);
	});

	clientReq.pipe(upstream);
}

/**
 * Start the loopback cooperative proxy. Idempotent while running.
 * When `force` is false (default), no-ops unless the feature flag is on —
 * actually throws/rejects if flag off without force so callers use ensure*.
 */
export async function startAgentHttpProxy(
	options: StartAgentHttpProxyOptions = {},
): Promise<AgentHttpProxyInfo> {
	if (!options.force && !isAgentHttpProxyEnabled()) {
		throw new Error(
			`${AGENT_HTTP_PROXY_ENV_FLAG} is not enabled; cooperative agent HTTP proxy will not start`,
		);
	}

	if (state) {
		return { host: state.host, port: state.port, url: `http://${state.host}:${state.port}` };
	}

	if (startPromise) return startPromise;

	const listenHost = options.host ?? "127.0.0.1";
	const listenPort = options.port ?? 0;
	const evaluateHost = options.evaluateHost ?? defaultEvaluateHost;

	startPromise = new Promise<AgentHttpProxyInfo>((resolve, reject) => {
		const server = http.createServer((req, res) => {
			handleAbsoluteForm(req, res, evaluateHost);
		});

		server.on("connect", (req, socket, head) => {
			// Node types may type CONNECT socket as Duplex; runtime is a net.Socket.
			handleConnect(req, socket as net.Socket, head, evaluateHost);
		});

		server.once("error", (err) => {
			startPromise = null;
			reject(err);
		});

		server.listen(listenPort, listenHost, () => {
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				startPromise = null;
				server.close();
				reject(new Error("agent HTTP proxy failed to bind"));
				return;
			}
			state = {
				server,
				host: listenHost,
				port: addr.port,
				evaluateHost,
			};
			startPromise = null;
			resolve({
				host: listenHost,
				port: addr.port,
				url: `http://${listenHost}:${addr.port}`,
			});
		});
	});

	try {
		return await startPromise;
	} catch (err) {
		startPromise = null;
		throw err;
	}
}

/**
 * Ensure the proxy is running when the feature flag is on.
 * Returns null when the flag is off (default) — no process, no env inject.
 */
export async function ensureAgentHttpProxy(
	options: Omit<StartAgentHttpProxyOptions, "force"> = {},
): Promise<AgentHttpProxyInfo | null> {
	if (!isAgentHttpProxyEnabled()) return null;
	return startAgentHttpProxy({ ...options, force: false });
}

/** Sync snapshot; null if never started or already stopped. */
export function getAgentHttpProxyInfo(): AgentHttpProxyInfo | null {
	if (!state) return null;
	return {
		host: state.host,
		port: state.port,
		url: `http://${state.host}:${state.port}`,
	};
}

/**
 * Stop the loopback proxy. Safe if never started.
 * Does not clear session network policy.
 */
export async function stopAgentHttpProxy(): Promise<void> {
	const current = state;
	state = null;
	startPromise = null;
	if (!current) return;

	await new Promise<void>((resolve) => {
		current.server.close(() => resolve());
		// Force-close hung keep-alives
		current.server.closeAllConnections?.();
	});
}

function mergeNoProxy(existing: string | undefined): string {
	const parts = new Set<string>();
	for (const chunk of `${existing || ""},${DEFAULT_NO_PROXY}`.split(",")) {
		const t = chunk.trim();
		if (t) parts.add(t);
	}
	return [...parts].join(",");
}

/**
 * Inject HTTP(S)_PROXY env for cooperative clients when the proxy is running
 * and the feature flag is on. No-op when flag off or proxy not started.
 *
 * Sets both upper and lower case proxy vars (curl/git/python conventions).
 */
export function applyAgentProxyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	// Flag may be set on the env being built or on process.env (bash spawn path).
	if (!isAgentHttpProxyEnabled(env) && !isAgentHttpProxyEnabled(process.env)) {
		return env;
	}

	const info = getAgentHttpProxyInfo();
	if (!info) return env;

	const proxyUrl = info.url;
	const next: NodeJS.ProcessEnv = { ...env };
	next.HTTP_PROXY = proxyUrl;
	next.HTTPS_PROXY = proxyUrl;
	next.http_proxy = proxyUrl;
	next.https_proxy = proxyUrl;
	next.NO_PROXY = mergeNoProxy(env.NO_PROXY ?? env.no_proxy);
	next.no_proxy = next.NO_PROXY;
	return next;
}
