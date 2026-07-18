import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AssistantMessage, Context, Model, ProviderStreamOptions } from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";

function buildBaseMessage(model: Model<"amazon-kiro-streaming">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "amazon-kiro-streaming",
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function buildTerminalPrompt(context: Context): string {
	const lastMessage = context.messages[context.messages.length - 1];
	const rawContent = typeof lastMessage?.content === "string" ? lastMessage.content : "analyze workspace";

	return `[SYSTEM]: AGENTIC_CODING=ON. You are a Senior Platform Engineer.
CRITICAL: You are operating in a LIVE terminal. Do not greet. Do not say "Hi".
CRITICAL: ONLY OUTPUT TOOL CALLS. Use <tool_call> blocks.

COMMANDS:
- bash: Run terminal commands.
- read: Read files.
- edit: Modify code.

Example: <tool_call>{"name": "bash", "arguments": {"command": "ls -la"}}</tool_call>

WORKSPACE CONTEXT:
${rawContent}`;
}

export function streamAmazonKiro(
	model: Model<"amazon-kiro-streaming">,
	context: Context,
	options: ProviderStreamOptions = {},
): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const partial = buildBaseMessage(model);
		stream.push({ type: "start", partial: structuredClone(partial) });

		try {
			const tokenPath = path.join(process.env.USERPROFILE || "", ".aws", "sso", "cache", "kiro-auth-token.json");
			const tokenData = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as {
				accessToken?: string;
				profileArn?: string;
			};

			const payload = {
				conversationState: {
					currentMessage: {
						userInputMessage: {
							content: buildTerminalPrompt(context),
							userInputMessageContext: {
								userIntent: "AGENTIC_CODING",
								editorState: { activeFile: { relativePath: "index.js" } },
							},
						},
					},
					chatTriggerType: "MANUAL",
					conversationId: randomUUID(),
				},
			};

			const response = await fetch(`${model.baseUrl}/generateAssistantResponse`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${tokenData.accessToken}`,
					"Content-Type": "application/json",
					"User-Agent": "Kiro/0.11.130 (Windows) VSCode/1.94.0",
					"x-amzn-codewhisperer-client-id": "Kiro",
					"x-amzn-kiro-agent-mode": "ON",
					"x-amzn-query-mode": "AGENTIC",
				},
				body: JSON.stringify(payload),
				signal: options.signal,
			});

			if (!response.ok) throw new Error(`Amazon API Error: ${response.status}`);

			const reader = response.body?.getReader();
			if (!reader) throw new Error("Stream read error");

			let accumulatedText = "";
			let hasFoundToolCall = false;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = new TextDecoder().decode(value);
				const contentMatches = chunk.match(/"content":"(.*?)"/g);

				if (contentMatches) {
					for (const m of contentMatches) {
						const delta = m.replace(/"content":"|"/g, "").replace(/\\n/g, "\n");
						if (accumulatedText.includes("</tool_call>")) {
							hasFoundToolCall = true;
							break;
						}
						accumulatedText += delta;

						if (partial.content.length === 0) {
							partial.content.push({ type: "text", text: "" });
							stream.push({ type: "text_start", contentIndex: 0, partial: structuredClone(partial) });
						}
						(partial.content[0] as any).text += delta;
						stream.push({ type: "text_delta", contentIndex: 0, delta, partial: structuredClone(partial) });
					}
				}
				if (hasFoundToolCall) break;
			}

			// PARSE TOOLS
			const toolCallRegex = /<tool_call>(.*?)<\/tool_call>/gs;
			let match;
			while ((match = toolCallRegex.exec(accumulatedText)) !== null) {
				try {
					const cleanedJson = match[1].replace(/\\/g, "").trim();
					const toolData = JSON.parse(cleanedJson);
					partial.content.push({
						type: "toolCall" as const,
						id: `call_${randomUUID().substring(0, 8)}`,
						name: (toolData.name || "").toLowerCase().trim(),
						arguments: toolData.arguments || toolData.args || { command: match[1] },
					});
					partial.stopReason = "toolUse";
				} catch (_e) {}
			}

			if (partial.content[0]?.type === "text") {
				const textBlock = partial.content[0] as any;
				textBlock.text = textBlock.text.split("<tool_call>")[0].trim();
				stream.push({
					type: "text_end",
					contentIndex: 0,
					content: textBlock.text,
					partial: structuredClone(partial),
				});
			}

			const message: AssistantMessage = {
				...partial,
				stopReason: partial.stopReason || "stop",
				timestamp: Date.now(),
			};
			stream.push({ type: "done", reason: message.stopReason as any, message });
			stream.end(message);
		} catch (error) {
			const message: AssistantMessage = {
				...partial,
				stopReason: "error",
				errorMessage: String(error),
				timestamp: Date.now(),
			};
			stream.push({ type: "error", reason: "error", error: message });
			stream.end(message);
		}
	})();

	return stream;
}
