import { describe, expect, it } from "vitest";
import {
	buildKimiEditRecoveryToolMessage,
	detectKimiEditRecoveryNeed,
	evaluateKimiRecoveryGate,
	getQuakeOptimizationBadge,
} from "../src/core/kimi-edit-recovery.js";

describe("kimi edit recovery", () => {
	it("detects exact-match edit failures for Kimi models", () => {
		const recovery = detectKimiEditRecoveryNeed(
			{ provider: "nvidia", id: "moonshotai/kimi-k2.5" },
			"edit",
			{
				content: [
					{
						type: "text",
						text: "Could not find the exact text in src/file.ts. The old text must match exactly including all whitespace and newlines.",
					},
				],
			},
			true,
			{ path: "src/file.ts" },
		);

		expect(recovery).toMatchObject({ path: "src/file.ts", modelLabel: "Kimi" });
		expect(buildKimiEditRecoveryToolMessage(recovery!)).toContain(
			"Do not reconstruct or rewrite the file from memory",
		);
	});

	it("does not enable recovery for non-Kimi models", () => {
		const recovery = detectKimiEditRecoveryNeed(
			{ provider: "openai", id: "gpt-5.4" },
			"edit",
			{ content: [{ type: "text", text: "Could not find the exact text" }] },
			true,
			{ path: "src/file.ts" },
		);

		expect(recovery).toBeUndefined();
	});

	it("blocks further mutation until the file is re-read", () => {
		const recovery = {
			path: "src/file.ts",
			reason: "Could not find the exact text",
			modelLabel: "Kimi",
		};

		expect(evaluateKimiRecoveryGate(recovery, "write", { path: "src/file.ts", content: "x" })).toMatchObject({
			blockReason: expect.stringContaining("Read src/file.ts before attempting another mutating operation"),
		});

		expect(evaluateKimiRecoveryGate(recovery, "read", { path: "src/file.ts" })).toEqual({ clearRecovery: true });
	});

	it("supports GLM-5 recovery and quake optimization badge", () => {
		const recovery = detectKimiEditRecoveryNeed(
			{ provider: "nvidia", id: "z-ai/glm5" },
			"edit",
			{ content: [{ type: "text", text: "Could not find the exact text in src/file.ts." }] },
			true,
			{ path: "src/file.ts" },
		);

		expect(recovery).toMatchObject({ modelLabel: "GLM-5" });
		expect(buildKimiEditRecoveryToolMessage(recovery!)).toContain("GLM-5 recovery policy active");
		expect(getQuakeOptimizationBadge({ provider: "nvidia", id: "z-ai/glm5" })).toBe("Optimized for QuakeCode");
	});
});
