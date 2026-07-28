import crypto from "crypto";
import { calculateCost } from "../models.js";
import type {
	AssistantMessage,
	Context,
	Model,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { buildBaseOptions } from "./simple-options.js";

export interface MiMoFreeOptions extends StreamOptions {}

// JWT cache
let cachedJwt: string | null = null;
let jwtExpiry = 0;

async function getJwt(): Promise<string> {
	if (cachedJwt && Date.now() < jwtExpiry) {
		return cachedJwt;
	}

	const os = await import("os");
	const hostname = os.hostname();
	const platform = os.platform();
	const arch = os.arch();
	const cpu = os.cpus()[0]?.model || "unknown";
	const user = os.userInfo().username;

	const clientStr = `${hostname}|${platform}|${arch}|${cpu}|${user}`;
	const clientHash = crypto.createHash("sha256").update(clientStr).digest("hex");

	const res = await fetch("https://api.xiaomimimo.com/api/free-ai/bootstrap", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ client: clientHash }),
	});

	if (!res.ok) {
		throw new Error(`MiMo bootstrap failed: ${res.status} ${res.statusText}`);
	}

	const data = (await res.json()) as { jwt: string };
	cachedJwt = data.jwt;
	jwtExpiry = Date.now() + 55 * 60 * 1000;
	return cachedJwt;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildMessagesPayload(context: Context): any[] {
	const messages: any[] = [];

	// MiMo SADECE bu system prompt ile calisir
	messages.push({
		role: "system",
		content: "You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks.",
	});

	for (const msg of context.messages) {
		if (msg.role === "user") {
			const textContent =
				typeof msg.content === "string"
					? msg.content
					: msg.content
							.filter((c): c is TextContent => c.type === "text")
							.map((c) => c.text)
							.join("\n");
			messages.push({ role: "user", content: sanitizeSurrogates(textContent) });
		} else if (msg.role === "assistant") {
			const text =
				typeof msg.content === "string"
					? msg.content
					: msg.content
							.filter((c): c is TextContent => c.type === "text")
							.map((c) => c.text)
							.join("\n");
			const toolCalls =
				typeof msg.content === "string" ? [] : (msg.content.filter((c) => c.type === "toolCall") as ToolCall[]);
			const assistantMsg: any = {
				role: "assistant",
				content: sanitizeSurrogates(text) || undefined,
			};
			if (toolCalls.length > 0) {
				assistantMsg.tool_calls = toolCalls.map((tc) => ({
					id: tc.id,
					type: "function",
					function: {
						name: tc.name,
						arguments: JSON.stringify(tc.arguments),
					},
				}));
			}
			messages.push(assistantMsg);
		} else if (msg.role === "toolResult") {
			const toolMsg = msg as ToolResultMessage;
			const textResult =
				typeof toolMsg.content === "string"
					? toolMsg.content
					: toolMsg.content
							.filter((c) => c.type === "text")
							.map((c) => (c as any).text)
							.join("\n");
			messages.push({
				role: "tool",
				content: sanitizeSurrogates(textResult || "(no result)"),
				tool_call_id: toolMsg.toolCallId,
			});
		}
	}

	return messages;
}

function mapStopReason(reason: string): { stopReason: StopReason; errorMessage?: string } {
	switch (reason) {
		case "stop":
		case "end":
			return { stopReason: "stop" };
		case "length":
			return { stopReason: "length" };
		case "function_call":
		case "tool_calls":
			return { stopReason: "toolUse" };
		case "content_filter":
			return { stopReason: "error", errorMessage: "Provider finish_reason: content_filter" };
		default:
			return { stopReason: "error", errorMessage: `Provider finish_reason: ${reason}` };
	}
}

export const streamMiMoFree: StreamFunction<"mimo-free", MiMoFreeOptions> = (
	model: Model<"mimo-free">,
	context: Context,
	options?: MiMoFreeOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
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

		try {
			const jwt = await getJwt();
			const sessionId = "ses_" + crypto.randomBytes(12).toString("hex");
			const messages = buildMessagesPayload(context);

			const payload: any = {
				model: model.id,
				messages,
				max_tokens: options?.maxTokens || 4096,
				stream: true,
			};

			if (options?.temperature !== undefined) {
				payload.temperature = options.temperature;
			}

			const tools = context.tools?.length
				? context.tools.map((t) => ({
						type: "function",
						function: {
							name: t.name,
							description: t.description,
							parameters: t.parameters,
						},
					}))
				: undefined;
			if (tools && tools.length > 0) {
				payload.tools = tools;
			}

			const response = await fetch("https://api.xiaomimimo.com/api/free-ai/openai/chat", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${jwt}`,
					"X-Mimo-Source": "mimocode-cli-free",
					"x-session-affinity": sessionId,
					Accept: "text/event-stream",
				},
				body: JSON.stringify(payload),
				signal: options?.signal,
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`MiMo API error ${response.status}: ${errorText}`);
			}

			stream.push({ type: "start", partial: output });

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error("No response body");
			}

			const decoder = new TextDecoder();
			let currentBlock: TextContent | null = null;
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;

			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					const data = line.slice(6).trim();
					if (data === "[DONE]") break;

					try {
						const chunk = JSON.parse(data);
						const choice = chunk.choices?.[0];
						if (!choice) continue;

						if (choice.finish_reason) {
							const result = mapStopReason(choice.finish_reason);
							output.stopReason = result.stopReason;
							if (result.errorMessage) {
								output.errorMessage = result.errorMessage;
							}
						}

						if (choice.delta?.content) {
							if (!currentBlock || currentBlock.type !== "text") {
								if (currentBlock) {
									stream.push({
										type: "text_end",
										contentIndex: blockIndex(),
										content: currentBlock.text,
										partial: output,
									});
								}
								currentBlock = { type: "text", text: "" };
								output.content.push(currentBlock);
								stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
							}
							currentBlock.text += choice.delta.content;
							stream.push({
								type: "text_delta",
								contentIndex: blockIndex(),
								delta: choice.delta.content,
								partial: output,
							});
						}

						if (chunk.usage) {
							const u = chunk.usage;
							output.usage = {
								input: u.prompt_tokens || 0,
								output: u.completion_tokens || 0,
								cacheRead: 0,
								cacheWrite: 0,
								totalTokens: u.total_tokens || 0,
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
							};
							calculateCost(model, output.usage);
						}
					} catch {
						// parse error, skip
					}
				}
			}

			// Finish last block
			if (currentBlock) {
				stream.push({
					type: "text_end",
					contentIndex: blockIndex(),
					content: currentBlock.text,
					partial: output,
				});
			}

			const finalReason = output.stopReason;
			if (finalReason === "stop" || finalReason === "length" || finalReason === "toolUse") {
				stream.push({ type: "done", reason: finalReason, message: output });
			} else {
				stream.push({ type: "error", reason: "error", error: output });
			}
			stream.end();
		} catch (error) {
			output.stopReason = "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: "error", error: output });
			stream.end();
		}
	})();

	return stream;
};

export const streamSimpleMiMoFree: StreamFunction<"mimo-free", SimpleStreamOptions> = (
	model: Model<"mimo-free">,
	context: Context,
	options?: SimpleStreamOptions,
) => {
	return streamMiMoFree(model, context, buildBaseOptions(model, options));
};
