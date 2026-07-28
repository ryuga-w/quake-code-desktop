import { MODELS } from "./models.generated.js";
import type { Api, KnownProvider, Model, OpenAICompletionsCompat, Usage } from "./types.js";

const modelRegistry: Map<string, Map<string, Model<Api>>> = new Map();

// Initialize registry from MODELS
for (const [provider, models] of Object.entries(MODELS)) {
	const providerModels = new Map<string, Model<Api>>();
	for (const [id, model] of Object.entries(models)) {
		providerModels.set(id, model as Model<Api>);
	}
	modelRegistry.set(provider, providerModels);
}

// 🚀 EMBEDDED 9ROUTER PROVIDER
const nineRouterModels = new Map<string, Model<any>>();

const create9RouterModel = (id: string, name: string, reasoning = true) => ({
	id,
	name,
	api: "openai-completions" as const,
	provider: "9router" as const,
	baseUrl: "http://127.0.0.1:20128/v1",
	reasoning,
	input: ["text", "image"] as Array<"text" | "image">,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 400000,
	maxTokens: 128000,
});

// Kiro Models via 9router
nineRouterModels.set(
	"kr/claude-sonnet-4.5-thinking-agentic",
	create9RouterModel("kr/claude-sonnet-4.5-thinking-agentic", "Claude 4.5 Sonnet (Thinking + Agentic)"),
);
nineRouterModels.set(
	"kr/claude-sonnet-4.5-thinking",
	create9RouterModel("kr/claude-sonnet-4.5-thinking", "Claude 4.5 Sonnet (Thinking)"),
);
nineRouterModels.set(
	"kr/claude-sonnet-4.5-agentic",
	create9RouterModel("kr/claude-sonnet-4.5-agentic", "Claude 4.5 Sonnet (Agentic)"),
);
nineRouterModels.set("kr/claude-sonnet-4.5", create9RouterModel("kr/claude-sonnet-4.5", "Claude 4.5 Sonnet"));
nineRouterModels.set(
	"kr/claude-haiku-4.5-thinking-agentic",
	create9RouterModel("kr/claude-haiku-4.5-thinking-agentic", "Claude 4.5 Haiku (Thinking + Agentic)"),
);
nineRouterModels.set(
	"kr/claude-haiku-4.5-thinking",
	create9RouterModel("kr/claude-haiku-4.5-thinking", "Claude 4.5 Haiku (Thinking)"),
);
nineRouterModels.set(
	"kr/claude-haiku-4.5-agentic",
	create9RouterModel("kr/claude-haiku-4.5-agentic", "Claude 4.5 Haiku (Agentic)"),
);
nineRouterModels.set("kr/claude-haiku-4.5", create9RouterModel("kr/claude-haiku-4.5", "Claude 4.5 Haiku"));
nineRouterModels.set("kr/deepseek-3.2", create9RouterModel("kr/deepseek-3.2", "DeepSeek 3.2", false));
nineRouterModels.set("kr/qwen3-coder-next", create9RouterModel("kr/qwen3-coder-next", "Qwen3 Coder Next", false));
nineRouterModels.set("kr/glm-5", create9RouterModel("kr/glm-5", "GLM 5", false));
nineRouterModels.set("kr/glm-5.1", create9RouterModel("kr/glm-5.1", "GLM 5.1", false));

