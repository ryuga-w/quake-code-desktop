import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MOUSE_MOD_CTRL, parseSgrMouse, stripMouseButton } from "../src/mouse.js";

describe("parseSgrMouse", () => {
	test("parses left click down", () => {
		const event = parseSgrMouse("\x1b[<0;12;5M");
		assert.ok(event);
		assert.equal(event.type, "down");
		assert.equal(event.x, 11);
		assert.equal(event.y, 4);
		assert.equal(event.button, 0);
	});

	test("parses left click release", () => {
		const event = parseSgrMouse("\x1b[<0;12;5m");
		assert.ok(event);
		assert.equal(event.type, "up");
	});

	test("parses wheel up", () => {
		// SGR wheel-up is button code 64 (bit 6 set), not the legacy x10 code 4.
		const event = parseSgrMouse("\x1b[<64;1;1M");
		assert.ok(event);
		assert.equal(event.type, "wheel");
		if (event.type === "wheel") {
			assert.equal(event.direction, "up");
		}
	});

	test("parses wheel down", () => {
		const event = parseSgrMouse("\x1b[<65;2;2M");
		assert.ok(event);
		assert.equal(event.type, "wheel");
		if (event.type === "wheel") {
			assert.equal(event.direction, "down");
		}
	});

	test("parses wheel up with modifier (shift) still as wheel", () => {
		// 64 + shift(4) = 68 must still decode as a wheel-up event.
		const event = parseSgrMouse("\x1b[<68;1;1M");
		assert.ok(event);
		assert.equal(event.type, "wheel");
		if (event.type === "wheel") {
			assert.equal(event.direction, "up");
			assert.equal(event.shift, true);
		}
	});

	test("legacy x10 button 4/5 are NOT wheel events", () => {
		// Guard against the old bug that treated press-codes 4/5 as wheel.
		const up = parseSgrMouse("\x1b[<4;1;1M");
		assert.ok(up);
		assert.notEqual(up.type, "wheel");
	});

	test("parses drag motion", () => {
		const event = parseSgrMouse("\x1b[<32;4;4M");
		assert.ok(event);
		assert.equal(event.type, "motion");
	});

	test("detects ctrl modifier on click", () => {
		const raw = 0 + MOUSE_MOD_CTRL;
		const event = parseSgrMouse(`\x1b[<${raw};3;3M`);
		assert.ok(event);
		assert.equal(event.button, 0);
		assert.equal(event.ctrl, true);
		assert.equal(stripMouseButton(raw), 0);
	});
});
