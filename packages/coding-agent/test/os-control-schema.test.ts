import { describe, expect, test } from "vitest";
import { osControlActionToolDefinition, osPerformStepToolDefinition } from "../src/core/tools/os-control.js";

describe("os-control schema", () => {
	test("exposes newly added pointer and scroll actions in both OS tools", () => {
		const controlSchema = JSON.stringify(osControlActionToolDefinition.parameters);
		const stepSchema = JSON.stringify(osPerformStepToolDefinition.parameters);

		for (const action of ["double_click", "right_click", "move", "hover", "drag", "ghost_scroll"]) {
			expect(controlSchema).toContain(`"const":"${action}"`);
			expect(stepSchema).toContain(`"const":"${action}"`);
		}
	});

	test("includes drag and movement parameters", () => {
		const schema = JSON.stringify(osControlActionToolDefinition.parameters);
		expect(schema).toContain('"toX"');
		expect(schema).toContain('"toY"');
		expect(schema).toContain('"durationMs"');
	});

	test("includes focused and clipboard verification fields", () => {
		const schema = JSON.stringify(osPerformStepToolDefinition.parameters);
		for (const field of [
			"expectedFocusedHwnd",
			"expectedFocusedType",
			"expectedFocusedName",
			"expectedFocusedAutomationId",
			"expectedFocusedEnabled",
			"expectedClipboardText",
			"expectedClipboardChanged",
			"expectedClipboardNonEmpty",
		]) {
			expect(schema).toContain(`"${field}"`);
		}
	});
});