// Cloudflare AI Models via 9router
nineRouterModels.set(
	"cf/@cf/meta/llama-3.2-1b-instruct",
	create9RouterModel("cf/@cf/meta/llama-3.2-1b-instruct", "Llama 3.2 1B Instruct", false),
);
nineRouterModels.set(
	"cf/@cf/meta/llama-3.2-3b-instruct",
	create9RouterModel("cf/@cf/meta/llama-3.2-3b-instruct", "Llama 3.2 3B Instruct", false),
);
nineRouterModels.set(
	"cf/@cf/meta/llama-3.1-8b-instruct-fp8-fast",
	create9RouterModel("cf/@cf/meta/llama-3.1-8b-instruct-fp8-fast", "Llama 3.1 8B Instruct FP8 Fast", false),
);
nineRouterModels.set(
	"cf/@cf/meta/llama-3.1-8b-instruct-awq",
	create9RouterModel("cf/@cf/meta/llama-3.1-8b-instruct-awq", "Llama 3.1 8B Instruct AWQ", false),
);
nineRouterModels.set(
	"cf/@cf/meta/llama-3.1-70b-instruct-fp8-fast",
	create9RouterModel("cf/@cf/meta/llama-3.1-70b-instruct-fp8-fast", "Llama 3.1 70B Instruct FP8 Fast"),
);
nineRouterModels.set(
	"cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
	create9RouterModel("cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast", "Llama 3.3 70B Instruct FP8 Fast"),
);
nineRouterModels.set(
	"cf/@cf/mistralai/mistral-small-3.1-24b-instruct",
	create9RouterModel("cf/@cf/mistralai/mistral-small-3.1-24b-instruct", "Mistral Small 3.1 24B Instruct", false),
);
nineRouterModels.set(
	"cf/@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
	create9RouterModel("cf/@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", "DeepSeek R1 Distill Qwen 32B"),
);
nineRouterModels.set("cf/@cf/qwen/qwq-32b", create9RouterModel("cf/@cf/qwen/qwq-32b", "QwQ 32B"));
nineRouterModels.set(
	"cf/@cf/qwen/qwen2.5-coder-32b-instruct",
	create9RouterModel("cf/@cf/qwen/qwen2.5-coder-32b-instruct", "Qwen 2.5 Coder 32B Instruct", false),
);
nineRouterModels.set("cf/@cf/moonshotai/kimi-k2.5", create9RouterModel("cf/@cf/moonshotai/kimi-k2.5", "Kimi K2.5"));
nineRouterModels.set("cf/@cf/moonshotai/kimi-k2.6", create9RouterModel("cf/@cf/moonshotai/kimi-k2.6", "Kimi K2.6"));

// Qoder Models via 9router
nineRouterModels.set("qd/qmodel_latest", create9RouterModel("qd/qmodel_latest", "Qwen3.7-Max"));

// BytePlus Models via 9router
nineRouterModels.set("bpm/seed-2-0-pro-260328", create9RouterModel("bpm/seed-2-0-pro-260328", "Seed 2.0 Pro"));
nineRouterModels.set(
	"bpm/seed-2-0-code-preview-260328",
	create9RouterModel("bpm/seed-2-0-code-preview-260328", "Seed 2.0 Code Preview", false),
);
nineRouterModels.set(
	"bpm/seed-2-0-mini-260215",
	create9RouterModel("bpm/seed-2-0-mini-260215", "Seed 2.0 Mini", false),
);
nineRouterModels.set(
	"bpm/seed-2-0-lite-260228",
	create9RouterModel("bpm/seed-2-0-lite-260228", "Seed 2.0 Lite", false),
);
nineRouterModels.set(
	"bpm/kimi-k2-thinking-251104",
	create9RouterModel("bpm/kimi-k2-thinking-251104", "Kimi K2 Thinking (BytePlus)"),
);
nineRouterModels.set("bpm/glm-4-7-251222", create9RouterModel("bpm/glm-4-7-251222", "GLM 4.7 (BytePlus)", false));
nineRouterModels.set(
	"bpm/gpt-oss-120b-250805",
	create9RouterModel("bpm/gpt-oss-120b-250805", "GPT OSS 120B (BytePlus)"),
);

