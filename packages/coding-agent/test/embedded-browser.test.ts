import { afterEach, describe, expect, it } from "vitest";
import {
	EMBEDDED_UA_MARKER,
	isEmbeddedBrowserCandidate,
	isEmbeddedByUserAgent,
	isEmbeddedModeRequired,
	isShellUrl,
	shellUrlPattern,
} from "../src/bundled/extensions/quake-browser-tools/embedded-browser.js";
import { electronBridgeBase } from "../src/bundled/extensions/quake-browser-tools/electron-bridge.js";

describe("embedded-browser helpers", () => {
	const prevEmbedded = process.env.QUAKE_BROWSER_EMBEDDED;
	const prevPort = process.env.QUAKE_WEB_PORT;

	afterEach(() => {
		if (prevEmbedded === undefined) delete process.env.QUAKE_BROWSER_EMBEDDED;
		else process.env.QUAKE_BROWSER_EMBEDDED = prevEmbedded;
		if (prevPort === undefined) delete process.env.QUAKE_WEB_PORT;
		else process.env.QUAKE_WEB_PORT = prevPort;
	});

	it("detects embedded mode env", () => {
		process.env.QUAKE_BROWSER_EMBEDDED = "1";
		expect(isEmbeddedModeRequired()).toBe(true);
		process.env.QUAKE_BROWSER_EMBEDDED = "true";
		expect(isEmbeddedModeRequired()).toBe(true);
		delete process.env.QUAKE_BROWSER_EMBEDDED;
		expect(isEmbeddedModeRequired()).toBe(false);
	});

	it("matches shell urls with dynamic port", () => {
		process.env.QUAKE_WEB_PORT = "4821";
		expect(shellUrlPattern().test("http://127.0.0.1:4821/")).toBe(true);
		expect(shellUrlPattern().test("http://127.0.0.1:5173/")).toBe(true);
		expect(isShellUrl("http://127.0.0.1:4821/chat")).toBe(true);
		expect(isShellUrl("https://example.com/")).toBe(false);
	});

	it("accepts embedded UA marker including about:blank", () => {
		const ua = `Mozilla/5.0 QuakeEmbeddedBrowser/1`;
		expect(isEmbeddedByUserAgent(ua)).toBe(true);
		expect(isEmbeddedBrowserCandidate("about:blank", ua)).toBe(true);
		expect(isEmbeddedBrowserCandidate("http://127.0.0.1:5173/", ua)).toBe(true);
	});

	it("rejects shell without embedded marker", () => {
		expect(isEmbeddedBrowserCandidate("http://127.0.0.1:5173/", "Mozilla/5.0")).toBe(false);
		expect(isEmbeddedBrowserCandidate("about:blank", "Mozilla/5.0")).toBe(false);
	});

	it("exports stable UA marker", () => {
		expect(EMBEDDED_UA_MARKER).toBe("QuakeEmbeddedBrowser/1");
	});

	it("defaults electron bridge base to localhost:9223", () => {
		delete process.env.QUAKE_BROWSER_BRIDGE_PORT;
		delete process.env.QUAKE_CDP_HOST;
		expect(electronBridgeBase()).toBe("http://127.0.0.1:9223");
	});
});