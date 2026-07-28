import { existsSync, readFileSync } from "node:fs";

/** Written by grok-premium agent-worker when user attaches an image to a prompt */
export function readStagedVideoSourceImage(): string | undefined {
	const path = process.env.QUAKE_VIDEO_SOURCE_IMAGE_FILE;
	if (!path || !existsSync(path)) return undefined;
	try {
		const raw = readFileSync(path, "utf8").trim();
		return raw || undefined;
	} catch {
		return undefined;
	}
}