// Gemini Models via 9router
nineRouterModels.set(
	"gc/gemini-3-flash-preview",
	create9RouterModel("gc/gemini-3-flash-preview", "Gemini 3 Flash Preview", false),
);
nineRouterModels.set("gc/gemini-3-pro-preview", create9RouterModel("gc/gemini-3-pro-preview", "Gemini 3 Pro Preview"));
nineRouterModels.set(
	"gemini/gemini-3.5-flash",
	create9RouterModel("gemini/gemini-3.5-flash", "Gemini 3.5 Flash", true),
);
nineRouterModels.set(
	"gemini/gemini-3.1-pro-preview",
	create9RouterModel("gemini/gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview", true),
);
nineRouterModels.set(
	"gemini/gemini-3.1-flash-lite-preview",
	create9RouterModel("gemini/gemini-3.1-flash-lite-preview", "Gemini 3.1 Flash Lite Preview", true),
);
nineRouterModels.set(
	"gemini/gemini-3-flash-preview",
	create9RouterModel("gemini/gemini-3-flash-preview", "Gemini 3 Flash Preview", true),
);
nineRouterModels.set("gemini/gemini-2.5-pro", create9RouterModel("gemini/gemini-2.5-pro", "Gemini 2.5 Pro", true));
nineRouterModels.set(
	"gemini/gemini-2.5-flash",
	create9RouterModel("gemini/gemini-2.5-flash", "Gemini 2.5 Flash", true),
);
nineRouterModels.set(
	"gemini/gemini-2.5-flash-lite",
	create9RouterModel("gemini/gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite", true),
);
nineRouterModels.set("gemini/gemma-4-31b-it", create9RouterModel("gemini/gemma-4-31b-it", "Gemma 4 31B IT", false));

// MiMo / Xiaomi Models via 9router
nineRouterModels.set("mmf/mimo-auto", create9RouterModel("mmf/mimo-auto", "MiMo Auto", false));
nineRouterModels.set("xiaomi/mimo-v2.5", create9RouterModel("xiaomi/mimo-v2.5", "MiMo V2.5"));
nineRouterModels.set("xiaomi/mimo-v2.5-pro", create9RouterModel("xiaomi/mimo-v2.5-pro", "MiMo V2.5 Pro"));
nineRouterModels.set(
	"xiaomi/mimo-v2.5-pro-ultraspeed",
	create9RouterModel("xiaomi/mimo-v2.5-pro-ultraspeed", "MiMo V2.5 Pro UltraSpeed"),
);
nineRouterModels.set("xiaomi/mimo-v2-pro", create9RouterModel("xiaomi/mimo-v2-pro", "MiMo V2 Pro"));
nineRouterModels.set("xiaomi/mimo-v2-omni", create9RouterModel("xiaomi/mimo-v2-omni", "MiMo V2 Omni"));
nineRouterModels.set("xiaomi/mimo-v2-flash", create9RouterModel("xiaomi/mimo-v2-flash", "MiMo V2 Flash", false));

modelRegistry.set("9router", nineRouterModels as any);

// 🚀 QUAKE CODE FREE (OpenCode Zen free tier — Bearer "public", no API key)
// Live-tested 2026-07-09 against https://opencode.ai/zen/v1/chat/completions
const opencodeFreeModels = new Map<string, Model<any>>();

const createOpencodeFreeModel = (
	id: string,
	name: string,
	reasoning = true,
	contextWindow = 200000,
	maxTokens = 128000,
) => ({
	id,
	name,
	api: "openai-completions" as const,
	provider: "opencode-free" as const,
	baseUrl: "https://opencode.ai/zen/v1",
	reasoning,
	input: ["text"] as Array<"text" | "image">,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow,
	maxTokens,
});

// Only IDs that returned HTTP 200 with usage from the free Zen catalog.
opencodeFreeModels.set(
	"deepseek-v4-flash-free",
	createOpencodeFreeModel("deepseek-v4-flash-free", "Quake Free · DeepSeek V4 Flash", true),
);
opencodeFreeModels.set("mimo-v2.5-free", {
	...createOpencodeFreeModel("mimo-v2.5-free", "Quake Free · MiMo V2.5", true),
	input: ["text", "image"] as Array<"text" | "image">,
});
opencodeFreeModels.set(
	"north-mini-code-free",
	createOpencodeFreeModel("north-mini-code-free", "Quake Free · North Mini Code", true),
);
opencodeFreeModels.set(
	"nemotron-3-ultra-free",
	createOpencodeFreeModel("nemotron-3-ultra-free", "Quake Free · Nemotron 3 Ultra", true),
);
opencodeFreeModels.set(
	"big-pickle",
	createOpencodeFreeModel("big-pickle", "Quake Free · Big Pickle", true),
);
opencodeFreeModels.set(
	"hy3-free",
	createOpencodeFreeModel("hy3-free", "Quake Free · HY3", true),
);

modelRegistry.set("opencode-free", opencodeFreeModels as any);

