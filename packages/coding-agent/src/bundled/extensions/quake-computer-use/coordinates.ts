import type { DesktopCoordinate } from "./types.js";

export const TARGET_DISPLAY_WIDTH = 1280;
export const TARGET_DISPLAY_HEIGHT = 800;

export function scaleCoordinate(
	coordinate: DesktopCoordinate,
	from: { width: number; height: number },
	to: { width: number; height: number } = { width: TARGET_DISPLAY_WIDTH, height: TARGET_DISPLAY_HEIGHT },
): DesktopCoordinate {
	const [x, y] = coordinate;
	const scaleX = to.width / from.width;
	const scaleY = to.height / from.height;
	return [Math.round(x * scaleX), Math.round(y * scaleY)];
}

export function unscaleCoordinate(
	coordinate: DesktopCoordinate,
	from: { width: number; height: number } = { width: TARGET_DISPLAY_WIDTH, height: TARGET_DISPLAY_HEIGHT },
	to: { width: number; height: number },
): DesktopCoordinate {
	const [x, y] = coordinate;
	const scaleX = to.width / from.width;
	const scaleY = to.height / from.height;
	return [Math.round(x * scaleX), Math.round(y * scaleY)];
}

export function clampCoordinate(
	coordinate: DesktopCoordinate,
	bounds: { width: number; height: number },
): DesktopCoordinate {
	const [x, y] = coordinate;
	return [
		Math.min(Math.max(0, x), Math.max(0, bounds.width - 1)),
		Math.min(Math.max(0, y), Math.max(0, bounds.height - 1)),
	];
}

export function normalizeDisplaySize(input: { width: number; height: number }): { width: number; height: number } {
	if (input.width <= 0 || input.height <= 0) {
		return { width: TARGET_DISPLAY_WIDTH, height: TARGET_DISPLAY_HEIGHT };
	}
	return input;
}

export function parseCoordinateTuple(
	value: unknown,
	bounds: { width: number; height: number } = { width: TARGET_DISPLAY_WIDTH, height: TARGET_DISPLAY_HEIGHT },
): DesktopCoordinate | undefined {
	if (!Array.isArray(value) || value.length !== 2) return undefined;
	const x = Number(value[0]);
	const y = Number(value[1]);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
	return clampCoordinate([x, y], bounds);
}