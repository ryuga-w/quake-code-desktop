import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentTool } from "@mrquake/quakecode-agent-core";
import { ensureFreshGrokAuthToken } from "@mrquake/quakecode-ai";
import { Text } from "@mrquake/quakecode-tui";
import { type Static, Type } from "@sinclair/typebox";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.js";
import { requestGrokImageGeneration } from "./generate-image.js";
import { readStagedVideoSourceImage } from "./video-source-image.js";
import { getTextOutput } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import {
	classifyVideoFailure,
	classifyVideoPollFailure,
	classifyVideoTimeout,
	formatVideoFailureForAgent,
	pickPrimaryVideoFailure,
} from "./video-api-errors.js";

const DEFAULT_VIDEO_MODEL = "grok-imagine-video-1.5";
const VIDEO_ENDPOINTS = [
	"https://api.x.ai/v1/videos/generations",
	"https://api.x.ai/v1/video",
	"https://cli-chat-proxy.grok.com/v1/video",
] as const;

const generateVideoSchema = Type.Object({
	prompt: Type.String({ description: "Detailed English prompt describing the video to generate" }),
	duration: Type.Optional(
		Type.Number({ description: "Video duration in seconds (default: 6)", minimum: 1, maximum: 30 }),
	),
	aspectRatio: Type.Optional(
		Type.String({ description: 'Aspect ratio such as "16:9", "9:16", or "1:1" (default: "16:9")' }),
	),
	model: Type.Optional(Type.String({ description: `Video model (default: ${DEFAULT_VIDEO_MODEL})` })),
	nsfw: Type.Optional(
		Type.Boolean({
			description: "Enable lower moderation for adult/NSFW prompts (18+). xAI may still block some content.",
		}),
	),
	imageUrl: Type.Optional(
		Type.String({
			description:
				"Source image URL or data URI for image-to-video (required for grok-imagine-video-1.5 unless auto keyframe is used).",
		}),
	),
	imagePrompt: Type.Optional(
		Type.String({
			description: "Prompt for the keyframe still image when auto-generating a source frame.",
		}),
	),
	autoKeyframe: Type.Optional(
		Type.Boolean({
			description: "Auto-generate a keyframe image before video when using grok-imagine-video-1.5 (default: true).",
		}),
	),
});

export type GenerateVideoToolInput = Static<typeof generateVideoSchema>;

