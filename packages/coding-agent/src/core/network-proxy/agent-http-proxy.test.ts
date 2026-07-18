import * as http from "node:http";
import * as net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { HostDecision } from "../network-policy/policy.js";
import {
	applyAgentProxyEnv,
	clearProxyAuditLog,
	ensureAgentHttpProxy,
	getAgentHttpProxyInfo,
	getProxyAuditLog,
	isAgentHttpProxyEnabled,
	parseConnectAuthority,
	setProxyAuditCapacity,
	shouldAutoEnableAgentHttpProxy,
	startAgentHttpProxy,
	stopAgentHttpProxy,
} from "./agent-http-proxy.js";

async function listenTestServer(
	handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
	const server = http.createServer(handler);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const addr = server.address();
	if (!addr || typeof addr === "string") throw new Error("test server bind failed");
	return {
		server,
		port: addr.port,
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve());
			}),
	};
}

function connectViaProxy(
	proxyPort: number,
	targetHost: string,
	targetPort: number,
): Promise<{ statusLine: string; body: string }> {
	return new Promise((resolve, reject) => {
		const socket = net.connect(proxyPort, "127.0.0.1", () => {
			socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
		});
		let buf = "";
		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error("CONNECT timeout"));
		}, 5000);
		socket.on("data", (chunk) => {
			buf += chunk.toString("utf8");
			if (buf.includes("\r\n\r\n")) {
				clearTimeout(timer);
				const [header, ...rest] = buf.split("\r\n\r\n");
				const statusLine = header.split("\r\n")[0] || "";
				// On 200 we would have a tunnel; for deny we get a body in the same response.
				const body = rest.join("\r\n\r\n");
				socket.destroy();
				resolve({ statusLine, body });
			}
		});
		socket.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

/** Absolute-form GET through the proxy using raw sockets (reliable for policy tests). */
function absoluteFormGetViaProxy(
	proxyPort: number,
	host: string,
	port: number,
	path = "/",
): Promise<{ statusLine: string; body: string }> {
	return new Promise((resolve, reject) => {
		const socket = net.connect(proxyPort, "127.0.0.1", () => {
			const abs = `http://${host}:${port}${path}`;
			socket.write(`GET ${abs} HTTP/1.1\r\nHost: ${host}:${port}\r\nConnection: close\r\n\r\n`);
		});
		let buf = "";
		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error("GET via proxy timeout"));
		}, 5000);
		socket.on("data", (chunk) => {
			buf += chunk.toString("utf8");
		});
		socket.on("end", () => {
			clearTimeout(timer);
			const [header, ...rest] = buf.split("\r\n\r\n");
			const statusLine = (header || "").split("\r\n")[0] || "";
			resolve({ statusLine, body: rest.join("\r\n\r\n") });
		});
		socket.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

afterEach(async () => {
	await stopAgentHttpProxy();
	delete process.env.QUAKE_AGENT_HTTP_PROXY;
	clearProxyAuditLog();
	setProxyAuditCapacity(200);
});

describe("agent-http-proxy feature flag", () => {
	it("is off by default", () => {
		delete process.env.QUAKE_AGENT_HTTP_PROXY;
		expect(isAgentHttpProxyEnabled()).toBe(false);
	});

	it("accepts 1/true/on/yes", () => {
		for (const v of ["1", "true", "TRUE", "on", "yes"]) {
			expect(isAgentHttpProxyEnabled({ QUAKE_AGENT_HTTP_PROXY: v })).toBe(true);
		}
		expect(isAgentHttpProxyEnabled({ QUAKE_AGENT_HTTP_PROXY: "0" })).toBe(false);
		expect(isAgentHttpProxyEnabled({ QUAKE_AGENT_HTTP_PROXY: "false" })).toBe(false);
	});

	it("ensureAgentHttpProxy is no-op when flag off", async () => {
		delete process.env.QUAKE_AGENT_HTTP_PROXY;
		const info = await ensureAgentHttpProxy();
		expect(info).toBeNull();
		expect(getAgentHttpProxyInfo()).toBeNull();
	});

	it("applyAgentProxyEnv is no-op when flag off", () => {
		delete process.env.QUAKE_AGENT_HTTP_PROXY;
		const env = applyAgentProxyEnv({ PATH: "/bin" });
		expect(env.HTTP_PROXY).toBeUndefined();
		expect(env.HTTPS_PROXY).toBeUndefined();
	});

	it("stopAgentHttpProxy is safe if never started", async () => {
		await expect(stopAgentHttpProxy()).resolves.toBeUndefined();
	});
});

describe("parseConnectAuthority", () => {
	it("parses host:port", () => {
		expect(parseConnectAuthority("example.com:443")).toEqual({ host: "example.com", port: 443 });
	});

	it("parses ipv6", () => {
		expect(parseConnectAuthority("[::1]:8443")).toEqual({ host: "::1", port: 8443 });
	});
});

