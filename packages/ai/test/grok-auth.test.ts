import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GROK_HOME = mkdtempSync(join(tmpdir(), "grok-auth-test-"));

function mkdirForGrokHome(): void {
	mkdirSync(GROK_HOME, { recursive: true });
}

function writeAuthFile(payload: Record<string, unknown>): void {
	mkdirForGrokHome();
	writeFileSync(join(GROK_HOME, "auth.json"), JSON.stringify(payload, null, 2), "utf-8");
	writeFileSync(join(GROK_HOME, "version.json"), JSON.stringify({ version: "0.2.64" }), "utf-8");
}

describe("grok-auth refresh", () => {
	const originalGrokHome = process.env.GROK_HOME;
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		process.env.GROK_HOME = GROK_HOME;
		delete process.env.GROK_AUTH_TOKEN;
		delete process.env.XAI_API_KEY;
		vi.resetModules();
	});

	afterEach(() => {
		if (originalGrokHome === undefined) delete process.env.GROK_HOME;
		else process.env.GROK_HOME = originalGrokHome;
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
		rmSync(GROK_HOME, { recursive: true, force: true });
		mkdirForGrokHome();
	});

	it("refreshes expired ~/.grok tokens via oauth2/token and persists auth.json", async () => {
		const expiredAt = new Date(Date.now() - 60_000).toISOString();
		const storageKey = "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828";
		writeAuthFile({
			[storageKey]: {
				key: "old-access-token",
				refresh_token: "old-refresh-token",
				expires_at: expiredAt,
				oidc_client_id: "b1a00492-073a-47ea-816f-4c329264a828",
			},
		});

		globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes(".well-known/openid-configuration")) {
				return new Response(JSON.stringify({ token_endpoint: "https://auth.x.ai/oauth2/token" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (url === "https://auth.x.ai/oauth2/token") {
				return new Response(
					JSON.stringify({
						access_token: "new-access-token",
						refresh_token: "new-refresh-token",
						expires_in: 3600,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response("not found", { status: 404 });
		}) as typeof fetch;

		const { clearGrokAuthCache, ensureFreshGrokAuthToken } = await import("../src/grok-auth.js");
		clearGrokAuthCache();

		const token = await ensureFreshGrokAuthToken({ force: true });
		expect(token).toBe("new-access-token");

		const saved = JSON.parse(readFileSync(join(GROK_HOME, "auth.json"), "utf-8")) as Record<string, any>;
		expect(saved[storageKey].key).toBe("new-access-token");
		expect(saved[storageKey].refresh_token).toBe("new-refresh-token");
		expect(saved[storageKey].expires_at).toBeTruthy();
	});

	it("skips network refresh when token is still valid", async () => {
		const futureExpiry = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
		writeAuthFile({
			"https://auth.x.ai::client": {
				key: "valid-access-token",
				refresh_token: "refresh-token",
				expires_at: futureExpiry,
			},
		});

		const fetchMock = vi.fn();
		globalThis.fetch = fetchMock as typeof fetch;

		const { clearGrokAuthCache, ensureFreshGrokAuthToken } = await import("../src/grok-auth.js");
		clearGrokAuthCache();

		const token = await ensureFreshGrokAuthToken();
		expect(token).toBe("valid-access-token");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
