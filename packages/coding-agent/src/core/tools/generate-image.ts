import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentTool } from "@mrquake/quakecode-agent-core";
import { ensureFreshGrokAuthToken } from "@mrquake/quakecode-ai";
import { Text } from "@mrquake/quakecode-tui";
import { type Static, Type } from "@sinclair/typebox";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.js";
import { getTextOutput } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";

const DEFAULT_IMAGE_MODEL = "grok-imagine-image";
const IMAGE_ENDPOINTS = [
	"https://cli-chat-proxy.grok.com/v1/images",
	"https://cli-chat-proxy.grok.com/v1/chat/completions",
	"https://api.x.ai/v1/images/generations",
	"https://api.x.ai/v1/images",
] as const;

const generateImageSchema = Type.Object({
	prompt: Type.String({ description: "Detailed English prompt describing the image to generate" }),
	aspectRatio: Type.Optional(
		Type.String({ description: 'Aspect ratio such as "1:1", "16:9", or "9:16" (default: "1:1")' }),
	),
	quality: Type.Optional(
		Type.Union([Type.Literal("standard"), Type.Literal("quality"), Type.Literal("pro")], {
			description: "Image quality tier (default: standard)",
		}),
	),
	model: Type.Optional(Type.String({ description: `Image model (default: ${DEFAULT_IMAGE_MODEL})` })),
	n: Type.Optional(Type.Number({ description: "Number of images (default: 1)", minimum: 1, maximum: 4 })),
});

export type GenerateImageToolInput = Static<typeof generateImageSchema>;

export interface GeneratedImageItem {
	id: string;
	url?: string;
	data?: string;
	mimeType?: string;
	localPath?: string;
	prompt: string;
	model: string;
}

export interface GenerateImageToolDetails {
	prompt: string;
	model: string;
	aspectRatio?: string;
	quality?: string;
	images: GeneratedImageItem[];
}

