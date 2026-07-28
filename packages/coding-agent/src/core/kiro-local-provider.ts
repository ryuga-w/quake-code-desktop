import type { ProviderConfigInput } from "./model-registry.js";

const KIRO_LOCAL_PROVIDER_ID = "kiro-local";
const DEFAULT_KIRO_LOCAL_BASE_URL = "http://127.0.0.1:3210/v1";
const DEFAULT_KIRO_LOCAL_API_KEY = "sk-local-test";

function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function shouldEnableKiroLocalProvider(): boolean {
	return !isTruthyEnvFlag(process.env.QUAKE_CODE_DISABLE_KIRO_LOCAL);
}

export function getKiroLocalProviderConfig(): { name: string; config: ProviderConfigInput } {
	const baseUrl = process.env.KIRO_LOCAL_PROXY_URL || process.env.DVINA_LOCAL_PROXY_URL || DEFAULT_KIRO_LOCAL_BASE_URL;
	const apiKey = process.env.KIRO_LOCAL_API_KEY || process.env.DVINA_LOCAL_API_KEY || DEFAULT_KIRO_LOCAL_API_KEY;

	return {
		name: KIRO_LOCAL_PROVIDER_ID,
		config: {
			baseUrl,
			apiKey,
			api: "openai-responses",
			authHeader: true,
			models: [
				{
					id: "auto",
					name: "Kiro Local Auto",
					reasoning: true,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 400000,
					maxTokens: 128000,
				},
				{
					id: "claude-sonnet-4.5",
					name: "Claude Sonnet 4.5",
					reasoning: true,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 64000,
				},
				{
					id: "claude-sonnet-4",
					name: "Claude Sonnet 4",
					reasoning: true,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 64000,
				},
				{
					id: "claude-haiku-4.5",
					name: "Claude Haiku 4.5",
					reasoning: false,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 64000,
				},
				{
					id: "deepseek-3.2",
					name: "DeepSeek 3.2",
					reasoning: false,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 164000,
					maxTokens: 64000,
				},
				{
					id: "minimax-m2.5",
					name: "MiniMax M2.5",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 196000,
					maxTokens: 64000,
				},
				{
					id: "minimax-m2.1",
					name: "MiniMax M2.1",
					reasoning: false,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 196000,
					maxTokens: 64000,
				},
				{
					id: "glm-5",
					name: "GLM 5",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 64000,
				},
				{
					id: "qwen3-coder-next",
					name: "Qwen3 Coder Next",
					reasoning: false,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 256000,
					maxTokens: 64000,
				},
			],
		},
	};
}

export function registerKiroLocalProvider(modelRegistry: {
	registerProvider: (name: string, config: ProviderConfigInput) => void;
}): void {
	if (!shouldEnableKiroLocalProvider()) {
		return;
	}

	const { name, config } = getKiroLocalProviderConfig();
	modelRegistry.registerProvider(name, config);
}
