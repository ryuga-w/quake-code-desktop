import { describe, expect, it } from "vitest";
import { getCurrentMessageImages } from "../src/bundled/extensions/quake-subagents/index.js";

describe("quake subagents message image extraction", () => {
	it("allows desktop tool contexts without messages", () => {
		expect(getCurrentMessageImages(undefined)).toEqual([]);
	});

	it("forwards images from the latest user message", () => {
		const image = { type: "image", data: "abc", mimeType: "image/png" } as const;
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "ready" }] },
			{ role: "user", content: [{ type: "text", text: "inspect" }, image] },
		] as any;

		expect(getCurrentMessageImages(messages)).toEqual([image]);
	});
});
