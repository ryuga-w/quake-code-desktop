import { describe, expect, it } from "vitest";
import { type ModelRegistry, resolveModel } from "../src/bundled/extensions/quake-subagents/model-resolver.js";

const models = [
	{ provider: "anthropic", id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
	{ provider: "openai", id: "gpt-5.5", name: "GPT 5.5" },
	{ provider: "openai", id: "gpt-5.4", name: "GPT 5.4" },
];

const registry: ModelRegistry = {
	find(provider: string, modelId: string) {
		return models.find((model) => model.provider === provider && model.id === modelId);
	},
	getAll() {
		return models;
	},
	getAvailable() {
		return models;
	},
};

describe("quake subagents model resolver", () => {
	it("resolves an explicit provider/model override exactly", () => {
		const resolved = resolveModel("openai/gpt-5.5", registry);

		expect(typeof resolved).not.toBe("string");
		expect(resolved).toMatchObject({ provider: "openai", id: "gpt-5.5" });
	});

	it("resolves a fuzzy model override without falling back to Haiku", () => {
		const resolved = resolveModel("gpt-5.5", registry);

		expect(typeof resolved).not.toBe("string");
		expect(resolved).toMatchObject({ provider: "openai", id: "gpt-5.5" });
	});

	it("returns a clear error when an explicit model is unavailable", () => {
		const unavailableRegistry: ModelRegistry = {
			...registry,
			getAvailable() {
				return models.filter((model) => model.provider !== "openai");
			},
		};

		const resolved = resolveModel("openai/gpt-5.5", unavailableRegistry);

		expect(typeof resolved).toBe("string");
		expect(resolved).toContain('Model not found: "openai/gpt-5.5"');
		expect(resolved).not.toContain("  openai/gpt-5.5");
	});
});