export interface GenerateVideoToolDetails {
	id: string;
	status: string;
	prompt: string;
	model: string;
	url?: string;
	localPath?: string;
	duration?: number;
	aspectRatio?: string;
	keyframeImageUrl?: string;
	keyframeGenerated?: boolean;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text: string, max = 80): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1)}…`;
}

function resolveVideosDir(cwd: string): string {
	const projectDir = join(cwd, ".quake-code", "videos");
	if (existsSync(join(cwd, ".quake-code"))) return projectDir;
	return join(homedir(), ".quake-code", "videos");
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
	};
}

function nsfwVideoApiExtras(enabled: boolean): Record<string, unknown> {
	if (!enabled) return {};
	return {
		respect_moderation: false,
		moderation: "low",
		safety_tolerance: 2,
	};
}

function pollRespectModeration(st: Record<string, unknown>): boolean | undefined {
	const video = st.video;
	if (video && typeof video === "object" && "respect_moderation" in video) {
		return !!(video as { respect_moderation?: boolean }).respect_moderation;
	}
	return undefined;
}

const NSFW_PROMPT_RE =
	/\b(nsfw|nude|naked|topless|çıplak|çıplaklık|adult|erotic|erotik|sensual|xxx|18\+|yetişkin|yetiskin)\b/i;

function resolveVideoNsfw(prompt: string, explicit?: boolean): boolean {
	if (explicit === true) return true;
	return NSFW_PROMPT_RE.test(prompt);
}

function videoModelRequiresSourceImage(model: string): boolean {
	return model.includes("1.5");
}

function buildKeyframePrompt(videoPrompt: string): string {
	const cleaned = videoPrompt
		.replace(
			/\b(slow motion|tracking shot|drone shot|pan(?:ning)?|zoom|dolly|timelapse|push-?in|pull-?back|camera move(?:ment)?)\b/gi,
			" ",
		)
		.replace(/\s+/g, " ")
		.trim();
	return `Cinematic still frame, photorealistic, highly detailed, sharp focus: ${cleaned || videoPrompt}`;
}

function normalizeVideoImageInput(value?: string): string | undefined {
	if (!value?.trim()) return undefined;
	const v = value.trim();
	if (v.startsWith("data:") || v.startsWith("http://") || v.startsWith("https://")) return v;
	return `data:image/png;base64,${v}`;
}

async function ensureVideoKeyframe(
	opts: GenerateVideoToolInput,
	headers: Record<string, string>,
	signal?: AbortSignal,
): Promise<{ imageUrl: string; imagePrompt: string; generated: boolean } | null> {
	const model = opts.model || DEFAULT_VIDEO_MODEL;
	if (!videoModelRequiresSourceImage(model)) return null;

	const explicit = normalizeVideoImageInput(opts.imageUrl) ?? normalizeVideoImageInput(readStagedVideoSourceImage());
	if (explicit) {
		return {
			imageUrl: explicit,
			imagePrompt: opts.imagePrompt || opts.prompt,
			generated: false,
		};
	}

	if (opts.autoKeyframe === false) {
		throw new Error(
			"VIDEO_GENERATION_FAILED: grok-imagine-video-1.5 is image-to-video only. Provide imageUrl or leave autoKeyframe enabled.",
		);
	}

	const imagePrompt = opts.imagePrompt || buildKeyframePrompt(opts.prompt);
	const images = await requestGrokImageGeneration(
		{ prompt: imagePrompt, aspectRatio: opts.aspectRatio || "16:9", n: 1 },
		headers,
		signal,
	);
	const first = images[0];
	const imageUrl = normalizeVideoImageInput(
		first?.url || (first?.data ? `data:${first.mimeType || "image/png"};base64,${first.data}` : undefined),
	);
	if (!imageUrl) {
		throw new Error("VIDEO_GENERATION_FAILED: Keyframe image generation completed but no image URL was returned.");
	}

	return { imageUrl, imagePrompt, generated: true };
}

function extractVideoUrl(json: Record<string, unknown>): string | undefined {
	const video = json.video;
	if (video && typeof video === "object") {
		const videoRecord = video as Record<string, unknown>;
		if (typeof videoRecord.url === "string") return videoRecord.url;
	}
	const result = json.result;
	if (result && typeof result === "object") {
		const resultRecord = result as Record<string, unknown>;
		if (typeof resultRecord.url === "string") return resultRecord.url;
	}
	for (const key of ["url", "video_url"] as const) {
		if (typeof json[key] === "string") return json[key];
	}
	return undefined;
}

async function requestVideoGeneration(
	opts: GenerateVideoToolInput,
	headers: Record<string, string>,
	signal?: AbortSignal,
	keyframe?: { imageUrl: string; imagePrompt: string; generated: boolean } | null,
): Promise<{ id: string; status: string; url?: string }> {
	const model = opts.model || DEFAULT_VIDEO_MODEL;
	const nsfw = resolveVideoNsfw(opts.prompt, opts.nsfw);
	const body = JSON.stringify({
		prompt: opts.prompt,
		model,
		duration: opts.duration ?? 6,
		aspectRatio: opts.aspectRatio ?? "16:9",
		aspect_ratio: opts.aspectRatio ?? "16:9",
		resolution: model.includes("1.5") ? "720p" : "480p",
		n: 1,
		...(keyframe?.imageUrl ? { image: { url: keyframe.imageUrl } } : {}),
		...nsfwVideoApiExtras(nsfw),
	});

	const failures: ReturnType<typeof classifyVideoFailure>[] = [];

	for (const url of VIDEO_ENDPOINTS) {
		if (signal?.aborted) throw new Error("Video generation aborted");
		try {
			const res = await fetch(url, { method: "POST", headers, body, signal });
			if (!res.ok) {
				const txt = await res.text().catch(() => "");
				failures.push(classifyVideoFailure(res.status, txt, url));
				continue;
			}
			const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
			const directUrl = extractVideoUrl(json);
			const id =
				(typeof json.id === "string" && json.id) ||
				(typeof json.job_id === "string" && json.job_id) ||
				(typeof json.request_id === "string" && json.request_id) ||
				randomUUID();
			if (directUrl) {
				return { id, status: "completed", url: directUrl };
			}
			if (typeof json.request_id === "string" && !directUrl) {
				return { id: json.request_id, status: "processing" };
			}
			return {
				id,
				status:
					typeof json.status === "string"
						? json.status
						: typeof json.state === "string"
							? json.state
							: "processing",
				url: directUrl,
			};
		} catch (error) {
			if (signal?.aborted) throw error;
			const message = error instanceof Error ? error.message : String(error);
			failures.push(classifyVideoFailure(0, message, url));
		}
	}

	const primary = pickPrimaryVideoFailure(failures);
	throw new Error(
		formatVideoFailureForAgent(primary, {
			endpoints_tried: VIDEO_ENDPOINTS.join(", "),
			prompt_excerpt: opts.prompt.slice(0, 120),
		}),
	);
}

async function pollVideoStatus(
	id: string,
	headers: Record<string, string>,
	signal?: AbortSignal,
): Promise<{ url?: string; lastBody?: string }> {
	const pollUrl = `https://api.x.ai/v1/videos/${id}`;
	let lastBody = "";
	for (let attempt = 0; attempt < 60; attempt++) {
		if (signal?.aborted) throw new Error("Video generation aborted");
		await sleep(2500);
		try {
			const res = await fetch(pollUrl, { headers, signal });
			const txt = await res.text().catch(() => "");
			lastBody = txt;
			if (!res.ok) {
				const report = classifyVideoFailure(res.status, txt, pollUrl);
				throw new Error(formatVideoFailureForAgent(report, { job_id: id }));
			}
			const json = (txt ? (JSON.parse(txt) as Record<string, unknown>) : {}) as Record<string, unknown>;
			const moderated = pollRespectModeration(json);
			if (moderated === false) {
				throw new Error(
					"VIDEO_GENERATION_FAILED: Video blocked by moderation filter (respect_moderation: false). NSFW mode may not bypass all xAI restrictions.",
				);
			}
			const url = extractVideoUrl(json);
			if (url) return { url, lastBody: txt };
			const status =
				typeof json.status === "string" ? json.status : typeof json.state === "string" ? json.state : "";
			if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled") {
				const report = classifyVideoPollFailure(json, id);
				throw new Error(formatVideoFailureForAgent(report, { job_id: id, poll_status: status }));
			}
		} catch (error) {
			if (signal?.aborted) throw error;
			if (error instanceof Error && error.message.includes("VIDEO_GENERATION_FAILED")) throw error;
		}
	}
	return { lastBody };
}

