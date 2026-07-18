import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SpatialIndex } from "../src/spatial-index.js";

describe("SpatialIndex", () => {
	test("hit-tests viewport-relative coordinates", () => {
		const index = new SpatialIndex();
		index.replace([
			{
				id: "tool:1",
				contentLineStart: 10,
				contentLineEnd: 11,
				target: "tool",
			},
		]);

		const hit = index.hitTest(4, 2, 8, 0, 80);
		assert.ok(hit);
		assert.equal(hit.region.id, "tool:1");
		assert.equal(hit.contentLine, 10);
	});

	test("applies viewport scroll offset to content line lookup", () => {
		const index = new SpatialIndex();
		index.replace([
			{
				id: "tool:scroll",
				contentLineStart: 50,
				contentLineEnd: 51,
				target: "tool",
			},
		]);

		const hit = index.hitTest(2, 0, 60, 10, 80);
		assert.ok(hit);
		assert.equal(hit.contentLine, 50);
	});

	test("screen-relative overlay regions ignore chat scroll offset", () => {
		const index = new SpatialIndex();
		index.replace([
			{
				id: "overlay-item:settings:0",
				contentLineStart: 8,
				contentLineEnd: 9,
				screenRelative: true,
				target: "overlay",
			},
		]);

		const hit = index.hitTest(10, 8, 0, 40, 80);
		assert.ok(hit);
		assert.equal(hit.region.id, "overlay-item:settings:0");
	});

	test("respects sidebar content width boundary", () => {
		const index = new SpatialIndex();
		index.replace([
			{
				id: "tool:1",
				contentLineStart: 0,
				contentLineEnd: 1,
				target: "tool",
			},
		]);

		assert.equal(index.hitTest(70, 0, 0, 0, 60), undefined);
	});
});
