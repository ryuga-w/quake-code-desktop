import { describe, expect, test, vi } from "vitest";
import { mapOverlayHitMap, OverlayRegionCache } from "../src/modes/interactive/overlay-region-cache.js";

describe("OverlayRegionCache", () => {
	test("reuses regions when width and key are unchanged", () => {
		const cache = new OverlayRegionCache();
		const build = vi.fn(() => [{ id: "overlay-item:test:0", contentLineStart: 1, contentLineEnd: 2, target: {} }]);

		const first = cache.get(80, "a|1", build);
		const second = cache.get(80, "a|1", build);

		expect(build).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
	});

	test("rebuilds when structure key changes", () => {
		const cache = new OverlayRegionCache();
		const build = vi
			.fn()
			.mockReturnValueOnce([{ id: "overlay-item:test:0", contentLineStart: 1, contentLineEnd: 2, target: {} }])
			.mockReturnValueOnce([{ id: "overlay-item:test:1", contentLineStart: 3, contentLineEnd: 4, target: {} }]);

		const first = cache.get(80, "a|1", build);
		const second = cache.get(80, "a|2", build);

		expect(build).toHaveBeenCalledTimes(2);
		expect(second).not.toBe(first);
		expect(second[0]?.id).toBe("overlay-item:test:1");
	});
});

describe("mapOverlayHitMap", () => {
	test("maps overlay hit lines to spatial regions", () => {
		const regions = mapOverlayHitMap(
			[
				{ index: 2, line: 10 },
				{ index: 5, line: 12 },
			],
			"model",
			100,
			"target",
		);

		expect(regions).toEqual([
			{
				id: "overlay-item:model:2",
				contentLineStart: 10,
				contentLineEnd: 11,
				xStart: 0,
				xEnd: 100,
				target: "target",
			},
			{
				id: "overlay-item:model:5",
				contentLineStart: 12,
				contentLineEnd: 13,
				xStart: 0,
				xEnd: 100,
				target: "target",
			},
		]);
	});
});