// 🚀 GROK CLI PROVIDER (cli-chat-proxy.grok.com — ~/.grok/auth.json via grok login)
const grokCliModels = new Map<string, Model<any>>();

const createGrokCliModel = (
	id: string,
	name: string,
	reasoning = true,
	contextWindow = 512000,
	maxTokens = 128000,
) => ({
	id,
	name,
	api: "openai-completions" as const,
	provider: "grok-cli" as const,
	baseUrl: "https://cli-chat-proxy.grok.com/v1",
	reasoning,
	input: ["text", "image"] as Array<"text" | "image">,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow,
	maxTokens,
});

grokCliModels.set("grok-build", createGrokCliModel("grok-build", "Grok Build"));
grokCliModels.set("grok-composer-2.5-fast", createGrokCliModel("grok-composer-2.5-fast", "Grok Composer 2.5 Fast"));
grokCliModels.set("grok-composer-2", createGrokCliModel("grok-composer-2", "Grok Composer 2"));

modelRegistry.set("grok-cli", grokCliModels as any);

// 🚀 GROK API PROVIDER (api.x.ai — ~/.grok/auth.json JWT from grok login)
const grokApiModels = new Map<string, Model<any>>();

const createGrokApiModel = (
	id: string,
	name: string,
	reasoning = true,
	contextWindow = 1000000,
	maxTokens = 30000,
) => ({
	id,
	name,
	api: "openai-completions" as const,
	provider: "grok" as const,
	baseUrl: "https://api.x.ai/v1",
	reasoning,
	input: ["text", "image"] as Array<"text" | "image">,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow,
	maxTokens,
});

grokApiModels.set("grok-4.3", createGrokApiModel("grok-4.3", "Grok 4.3"));
grokApiModels.set("grok-4.20-0309-reasoning", createGrokApiModel("grok-4.20-0309-reasoning", "Grok 4.20 (Reasoning)"));
grokApiModels.set(
	"grok-4.20-0309-non-reasoning",
	createGrokApiModel("grok-4.20-0309-non-reasoning", "Grok 4.20 (Non-Reasoning)", false),
);
grokApiModels.set(
	"grok-4.20-multi-agent-0309",
	createGrokApiModel("grok-4.20-multi-agent-0309", "Grok 4.20 Multi-Agent"),
);
grokApiModels.set("grok-build-0.1", createGrokApiModel("grok-build-0.1", "Grok Build 0.1", true, 256000, 256000));

modelRegistry.set("grok", grokApiModels as any);

// 🚀 NVIDIA DIRECT API PROVIDER (api.nvidia.com/v1)
const nvidiaDirectModels = new Map<string, Model<any>>();

const createNvidiaModel = (id: string, name: string, reasoning = true) => ({
	id,
	name,
	api: "openai-completions" as const,
	provider: "nvidia-direct" as const,
	baseUrl: "https://integrate.api.nvidia.com/v1",
	reasoning,
	input: ["text"] as Array<"text" | "image">,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 131072,
	maxTokens: 16384,
});

