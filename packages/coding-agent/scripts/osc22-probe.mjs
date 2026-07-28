#!/usr/bin/env node
/**
 * OSC 22 pointer-shape probe for Windows Terminal and other hosts.
 *
 * Automated: validates sequence emission.
 * Interactive (TTY): flashes pointer shapes so you can confirm visually.
 *
 * Usage:
 *   npm run mouse:osc22-probe
 *   npm run mouse:osc22-probe -- --interactive
 */

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { setPointerShape } from "@mrquake/quakecode-tui";

const interactive = process.argv.includes("--interactive");
const writes = [];
const terminal = {
	write(data) {
		writes.push(data);
		if (process.stdout.isTTY) {
			process.stdout.write(data);
		}
	},
};

const expected = {
	pointer: "\x1b]22;pointer\x1b\\",
	text: "\x1b]22;text\x1b\\",
	default: "\x1b]22;\x1b\\",
};

let failed = false;
for (const [shape, seq] of Object.entries(expected)) {
	setPointerShape(terminal, shape === "default" ? "default" : shape);
	const emitted = writes.at(-1);
	if (emitted !== seq) {
		console.error(`osc22_probe_failed: ${shape} expected ${JSON.stringify(seq)} got ${JSON.stringify(emitted)}`);
		failed = true;
	}
}

if (failed) {
	process.exit(1);
}

console.log("osc22_probe_ok", { sequences: Object.keys(expected).length, interactive });

if (!interactive || !process.stdout.isTTY) {
	if (!process.stdout.isTTY) {
		console.log("osc22_probe_note: run in a TTY with --interactive for visual confirmation");
	}
	process.exit(0);
}

const rl = readline.createInterface({ input, output });
console.log("\nInteractive OSC 22 probe — move the mouse over this terminal.");
console.log("Expected: arrow (default) → hand (pointer) → I-beam (text) → arrow again.");
console.log("Windows Terminal: pointer/text may be no-op; arrow is still the baseline.\n");

const steps = [
	{ shape: "default", label: "default arrow" },
	{ shape: "pointer", label: "pointer (hand)" },
	{ shape: "text", label: "text (I-beam)" },
	{ shape: "default", label: "default arrow (reset)" },
];

for (const step of steps) {
	setPointerShape(terminal, step.shape);
	await rl.question(`Press Enter after observing cursor: ${step.label}… `);
}

setPointerShape(terminal, "default");
rl.close();
console.log("osc22_probe_interactive_done");