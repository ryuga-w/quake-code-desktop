import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ExtensionAPI, getAgentDir, withFileMutationQueue } from "@mrquake/quakecode-cli";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";

const PROVIDER = "cloudflare";

const MODELS = [
	"@cf/black-forest-labs/flux-2-klein-9b",
	"@cf/black-forest-labs/flux-1-schnell",
	"@cf/black-forest-labs/flux-2-dev",
	"@cf/stabilityai/stable-diffusion-xl-base-1.0",
	"@cf/bytedance/stable-diffusion-xl-lightning",
	"@cf/lykon/dreamshaper-8-lcm",
] as const;

const DEFAULT_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";
const DEFAULT_SAVE_MODE = "none";

const SAVE_MODES = ["none", "project", "global", "custom"] as const;
type SaveMode = (typeof SAVE_MODES)[number];

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

const SAVE_MODE_TYPE = Type.Union([
	Type.Literal("none"),
	Type.Literal("project"),
	Type.Literal("global"),
	Type.Literal("custom"),
]);

const TOOL_PARAMS = Type.Object({
	prompt: Type.String({ description: "Image description." }),
	model: Type.Optional(
		Type.String({
			description: "Cloudflare Workers AI image model. Default: @cf/black-forest-labs/flux-2-klein-9b.",
		}),
	),
	width: Type.Optional(
		Type.Number({
			description: "Image width in pixels (for supported models). Default: model-specific.",
		}),
	),
	height: Type.Optional(
		Type.Number({
			description: "Image height in pixels (for supported models). Default: model-specific.",
		}),
	),
	numSteps: Type.Optional(
		Type.Number({
			description: "Number of inference steps (for supported models). Default: model-specific.",
		}),
	),
	save: Type.Optional(SAVE_MODE_TYPE),
	saveDir: Type.Optional(
		Type.String({
			description: "Directory to save image when save=custom. Defaults to PI_IMAGE_SAVE_DIR if set.",
		}),
	),
});

type ToolParams = Static<typeof TOOL_PARAMS>;

interface ParsedCredentials {
	apiToken: string;
	accountId: string;
}

interface ExtensionConfig {
	save?: SaveMode;
	saveDir?: string;
}

interface SaveConfig {
	mode: SaveMode;
	outputDir?: string;
}

function parseCredentials(raw: string): ParsedCredentials {
	let parsed: { apiToken?: string; accountId?: string };
	try {
		parsed = JSON.parse(raw) as { apiToken?: string; accountId?: string };
	} catch {
		throw new Error(
			"Invalid Cloudflare credentials. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID env vars or configure in auth.json.",
		);
	}
	if (!parsed.apiToken || !parsed.accountId) {
		throw new Error("Missing apiToken or accountId in Cloudflare credentials.");
	}
	return { apiToken: parsed.apiToken, accountId: parsed.accountId };
}

function readConfigFile(path: string): ExtensionConfig {
	if (!existsSync(path)) {
		return {};
	}
	try {
		const content = readFileSync(path, "utf-8");
		const parsed = JSON.parse(content) as ExtensionConfig;
		return parsed ?? {};
	} catch {
		return {};
	}
}

function loadConfig(cwd: string): ExtensionConfig {
	const globalPath = join(getAgentDir(), "extensions", "cloudflare-image-gen.json");
	const globalConfig = readConfigFile(globalPath);
	const projectConfig = readConfigFile(join(cwd, ".quake-code", "extensions", "cloudflare-image-gen.json"));
	return { ...globalConfig, ...projectConfig };
}

function resolveSaveConfig(params: ToolParams, cwd: string): SaveConfig {
	const config = loadConfig(cwd);
	const envMode = (process.env.PI_IMAGE_SAVE_MODE || "").toLowerCase();
	const paramMode = params.save;
	const mode = (paramMode || envMode || config.save || DEFAULT_SAVE_MODE) as SaveMode;

	if (!SAVE_MODES.includes(mode)) {
		return { mode: DEFAULT_SAVE_MODE as SaveMode };
	}

	if (mode === "project") {
		return { mode, outputDir: join(cwd, ".quake-code", "generated-images") };
	}

	if (mode === "global") {
		const outputDir = join(getAgentDir(), "generated-images");
		return { mode, outputDir };
	}

	if (mode === "custom") {
		const dir = params.saveDir || process.env.PI_IMAGE_SAVE_DIR || config.saveDir;
		if (!dir || !dir.trim()) {
			throw new Error("save=custom requires saveDir or PI_IMAGE_SAVE_DIR.");
		}
		return { mode, outputDir: dir };
	}

	return { mode };
}

