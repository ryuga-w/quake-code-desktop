import { describe, expect, it } from "vitest";
import type { Tool } from "../src/types.js";

// Import internal helper via re-export pattern — test convertTools behavior through exported function
import { anthropicBetaFeaturesForTools } from "../dist/providers/anthropic.js";

describe("anthropic computer tool support", () => {
	it("adds computer-use beta when native computer tool is present", () => {
		const tools: Tool[] = [
			{
				name: "computer",
				description: "desktop",
				parameters: {} as Tool["parameters"],
				anthropicNative: { type: "computer_20250124", displayWidthPx: 1280, displayHeightPx: 800 },
			},
		];
		const betas = anthropicBetaFeaturesForTools(tools, ["fine-grained-tool-streaming-2025-05-14"]);
		expect(betas).toContain("computer-use-2025-01-24");
		expect(betas).toContain("fine-grained-tool-streaming-2025-05-14");
	});

	it("does not add computer beta for custom tools only", () => {
		const tools: Tool[] = [
			{ name: "desktop_screenshot", description: "shot", parameters: {} as Tool["parameters"] },
		];
		const betas = anthropicBetaFeaturesForTools(tools, []);
		expect(betas).not.toContain("computer-use-2025-01-24");
	});
});