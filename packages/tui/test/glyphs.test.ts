import assert from "node:assert";
import { describe, it } from "node:test";
import { supportsRichGlyphs } from "../src/glyphs.js";

describe("supportsRichGlyphs", () => {
	it("honors explicit ASCII and Unicode overrides", () => {
		assert.strictEqual(supportsRichGlyphs({ QUAKE_ASCII: "1", QUAKE_UNICODE: "1" }, "linux"), false);
		assert.strictEqual(supportsRichGlyphs({ QUAKE_UNICODE: "1" }, "win32"), true);
	});

	it("accepts modern Windows terminals and rejects unidentified conhost", () => {
		assert.strictEqual(supportsRichGlyphs({ WT_SESSION: "session" }, "win32"), true);
		assert.strictEqual(supportsRichGlyphs({ TERM_PROGRAM: "vscode" }, "win32"), true);
		assert.strictEqual(supportsRichGlyphs({}, "win32"), false);
	});

	it("defaults to rich glyphs outside Windows", () => {
		assert.strictEqual(supportsRichGlyphs({}, "linux"), true);
	});
});
