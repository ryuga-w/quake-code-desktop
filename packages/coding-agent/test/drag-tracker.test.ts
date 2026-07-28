import { describe, expect, test, vi } from "vitest";
import { DragTracker } from "../src/modes/interactive/drag-tracker.js";

describe("DragTracker", () => {
	test("fires click when pointer stays within threshold", () => {
		const onClick = vi.fn();
		const tracker = new DragTracker({ onClick, distanceThreshold: 5, timeThresholdMs: 100 });
		tracker.onPointerDown({ x: 1, y: 1 });
		expect(tracker.onPointerUp({ x: 2, y: 2 })).toBe("click");
		expect(onClick).toHaveBeenCalledWith({ x: 2, y: 2 });
	});

	test("stationary long press is a click, not a drag", async () => {
		const onClick = vi.fn();
		const tracker = new DragTracker({ onClick, distanceThreshold: 4, timeThresholdMs: 50 });
		tracker.onPointerDown({ x: 5, y: 5 });
		// Hold well past the time threshold but never move the pointer.
		await new Promise((r) => setTimeout(r, 80));
		expect(tracker.onPointerUp({ x: 5, y: 5 })).toBe("click");
		expect(onClick).toHaveBeenCalledWith({ x: 5, y: 5 });
	});

	test("slow drag with small drift over time still counts as drag", async () => {
		const onDragEnd = vi.fn();
		const tracker = new DragTracker({ onDragEnd, distanceThreshold: 4, timeThresholdMs: 50 });
		tracker.onPointerDown({ x: 0, y: 0 });
		await new Promise((r) => setTimeout(r, 80));
		// Small drift (>= 2px) combined with the long hold => drag.
		expect(tracker.onPointerUp({ x: 2, y: 0 })).toBe("drag");
		expect(onDragEnd).toHaveBeenCalled();
	});

	test("fires drag when pointer moves beyond threshold", () => {
		const onDragStart = vi.fn();
		const onDragEnd = vi.fn();
		const onClick = vi.fn();
		const tracker = new DragTracker({
			onDragStart,
			onDragEnd,
			onClick,
			distanceThreshold: 3,
		});
		tracker.onPointerDown({ x: 0, y: 0 });
		tracker.onPointerMove({ x: 10, y: 0 });
		expect(onDragStart).toHaveBeenCalled();
		expect(tracker.onPointerUp({ x: 10, y: 0 })).toBe("drag");
		expect(onDragEnd).toHaveBeenCalled();
		expect(onClick).not.toHaveBeenCalled();
	});
});
