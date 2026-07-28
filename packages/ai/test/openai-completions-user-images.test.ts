import { describe, expect, it } from "vitest";
import { convertMessages } from "../src/providers/openai-completions.js";
import type { Context, Model, OpenAICompletionsCompat } from "../src/types.js";

const compat: Required<OpenAICompletionsCompat> = {
  supportsStore: true,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  reasoningEffortMap: {},
  supportsUsageInStreaming: true,
  maxTokensField: "max_completion_tokens",
  requiresToolResultName: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false,
  thinkingFormat: "openai",
  openRouterRouting: {},
  vercelGatewayRouting: {},
  zaiToolStream: false,
  supportsStrictMode: true,
};

const context: Context = {
  systemPrompt: "Inspect attached images.",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Bu görseli incele." },
        { type: "image", mimeType: "image/png", data: "ZmFrZQ==" },
      ],
      timestamp: 1,
    },
  ],
};

function createModel(
  input: Array<"text" | "image">,
): Model<"openai-completions"> {
  return {
    id: "gpt-56-sol-deploy",
    name: "Azure GPT-5.6-Sol",
    api: "openai-completions",
    provider: "azure-mrquake-gpt56sol",
    baseUrl:
      "https://example.openai.azure.com/openai/deployments/gpt-56-sol-deploy",
    reasoning: true,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 16384,
    compat,
  };
}

describe("openai-completions user image conversion", () => {
  it("keeps attached images for image-capable Azure deployments", () => {
    const messages = convertMessages(
      createModel(["text", "image"]),
      context,
      compat,
    );
    const user = messages.find((message) => message.role === "user");
    expect(Array.isArray(user?.content)).toBe(true);
    expect(user?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image_url",
          image_url: { url: "data:image/png;base64,ZmFrZQ==" },
        }),
      ]),
    );
  });

  it("filters attached images only for explicitly text-only models", () => {
    const messages = convertMessages(createModel(["text"]), context, compat);
    const user = messages.find((message) => message.role === "user");
    expect(user?.content).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "image_url" })]),
    );
  });
});
