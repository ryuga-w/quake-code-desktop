import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MINIMAX_HOME = mkdtempSync(join(tmpdir(), "minimax-auth-test-"));

function writeAuthFile(accessToken: string): void {
	mkdirSync(MINIMAX_HOME, { recursive: true });
	const payload = {
		version: 1,
		updatedAtMs: Date.now(),
		auth: {
			accessToken,
			userEmail: "test@example.com",
			userName: "Test User",
		},
	};
	writeFileSync(join(MINIMAX_HOME, "local-runtime.auth.json"), JSON.stringify(payload, null, 2), "utf-8");
}

describe("minimax-auth and models", () => {
	const originalMinimaxHome = process.env.MINIMAX_HOME;
	const originalEnvKey = process.env.MINIMAX_API_KEY;

	beforeEach(() => {
		process.env.MINIMAX_HOME = MINIMAX_HOME;
		delete process.env.MINIMAX_API_KEY;
		delete process.env.MINIMAX_CN_API_KEY;
		vi.resetModules();
	});

	afterEach(() => {
		if (originalMinimaxHome === undefined) delete process.env.MINIMAX_HOME;
		else process.env.MINIMAX_HOME = originalMinimaxHome;

		if (originalEnvKey === undefined) delete process.env.MINIMAX_API_KEY;
		else process.env.MINIMAX_API_KEY = originalEnvKey;

		rmSync(MINIMAX_HOME, { recursive: true, force: true });
	});

	it("reads access token from ~/.minimax/local-runtime.auth.json", async () => {
		writeAuthFile("test-jwt-access-token-12345");
		const { clearMiniMaxAuthCache, ensureMiniMaxAuthReady, getMiniMaxAuthToken } = await import("../src/minimax-auth.ts");
		await ensureMiniMaxAuthReady();
		clearMiniMaxAuthCache();

		const token = getMiniMaxAuthToken();
		expect(token).toBe("test-jwt-access-token-12345");
	});

	it("prioritizes MINIMAX_API_KEY env var when provided", async () => {
		writeAuthFile("test-jwt-access-token-12345");
		process.env.MINIMAX_API_KEY = "env-minimax-key-override";

		const { clearMiniMaxAuthCache, ensureMiniMaxAuthReady, getMiniMaxAuthToken } = await import("../src/minimax-auth.js");
		await ensureMiniMaxAuthReady();
		clearMiniMaxAuthCache();

		const token = getMiniMaxAuthToken();
		expect(token).toBe("env-minimax-key-override");
	});

	it("resolves via getEnvApiKey for minimax provider", async () => {
		writeAuthFile("test-jwt-access-token-12345");
		const { clearMiniMaxAuthCache, ensureMiniMaxAuthReady } = await import("../src/minimax-auth.ts");
		await ensureMiniMaxAuthReady();
		const { getEnvApiKey } = await import("../src/env-api-keys.ts");
		clearMiniMaxAuthCache();

		const token = getEnvApiKey("minimax");
		expect(token).toBe("test-jwt-access-token-12345");
	});

	it("registers MiniMax-M3, MiniMax-M2.7, and MiniMax-M2.7-highspeed in model catalog", async () => {
		const { getModel } = await import("../src/models.ts");
		const m3 = getModel("minimax", "MiniMax-M3");
		const m27 = getModel("minimax", "MiniMax-M2.7");
		const m27Hs = getModel("minimax", "MiniMax-M2.7-highspeed");

		expect(m3).toBeDefined();
		expect(m3?.id).toBe("MiniMax-M3");
		expect(m3?.contextWindow).toBe(450000);

		expect(m27).toBeDefined();
		expect(m27?.id).toBe("MiniMax-M2.7");

		expect(m27Hs).toBeDefined();
		expect(m27Hs?.id).toBe("MiniMax-M2.7-highspeed");
	});
});