describe("agent-http-proxy CONNECT policy", () => {
	it("rejects denied host", async () => {
		const evaluateHost = (host: string): HostDecision => (host === "evil.example" ? "deny" : "ask");
		const proxy = await startAgentHttpProxy({ force: true, evaluateHost });
		const result = await connectViaProxy(proxy.port, "evil.example", 443);
		expect(result.statusLine).toMatch(/403/);
		expect(result.body).toMatch(/denied|evil\.example/i);
	});

	it("rejects ask (fail-closed mid-flight)", async () => {
		const evaluateHost = (): HostDecision => "ask";
		const proxy = await startAgentHttpProxy({ force: true, evaluateHost });
		const result = await connectViaProxy(proxy.port, "unknown.example", 443);
		expect(result.statusLine).toMatch(/403/);
		expect(result.body).toMatch(/pre-exec approval|fail-closed|unknown\.example/i);
	});

	it("tunnels allowed host to local test server", async () => {
		const origin = await listenTestServer((_req, res) => {
			// CONNECT tunnels raw TCP; for this test we only verify CONNECT 200,
			// then write a tiny HTTP response over the tunnel.
			res.writeHead(200, { "Content-Type": "text/plain" });
			res.end("origin-ok");
		});

		const evaluateHost = (host: string): HostDecision =>
			host === "127.0.0.1" || host === "localhost" ? "allow" : "deny";

		const proxy = await startAgentHttpProxy({ force: true, evaluateHost });

		// Absolute-form GET exercises allow + forward path (CONNECT also allowlisted).
		const getResult = await absoluteFormGetViaProxy(proxy.port, "127.0.0.1", origin.port, "/");
		expect(getResult.statusLine).toMatch(/200/);
		expect(getResult.body).toContain("origin-ok");

		// CONNECT must succeed (200 Connection Established) for allowed host.
		const connectResult = await connectViaProxy(proxy.port, "127.0.0.1", origin.port);
		expect(connectResult.statusLine).toMatch(/200/);

		await origin.close();
	});
});

describe("agent-http-proxy env inject", () => {
	it("injects HTTP(S)_PROXY when flag on and proxy started", async () => {
		process.env.QUAKE_AGENT_HTTP_PROXY = "1";
		const proxy = await startAgentHttpProxy({ force: true, evaluateHost: () => "allow" });
		const env = applyAgentProxyEnv({ ...process.env, FOO: "bar" });
		expect(env.HTTP_PROXY).toBe(proxy.url);
		expect(env.HTTPS_PROXY).toBe(proxy.url);
		expect(env.http_proxy).toBe(proxy.url);
		expect(env.https_proxy).toBe(proxy.url);
		expect(env.NO_PROXY).toMatch(/localhost/);
		expect(env.NO_PROXY).toMatch(/127\.0\.0\.1/);
		expect(env.no_proxy).toBe(env.NO_PROXY);
		expect(env.FOO).toBe("bar");
	});

	it("does not inject when flag on but proxy not started", () => {
		process.env.QUAKE_AGENT_HTTP_PROXY = "1";
		const env = applyAgentProxyEnv({ PATH: "/x" });
		expect(env.HTTP_PROXY).toBeUndefined();
	});
});

describe("shouldAutoEnableAgentHttpProxy (S-NET.2)", () => {
	it("defaults on for safe / auto / read-only", () => {
		expect(shouldAutoEnableAgentHttpProxy("safe")).toBe(true);
		expect(shouldAutoEnableAgentHttpProxy("auto")).toBe(true);
		expect(shouldAutoEnableAgentHttpProxy("read-only")).toBe(true);
		expect(shouldAutoEnableAgentHttpProxy("disabled")).toBe(true);
		expect(shouldAutoEnableAgentHttpProxy({ id: "auto" })).toBe(true);
		expect(shouldAutoEnableAgentHttpProxy(undefined)).toBe(true);
	});

	it("defaults off for full-access / allow-all", () => {
		expect(shouldAutoEnableAgentHttpProxy("full-access")).toBe(false);
		expect(shouldAutoEnableAgentHttpProxy("allow-all")).toBe(false);
		expect(shouldAutoEnableAgentHttpProxy({ id: "full-access" })).toBe(false);
	});
});

describe("proxy audit log (S-NET.2)", () => {
	it("records deny and allow CONNECT decisions", async () => {
		clearProxyAuditLog();
		const evaluateHost = (host: string): HostDecision =>
			host === "evil.example" ? "deny" : host === "127.0.0.1" || host === "localhost" ? "allow" : "ask";

		const origin = await listenTestServer((_req, res) => {
			res.writeHead(200, { "Content-Type": "text/plain" });
			res.end("ok");
		});
		const proxy = await startAgentHttpProxy({ force: true, evaluateHost });

		const denied = await connectViaProxy(proxy.port, "evil.example", 443);
		expect(denied.statusLine).toMatch(/403/);

		const allowed = await connectViaProxy(proxy.port, "127.0.0.1", origin.port);
		expect(allowed.statusLine).toMatch(/200/);

		const log = getProxyAuditLog();
		expect(log.some((e) => e.host === "evil.example" && e.decision === "deny" && e.allowed === false && e.method === "CONNECT")).toBe(
			true,
		);
		expect(log.some((e) => e.host === "127.0.0.1" && e.decision === "allow" && e.allowed === true && e.method === "CONNECT")).toBe(
			true,
		);
		expect(log.every((e) => typeof e.ts === "number" && e.ts > 0)).toBe(true);

		await origin.close();
	});

	it("ring buffer respects capacity", async () => {
		setProxyAuditCapacity(3);
		clearProxyAuditLog();
		const evaluateHost = (): HostDecision => "deny";
		const proxy = await startAgentHttpProxy({ force: true, evaluateHost });
		for (let i = 0; i < 5; i += 1) {
			await connectViaProxy(proxy.port, `h${i}.example`, 443);
		}
		const log = getProxyAuditLog();
		expect(log.length).toBe(3);
		expect(log.map((e) => e.host)).toEqual(["h2.example", "h3.example", "h4.example"]);
	});
});