nvidiaDirectModels.set("openai/gpt-oss-120b", {
	...createNvidiaModel("openai/gpt-oss-120b", "GPT OSS 120B"),
	contextWindow: 131072,
	maxTokens: 65536,
});
nvidiaDirectModels.set("moonshotai/kimi-k2.6", {
	...createNvidiaModel("moonshotai/kimi-k2.6", "Kimi K2.6", false),
	contextWindow: 262144,
	maxTokens: 262142,
});
nvidiaDirectModels.set("z-ai/glm-5.1", { ...createNvidiaModel("z-ai/glm-5.1", "GLM 5.1", false) });
nvidiaDirectModels.set("qwen/qwen3.5-397b-a17b", {
	...createNvidiaModel("qwen/qwen3.5-397b-a17b", "Qwen 3.5 397B A17B", false),
});
nvidiaDirectModels.set(
	"deepseek-ai/deepseek-v4-pro",
	createNvidiaModel("deepseek-ai/deepseek-v4-pro", "DeepSeek V4 Pro"),
);
nvidiaDirectModels.set("deepseek-ai/deepseek-v4-flash", {
	...createNvidiaModel("deepseek-ai/deepseek-v4-flash", "DeepSeek V4 Flash"),
	maxTokens: 65536,
});
nvidiaDirectModels.set("stepfun-ai/step-3.7-flash", createNvidiaModel("stepfun-ai/step-3.7-flash", "Step 3.7 Flash"));
nvidiaDirectModels.set("stepfun-ai/step-3.5-flash", {
	...createNvidiaModel("stepfun-ai/step-3.5-flash", "Step 3.5 Flash", false),
});
nvidiaDirectModels.set("nvidia/nemotron-3-super-120b-a12b", {
	...createNvidiaModel("nvidia/nemotron-3-super-120b-a12b", "Nemotron 3 Super 120B"),
	contextWindow: 262144,
	maxTokens: 65536,
});
nvidiaDirectModels.set("nvidia/nemotron-3-ultra-550b-a55b", {
	...createNvidiaModel("nvidia/nemotron-3-ultra-550b-a55b", "Nemotron 3 Ultra 550B"),
	contextWindow: 262144,
	maxTokens: 65536,
});
nvidiaDirectModels.set("nvidia/nemotron-3-nano-30b-a3b", {
	...createNvidiaModel("nvidia/nemotron-3-nano-30b-a3b", "Nemotron 3 Nano 30B"),
	contextWindow: 262144,
	maxTokens: 65536,
});
nvidiaDirectModels.set("nvidia/llama-3.3-nemotron-super-49b-v1.5", {
	...createNvidiaModel("nvidia/llama-3.3-nemotron-super-49b-v1.5", "Llama 3.3 Nemotron Super 49B"),
	contextWindow: 131072,
	maxTokens: 16384,
});
nvidiaDirectModels.set("meta/llama-3.3-70b-instruct", {
	...createNvidiaModel("meta/llama-3.3-70b-instruct", "Llama 3.3 70B", false),
});
nvidiaDirectModels.set("meta/llama-4-maverick-17b-128e-instruct", {
	...createNvidiaModel("meta/llama-4-maverick-17b-128e-instruct", "Llama 4 Maverick 17B", false),
});
nvidiaDirectModels.set("mistralai/mistral-large-3-675b-instruct-2512", {
	...createNvidiaModel("mistralai/mistral-large-3-675b-instruct-2512", "Mistral Large 3 675B"),
	contextWindow: 262144,
	maxTokens: 65536,
});
nvidiaDirectModels.set("mistralai/mistral-small-4-119b-2603", {
	...createNvidiaModel("mistralai/mistral-small-4-119b-2603", "Mistral Small 4 119B"),
	contextWindow: 262144,
	maxTokens: 65536,
});
nvidiaDirectModels.set("qwen/qwen3.5-122b-a10b", {
	...createNvidiaModel("qwen/qwen3.5-122b-a10b", "Qwen 3.5 122B A10B", false),
});
nvidiaDirectModels.set("qwen/qwen3-next-80b-a3b-instruct", {
	...createNvidiaModel("qwen/qwen3-next-80b-a3b-instruct", "Qwen 3 Next 80B A3B", false),
});
nvidiaDirectModels.set("minimaxai/minimax-m2.7", {
	...createNvidiaModel("minimaxai/minimax-m2.7", "MiniMax M2.7", false),
});
nvidiaDirectModels.set("google/gemma-4-31b-it", {
	...createNvidiaModel("google/gemma-4-31b-it", "Gemma 4 31B", false),
});
nvidiaDirectModels.set("microsoft/phi-4-mini-instruct", {
	...createNvidiaModel("microsoft/phi-4-mini-instruct", "Phi 4 Mini", false),
});

modelRegistry.set("nvidia-direct", nvidiaDirectModels as any);
modelRegistry.set("nvidia", nvidiaDirectModels as any); // Alias for UI provider

// 🚀 AZURE AI FOUNDRY PROVIDER (Azure AI Services / Foundry modelleri)
// Endpoint: https://{resource-name}.cognitiveservices.azure.com/openai/deployments/{deployment}/chat/completions
// API anahtari icin AZURE_AI_FOUNDRY_API_KEY ortam degiskenini kullanin.
const azureAIFoundryModels = new Map<string, Model<any>>();