function imageExtension(mimeType: string): string {
	const lower = mimeType.toLowerCase();
	if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
	if (lower.includes("gif")) return "gif";
	if (lower.includes("webp")) return "webp";
	if (lower.includes("png")) return "png";
	return "png";
}

async function saveImage(base64Data: string, mimeType: string, outputDir: string): Promise<string> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const ext = imageExtension(mimeType);
	const filename = `cf-image-${timestamp}-${randomUUID().slice(0, 8)}.${ext}`;
	const filePath = join(outputDir, filename);
	await withFileMutationQueue(filePath, async () => {
		await mkdir(outputDir, { recursive: true });
		await writeFile(filePath, Buffer.from(base64Data, "base64"));
	});
	return filePath;
}

async function getCredentials(ctx: {
	modelRegistry: { getApiKeyForProvider: (provider: string) => Promise<string | undefined> };
}): Promise<ParsedCredentials> {
	const envToken = process.env.CLOUDFLARE_API_TOKEN;
	const envAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
	if (envToken && envAccountId) {
		return { apiToken: envToken, accountId: envAccountId };
	}

	const stored = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
	if (stored) {
		return parseCredentials(stored);
	}

	throw new Error(
		"Missing Cloudflare credentials. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID env vars, or add to auth.json.",
	);
}

async function generateViaCloudflare(
	prompt: string,
	model: string,
	credentials: ParsedCredentials,
	signal?: AbortSignal,
	width?: number,
	height?: number,
	numSteps?: number,
): Promise<{ image: string; mimeType: string }> {
	const url = `${CLOUDFLARE_API_BASE}/${credentials.accountId}/ai/run/${model}`;

	const formData = new FormData();
	formData.append("prompt", prompt);
	if (width !== undefined) formData.append("width", String(width));
	if (height !== undefined) formData.append("height", String(height));
	if (numSteps !== undefined) formData.append("num_steps", String(numSteps));

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${credentials.apiToken}`,
		},
		body: formData,
		signal,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Cloudflare image request failed (${response.status}): ${errorText}`);
	}

	const result = (await response.json()) as {
		success: boolean;
		result?: { image?: string };
		errors?: Array<{ message: string }>;
	};

	if (!result.success || !result.result?.image) {
		const errMsg = result.errors?.map((e) => e.message).join("; ") || "Unknown error";
		throw new Error(`Cloudflare image generation failed: ${errMsg}`);
	}

	return { image: result.result.image, mimeType: "image/jpeg" };
}

export default function cloudflareImageGen(quake: ExtensionAPI) {
	quake.registerTool({
		name: "generate_image_cloudflare",
		label: "Generate image (Cloudflare)",
		description:
			"Generate an image via Cloudflare Workers AI image models (FLUX, Stable Diffusion, etc.). Returns the image as a tool result attachment. Optional saving via save=project|global|custom|none, or PI_IMAGE_SAVE_MODE/PI_IMAGE_SAVE_DIR. Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID env vars or auth.json config.",
		parameters: TOOL_PARAMS,
		async execute(_toolCallId, params: ToolParams, signal, onUpdate, ctx) {
			const credentials = await getCredentials(ctx);
			const model = params.model || DEFAULT_MODEL;

			onUpdate?.({
				content: [{ type: "text", text: `Requesting image from Cloudflare Workers AI/${model}...` }],
				details: { provider: PROVIDER, model, width: params.width, height: params.height },
			});

			const result = await generateViaCloudflare(
				params.prompt,
				model,
				credentials,
				signal,
				params.width,
				params.height,
				params.numSteps,
			);

			const saveConfig = resolveSaveConfig(params, ctx.cwd);
			let savedPath: string | undefined;
			let saveError: string | undefined;
			if (saveConfig.mode !== "none" && saveConfig.outputDir) {
				try {
					savedPath = await saveImage(result.image, result.mimeType, saveConfig.outputDir);
				} catch (error) {
					saveError = error instanceof Error ? error.message : String(error);
				}
			}

			const summaryParts = [`Generated image via Cloudflare Workers AI/${model}.`];
			if (savedPath) {
				summaryParts.push(`Saved image to: ${savedPath}`);
			} else if (saveError) {
				summaryParts.push(`Failed to save image: ${saveError}`);
			}

			return {
				content: [
					{ type: "text", text: summaryParts.join(" ") },
					{ type: "image", data: result.image, mimeType: result.mimeType },
				],
				details: { provider: PROVIDER, model, savedPath, saveMode: saveConfig.mode },
			};
		},
	});
}
