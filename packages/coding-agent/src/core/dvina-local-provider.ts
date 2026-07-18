import type { ProviderConfigInput } from "./model-registry.js";

const DVINA_LOCAL_PROVIDER_ID = "dvina-local";
const DEFAULT_DVINA_LOCAL_BASE_URL = "http://127.0.0.1:3210/v1";
const DEFAULT_DVINA_LOCAL_API_KEY = "sk-local-test";

function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function shouldEnableDvinaLocalProvider(): boolean {
	return !isTruthyEnvFlag(process.env.QUAKE_CODE_DISABLE_DVINA_LOCAL);
}

export function getDvinaLocalProviderConfig(): { name: string; config: ProviderConfigInput } {
	const baseUrl = process.env.DVINA_LOCAL_PROXY_URL || DEFAULT_DVINA_LOCAL_BASE_URL;
	const apiKey = process.env.DVINA_LOCAL_API_KEY || DEFAULT_DVINA_LOCAL_API_KEY;

	return {
		name: DVINA_LOCAL_PROVIDER_ID,
		config: {
			baseUrl,
			apiKey,
			api: "openai-responses",
			authHeader: true,
			models: [
				{
					id: "gpt-5.4",
					name: "GPT-5.4",
					reasoning: true,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 400000,
					maxTokens: 128000,
				},
				{
					id: "gpt-5.3-codex",
					name: "GPT-5.3 Codex",
					reasoning: true,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 400000,
					maxTokens: 128000,
				},
				{
					id: "kimi-k2.5",
					name: "Kimi K2.5",
					reasoning: true,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 256000,
					maxTokens: 64000,
				},
			],
		},
	};
}

export function registerDvinaLocalProvider(modelRegistry: {
	registerProvider: (name: string, config: ProviderConfigInput) => void;
}): void {
	if (!shouldEnableDvinaLocalProvider()) {
		return;
	}

	const { name, config } = getDvinaLocalProviderConfig();
	modelRegistry.registerProvider(name, config);
}
