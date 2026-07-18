#!/usr/bin/env node
/**
 * Non-interactive smoke checks for TUI mouse protocol parsing and spatial hit-test.
 * Run after build: npm run build && node scripts/mouse-smoke.mjs
 */

import { parseSgrMouse, setPointerShape, SpatialIndex } from "@mrquake/quakecode-tui";

function assert(condition, message) {
	if (!condition) {
		console.error("mouse_smoke_failed:", message);
		process.exit(1);
	}
}

// Click down / up
const down = parseSgrMouse("\x1b[<0;10;4M");
assert(down?.type === "down" && down.x === 9 && down.y === 3, "click down");

const up = parseSgrMouse("\x1b[<0;10;4m");
assert(up?.type === "up", "click up");

// Wheel (SGR protocol uses button codes 64/65.)
const wheelUp = parseSgrMouse("\x1b[<64;1;1M");
assert(wheelUp?.type === "wheel" && wheelUp.direction === "up", "wheel up");

const wheelDown = parseSgrMouse("\x1b[<65;1;1M");
assert(wheelDown?.type === "wheel" && wheelDown.direction === "down", "wheel down");

// Drag motion (button-event mode)
const motion = parseSgrMouse("\x1b[<32;12;6M");
assert(motion?.type === "motion", "drag motion");

// Shift bypass: ctrl+click should not be treated as wheel
const ctrlClick = parseSgrMouse("\x1b[<16;2;2M");
assert(ctrlClick?.type === "down" && ctrlClick.ctrl === true, "ctrl click");

// Spatial index + viewport scroll offset
const index = new SpatialIndex();
index.replace([
	{ id: "tool:1", contentLineStart: 120, contentLineEnd: 121, target: "t1" },
	{ id: "tool:2", contentLineStart: 200, contentLineEnd: 201, xStart: 0, xEnd: 50, target: "t2" },
]);

const hit = index.hitTest(4, 3, 117, 0, 60);
assert(hit?.region.id === "tool:1", "viewport scroll hit-test");

const sidebarMiss = index.hitTest(55, 3, 197, 0, 50);
assert(sidebarMiss === undefined, "sidebar boundary");

// Performance: 500 regions, 1000 lookups
const regions = [];
for (let i = 0; i < 500; i++) {
	regions.push({
		id: `tool:${i}`,
		contentLineStart: i * 2,
		contentLineEnd: i * 2 + 1,
		target: i,
	});
}
index.replace(regions);
const start = performance.now();
for (let i = 0; i < 1000; i++) {
	index.hitTest(2, 1, 0, 0, 80);
}
const elapsed = performance.now() - start;
assert(elapsed < 50, `hit-test perf (${elapsed.toFixed(1)}ms > 50ms)`);

// OSC 22 pointer shape sequences (format validation; terminal support is probed separately)
const pointerWrites = [];
const pointerTerminal = { write: (data) => pointerWrites.push(data) };
setPointerShape(pointerTerminal, "pointer");
assert(pointerWrites[0] === "\x1b]22;pointer\x1b\\", "osc22 pointer");
setPointerShape(pointerTerminal, "text");
assert(pointerWrites[1] === "\x1b]22;text\x1b\\", "osc22 text");
setPointerShape(pointerTerminal, "default");
assert(pointerWrites[2] === "\x1b]22;\x1b\\", "osc22 default reset");

console.log("mouse_smoke_ok", {
	sequences: 6,
	osc22: 3,
	regions: regions.length,
	lookupMs: Number(elapsed.toFixed(2)),
});