async function downloadVideo(
	id: string,
	url: string,
	prompt: string,
	model: string,
	cwd: string,
	headers: Record<string, string>,
): Promise<string> {
	const videosDir = resolveVideosDir(cwd);
	mkdirSync(videosDir, { recursive: true });
	const filePath = join(videosDir, `${id}.mp4`);

	let videoRes = await fetch(url);
	if (!videoRes.ok) {
		videoRes = await fetch(url, { headers: { Authorization: headers.Authorization } });
	}
	if (!videoRes.ok) {
		throw new Error(`Failed to download generated video (HTTP ${videoRes.status})`);
	}

	if (videoRes.body) {
		const fileStream = createWriteStream(filePath);
		const reader = videoRes.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) fileStream.write(Buffer.from(value));
		}
		await new Promise<void>((resolve, reject) => {
			fileStream.end((error?: Error | null) => (error ? reject(error) : resolve()));
		});
	} else {
		const buffer = Buffer.from(await videoRes.arrayBuffer());
		writeFileSync(filePath, buffer);
	}

	writeFileSync(
		join(videosDir, `${id}.json`),
		JSON.stringify(
			{
				id,
				prompt,
				model,
				url,
				localPath: filePath,
				created: new Date().toISOString(),
			},
			null,
			2,
		),
	);

	return filePath;
}

function renderPendingCall(prompt: string, theme: typeof import("../../modes/interactive/theme/theme.js").theme): Text {
	return new Text(`${theme.bold("Generating video")} ${theme.fg("dim", truncate(prompt, 60))}`, 0, 0);
}

function renderToolResult(
	result: { content: Array<{ type: string; text?: string }>; details?: GenerateVideoToolDetails },
	options: ToolRenderResultOptions,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
): Text {
	let text = `${theme.bold("Generated video")}`;
	const detail = result.details?.prompt;
	if (detail) text += ` ${theme.fg("dim", truncate(detail, 60))}`;
	if (options.expanded) {
		const output = getTextOutput(result as any, false);
		if (output) text += `\n${theme.fg("dim", output)}`;
	}
	return new Text(text, 0, 0);
}