const createAzureAIFoundryModel = (id: string, name: string, reasoning = true) => ({
	id,
	name,
	api: "openai-completions" as const,
	provider: "azure-ai-foundry" as const,
	baseUrl: `https://mrquakec-3706-resource.cognitiveservices.azure.com/openai/deployments/${id}`,
	reasoning,
	input: ["text"] as Array<"text" | "image">,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 16384,
	compat: {
		supportsDeveloperRole: false,
	} satisfies OpenAICompletionsCompat,
});

azureAIFoundryModels.set(
	"grok-4-20-reasoning",
	createAzureAIFoundryModel("grok-4-20-reasoning", "Grok 4.20 Reasoning"),
);

modelRegistry.set("azure-ai-foundry", azureAIFoundryModels as any);

// 🚀 MIMO FREE PROVIDER (api.xiaomimimo.com - ucretsiz, JWT auth)
const mimoFreeModels = new Map<string, Model<any>>();

const createMiMoFreeModel = (id: string, name: string, reasoning = false) => ({
	id,
	name,
	api: "mimo-free" as const,
	provider: "mimo-free" as const,
	baseUrl: "https://api.xiaomimimo.com/api/free-ai/openai",
	reasoning,
	input: ["text"] as Array<"text" | "image">,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 8192,
});

mimoFreeModels.set("mimo-auto", {
	...createMiMoFreeModel("mimo-auto", "MiMo Auto (Free)"),
	contextWindow: 128000,
	maxTokens: 8192,
});

modelRegistry.set("mimo-free", mimoFreeModels as any);

export function getModel(provider: KnownProvider, modelId: string): Model<Api> {
	const providerModels = modelRegistry.get(provider);
	return providerModels?.get(modelId) as Model<Api>;
}

export function getProviders(): KnownProvider[] {
	return Array.from(modelRegistry.keys()) as KnownProvider[];
}

export function getModels(provider: KnownProvider): Model<Api>[] {
	const models = modelRegistry.get(provider);
	return models ? Array.from(models.values()) : [];
}

export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
	usage.cost.input = (model.cost.input / 1000000) * usage.input;
	usage.cost.output = (model.cost.output / 1000000) * usage.output;
	usage.cost.cacheRead = (model.cost.cacheRead / 1000000) * usage.cacheRead;
	usage.cost.cacheWrite = (model.cost.cacheWrite / 1000000) * usage.cacheWrite;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}

export function supportsXhigh<TApi extends Api>(model: Model<TApi>): boolean {
	// GPT-5* series support xhigh thinking.
	if (model.id.startsWith("gpt-5")) {
		return true;
	}
	// Anthropic adaptive-thinking models that accept the "xhigh" effort tier:
	// Opus 4.6 / 4.7 / 4.8 (verified live). Match both dotted (4.6) and
	// dashed (opus-4-6) id formats, including provider-prefixed Bedrock ids.
	const id = model.id;
	if (
		id.includes("4.6") ||
		id.includes("opus-4-6") ||
		id.includes("4.7") ||
		id.includes("opus-4-7") ||
		id.includes("4.8") ||
		id.includes("opus-4-8")
	) {
		return true;
	}
	return false;
}

/**
 * Check if a model supports the "max" thinking level (the highest adaptive
 * effort tier above "xhigh"). Verified live: Opus 4.6 / 4.7 / 4.8 accept
 * 'low','medium','high','xhigh','max'. GPT-5.6 Sol also accepts a distinct
 * 'max' tier through the Azure/OpenAI Responses API.
 */
export function supportsMax<TApi extends Api>(model: Model<TApi>): boolean {
	const id = model.id.toLowerCase();
	if (id.includes("gpt-5.6-sol") || id.includes("gpt-56-sol")) {
		return true;
	}
	return (
		id.includes("4.6") ||
		id.includes("opus-4-6") ||
		id.includes("4.7") ||
		id.includes("opus-4-7") ||
		id.includes("4.8") ||
		id.includes("opus-4-8")
	);
}

export function modelsAreEqual<TApi extends Api>(
	a: Model<TApi> | null | undefined,
	b: Model<TApi> | null | undefined,
): boolean {
	if (!a || !b) return false;
	return a.id === b.id && a.provider === b.provider;
}