function truncate(text: string, max = 80): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1)}…`;
}

function resolveImagesDir(cwd: string): string {
	const projectDir = join(cwd, ".quake-code", "images");
	if (existsSync(join(cwd, ".quake-code"))) return projectDir;
	return join(homedir(), ".quake-code", "images");
}

async function getAuthHeaders(): Promise<Record<string, string>> {
	const token = await ensureFreshGrokAuthToken();
	if (!token) {
		throw new Error(
			"No Grok auth token found. Ensure ~/.grok/auth.json exists with a valid OIDC entry or set XAI_API_KEY.",
		);
	}
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
		"X-Grok-Client": "quake-code",
		"X-Grok-Model-Override": "grok-imagine",
	};
}

function parseImagesFromJson(json: Record<string, unknown>, prompt: string, model: string): GeneratedImageItem[] {
	const images: GeneratedImageItem[] = [];

	const data = json.data;
	if (Array.isArray(data)) {
		for (const [idx, item] of data.entries()) {
			if (!item || typeof item !== "object") continue;
			const rec = item as Record<string, unknown>;
			const b64 = typeof rec.b64_json === "string" ? rec.b64_json : undefined;
			images.push({
				id: typeof rec.id === "string" ? rec.id : `${Date.now()}-${idx}`,
				url: typeof rec.url === "string" ? rec.url : b64 ? `data:image/png;base64,${b64}` : undefined,
				data: b64,
				mimeType: "image/png",
				prompt,
				model,
			});
		}
	}

	const jsonImages = json.images;
	if (Array.isArray(jsonImages)) {
		for (const [idx, item] of jsonImages.entries()) {
			if (!item || typeof item !== "object") continue;
			const rec = item as Record<string, unknown>;
			images.push({
				id: typeof rec.id === "string" ? rec.id : `${Date.now()}-${idx}`,
				url:
					(typeof rec.url === "string" && rec.url) ||
					(typeof rec.image_url === "string" && rec.image_url) ||
					undefined,
				data: typeof rec.base64 === "string" ? rec.base64 : typeof rec.data === "string" ? rec.data : undefined,
				mimeType: typeof rec.mime === "string" ? rec.mime : "image/png",
				prompt,
				model,
			});
		}
	}

	if (typeof json.url === "string" || typeof json.image_url === "string") {
		images.push({
			id: `${Date.now()}`,
			url: (json.url as string) || (json.image_url as string),
			prompt,
			model,
		});
	}

	const choices = json.choices;
	if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
		const message = (choices[0] as Record<string, unknown>).message;
		if (message && typeof message === "object") {
			const msg = message as Record<string, unknown>;
			const msgImages = msg.images;
			if (Array.isArray(msgImages)) {
				for (const [idx, item] of msgImages.entries()) {
					if (!item || typeof item !== "object") continue;
					const rec = item as Record<string, unknown>;
					const b64 = typeof rec.b64_json === "string" ? rec.b64_json : undefined;
					images.push({
						id: `${Date.now()}-${idx}`,
						url: typeof rec.url === "string" ? rec.url : b64 ? `data:image/png;base64,${b64}` : undefined,
						data: b64,
						prompt,
						model,
					});
				}
			}
			if (images.length === 0 && typeof msg.content === "string") {
				const urlMatch = msg.content.match(/https?:\/\/[^\s)]+\.(png|jpg|jpeg|webp|gif)/i);
				if (urlMatch) {
					images.push({ id: `${Date.now()}`, url: urlMatch[0], prompt, model });
				}
			}
		}
	}

	return images;
}

export async function requestGrokImageGeneration(
	opts: GenerateImageToolInput,
	headers: Record<string, string>,
	signal?: AbortSignal,
): Promise<GeneratedImageItem[]> {
	const model = opts.model || DEFAULT_IMAGE_MODEL;
	const n = opts.n ?? 1;

	for (const url of IMAGE_ENDPOINTS) {
		if (signal?.aborted) throw new Error("Image generation aborted");
		if (url.includes("api.x.ai") && url.includes("/chat/completions")) continue;

		const isPublicImages = url.includes("api.x.ai") && url.includes("/images");
		let requestBody: Record<string, unknown>;

		if (url.includes("/chat/completions")) {
			requestBody = {
				model,
				messages: [{ role: "user", content: opts.prompt }],
				size: opts.aspectRatio,
				quality: opts.quality,
				n,
			};
		} else if (isPublicImages && model.includes("imagine")) {
			const q = opts.quality === "pro" || opts.quality === "quality" ? "high" : "medium";
			requestBody = { prompt: opts.prompt, n, quality: q, response_format: "url" };
		} else {
			requestBody = {
				prompt: opts.prompt,
				model,
				n,
				size: opts.aspectRatio || "1:1",
				quality: opts.quality || "standard",
				response_format: "url",
			};
		}

		try {
			const res = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(requestBody),
				signal,
			});
			if (!res.ok) continue;
			const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
			const images = parseImagesFromJson(json, opts.prompt, model);
			if (images.length > 0) return images;
		} catch {
			// try next endpoint
		}
	}

	throw new Error(
		"Grok image generation failed on all endpoints. Check ~/.grok/auth.json and image generation access.",
	);
}

async function saveImageLocally(
	item: GeneratedImageItem,
	cwd: string,
	headers: Record<string, string>,
): Promise<string> {
	const imagesDir = resolveImagesDir(cwd);
	mkdirSync(imagesDir, { recursive: true });
	const filePath = join(imagesDir, `${item.id}.png`);

	if (item.data) {
		writeFileSync(filePath, Buffer.from(item.data, "base64"));
		return filePath;
	}

	if (!item.url) throw new Error("No image URL or data to save");

	let imageRes = await fetch(item.url);
	if (!imageRes.ok && headers.Authorization) {
		imageRes = await fetch(item.url, { headers: { Authorization: headers.Authorization } });
	}
	if (!imageRes.ok) throw new Error(`Failed to download image (HTTP ${imageRes.status})`);

	if (imageRes.body) {
		const fileStream = createWriteStream(filePath);
		const reader = imageRes.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) fileStream.write(Buffer.from(value));
		}
		await new Promise<void>((resolve, reject) => {
			fileStream.end((error?: Error | null) => (error ? reject(error) : resolve()));
		});
	} else {
		writeFileSync(filePath, Buffer.from(await imageRes.arrayBuffer()));
	}

	return filePath;
}

function renderPendingCall(prompt: string, theme: typeof import("../../modes/interactive/theme/theme.js").theme): Text {
	return new Text(`${theme.bold("Generating image")} ${theme.fg("dim", truncate(prompt, 60))}`, 0, 0);
}

function renderToolResult(
	result: { content: Array<{ type: string; text?: string }>; details?: GenerateImageToolDetails },
	options: ToolRenderResultOptions,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
): Text {
	let text = `${theme.bold("Generated image")}`;
	const detail = result.details?.prompt;
	if (detail) text += ` ${theme.fg("dim", truncate(detail, 60))}`;
	if (options.expanded) {
		const output = getTextOutput(result as any, false);
		if (output) text += `\n${theme.fg("dim", output)}`;
	}
	return new Text(text, 0, 0);
}

export function createGenerateImageToolDefinition(
	cwd: string,
): ToolDefinition<typeof generateImageSchema, GenerateImageToolDetails> {
	return {
		name: "generate_image",
		label: "generate_image",
		description:
			"Generate an image from a text prompt using Grok Imagine. Requires Grok auth (~/.grok/auth.json). Returns image URLs and saves files under .quake-code/images when possible.",
		promptSnippet: "Generate an image from a detailed English prompt",
		promptGuidelines: [
			"Use generate_image when the user asks to create, generate, draw, or produce an image or picture.",
			"Write prompts in clear English with subject, style, lighting, and composition details.",
			"Do not claim image generation is unavailable when generate_image is listed in Available tools.",
			"After a successful generate_image call, describe the result and share the returned image URL or path.",
			"When generating video with grok-imagine-video-1.5, you can pass a generate_image URL as imageUrl to generate_video for better control.",
		],
		parameters: generateImageSchema,
		renderCall(args, theme) {
			return renderPendingCall(args.prompt, theme);
		},
		renderResult(result, options, theme) {
			return renderToolResult(result, options, theme);
		},
		async execute(_toolCallId, params, signal) {
			const model = params.model || DEFAULT_IMAGE_MODEL;
			const headers = await getAuthHeaders();
			const generated = await requestGrokImageGeneration(params, headers, signal);

			const savedImages: GeneratedImageItem[] = [];
			for (const item of generated) {
				const id = item.id || randomUUID();
				const entry: GeneratedImageItem = { ...item, id, prompt: params.prompt, model };
				if (entry.url || entry.data) {
					try {
						entry.localPath = await saveImageLocally(entry, cwd, headers);
					} catch {
						// keep remote/data url only
					}
				}
				savedImages.push(entry);
			}

			const details: GenerateImageToolDetails = {
				prompt: params.prompt,
				model,
				aspectRatio: params.aspectRatio,
				quality: params.quality,
				images: savedImages,
			};

			const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
				{
					type: "text",
					text: [
						`Generated ${savedImages.length} image(s).`,
						...savedImages.map((img, i) => {
							const src = img.url || (img.data ? `data:image/png;base64,${img.data.slice(0, 24)}…` : "no url");
							return `${i + 1}. ${src}${img.localPath ? ` (saved: ${img.localPath})` : ""}`;
						}),
					].join("\n"),
				},
			];

			const firstWithData = savedImages.find((img) => img.data);
			if (firstWithData?.data) {
				content.push({
					type: "image",
					data: firstWithData.data,
					mimeType: firstWithData.mimeType || "image/png",
				});
			}

			return { content, details };
		},
	};
}

export const generateImageToolDefinition = createGenerateImageToolDefinition(process.cwd());
export const generateImageTool: AgentTool<any> = wrapToolDefinition(generateImageToolDefinition);
