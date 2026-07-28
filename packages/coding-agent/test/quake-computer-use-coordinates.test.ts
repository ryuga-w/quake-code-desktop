import { describe, expect, it } from "vitest";
import {
	TARGET_DISPLAY_HEIGHT,
	TARGET_DISPLAY_WIDTH,
	clampCoordinate,
	normalizeDisplaySize,
	scaleCoordinate,
	unscaleCoordinate,
} from "../src/bundled/extensions/quake-computer-use/coordinates.js";

describe("quake-computer-use coordinates", () => {
	it("scales coordinates from physical to target display", () => {
		const scaled = scaleCoordinate([1920, 1080], { width: 3840, height: 2160 });
		expect(scaled).toEqual([640, 400]);
	});

	it("unscales coordinates back to physical space", () => {
		const physical = unscaleCoordinate([640, 400], { width: TARGET_DISPLAY_WIDTH, height: TARGET_DISPLAY_HEIGHT }, {
			width: 3840,
			height: 2160,
		});
		expect(physical).toEqual([1920, 1080]);
	});

	it("clamps coordinates inside bounds", () => {
		expect(clampCoordinate([-5, 900], { width: TARGET_DISPLAY_WIDTH, height: TARGET_DISPLAY_HEIGHT })).toEqual([
			0,
			799,
		]);
		expect(clampCoordinate([2000, 50], { width: TARGET_DISPLAY_WIDTH, height: TARGET_DISPLAY_HEIGHT })).toEqual([
			1279,
			50,
		]);
	});

	it("normalizes invalid display sizes to target defaults", () => {
		expect(normalizeDisplaySize({ width: 0, height: 0 })).toEqual({
			width: TARGET_DISPLAY_WIDTH,
			height: TARGET_DISPLAY_HEIGHT,
		});
	});
});