export function createGenerateVideoToolDefinition(
	cwd: string,
): ToolDefinition<typeof generateVideoSchema, GenerateVideoToolDetails> {
	return {
		name: "generate_video",
		label: "generate_video",
		description:
			"Generate a short video using Grok Imagine Video. grok-imagine-video-1.5 is image-to-video: the tool auto-generates a keyframe image first unless imageUrl is provided. Requires Grok auth (~/.grok/auth.json).",
		promptSnippet: "Generate a video from a detailed English prompt",
		promptGuidelines: [
			"Use generate_video when the user asks to create, generate, or produce a video clip.",
			"grok-imagine-video-1.5 (default) needs a source image: the tool auto-creates a keyframe still, uses the user's attached chat image when present, or pass imageUrl from generate_image.",
			"When the user attached an image and asks for video, call generate_video with a motion-focused prompt — imageUrl is filled automatically from the attachment.",
			"Optional workflow: generate_image for the scene, then generate_video with imageUrl set to that image URL and a motion-focused prompt.",
			"Write video prompts in clear English with motion, lighting, and camera movement.",
			"Do not claim video generation is unavailable when generate_video is listed in Available tools.",
			"After a successful generate_video call, share the returned local path or URL with the user.",
			"If the tool returns VIDEO_GENERATION_FAILED, read Category (content_moderation vs quota_exceeded etc.) and explain the exact reason to the user in their language — never say you don't know why it failed.",
			"content_moderation means the prompt was blocked by safety filters (e.g. nudity/suggestive content), not a bug.",
			"quota_exceeded means rate limits or video quota — suggest waiting or checking account limits.",
		],
		parameters: generateVideoSchema,
		renderCall(args, theme) {
			return renderPendingCall(args.prompt, theme);
		},
		renderResult(result, options, theme) {
			return renderToolResult(result, options, theme);
		},
		async execute(_toolCallId, params, signal) {
			const model = params.model || DEFAULT_VIDEO_MODEL;
			const headers = await getAuthHeaders();
			const keyframe = await ensureVideoKeyframe(params, headers, signal);
			const started = await requestVideoGeneration(params, headers, signal, keyframe);

			let finalUrl = started.url;
			let status = started.status;
			if (!finalUrl && (status === "processing" || !status)) {
				const polled = await pollVideoStatus(started.id, headers, signal);
				finalUrl = polled.url;
				if (finalUrl) status = "completed";
				if (!finalUrl) {
					const report = classifyVideoTimeout(started.id, polled.lastBody);
					throw new Error(
						formatVideoFailureForAgent(report, {
							job_id: started.id,
							prompt_excerpt: params.prompt.slice(0, 120),
						}),
					);
				}
			}

			const details: GenerateVideoToolDetails = {
				id: started.id,
				status,
				prompt: params.prompt,
				model,
				duration: params.duration ?? 6,
				aspectRatio: params.aspectRatio ?? "16:9",
				url: finalUrl,
				...(keyframe ? { keyframeImageUrl: keyframe.imageUrl, keyframeGenerated: keyframe.generated } : {}),
			};

			if (!finalUrl) {
				const report = classifyVideoTimeout(started.id);
				throw new Error(
					formatVideoFailureForAgent(report, {
						job_id: started.id,
						status,
						prompt_excerpt: params.prompt.slice(0, 120),
					}),
				);
			}

			try {
				const localPath = await downloadVideo(started.id, finalUrl, params.prompt, model, cwd, headers);
				details.localPath = localPath;
				return {
					content: [
						{
							type: "text",
							text: [
								"Video generated successfully.",
								`Job ID: ${started.id}`,
								`Local file: ${localPath}`,
								`Source URL: ${finalUrl}`,
							].join("\n"),
						},
					],
					details,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: "text",
							text: [
								"Video was generated but could not be saved locally.",
								`Job ID: ${started.id}`,
								`URL: ${finalUrl}`,
								`Save error: ${message}`,
							].join("\n"),
						},
					],
					details,
				};
			}
		},
	};
}

export const generateVideoToolDefinition = createGenerateVideoToolDefinition(process.cwd());
export const generateVideoTool: AgentTool<any> = wrapToolDefinition(generateVideoToolDefinition);
