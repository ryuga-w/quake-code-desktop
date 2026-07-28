import { describe, expect, it } from "vitest";
import { classifyOperationRisk, summarizeOperationEvidence } from "../src/modes/interactive/chat-approval.js";

describe("chat approval risk classification", () => {
	it("marks read-style tools as safe", () => {
		expect(classifyOperationRisk("read", { path: "src/index.ts" })).toMatchObject({
			level: "safe",
			isReadOnly: true,
		});
	});

	it("marks sensitive file writes as high-impact", () => {
		expect(classifyOperationRisk("write", { path: "package.json", content: "{}" })).toMatchObject({
			level: "high-impact",
			label: "High-impact file write",
		});
	});

	it("distinguishes destructive bash from verification bash", () => {
		expect(classifyOperationRisk("bash", { command: "git reset --hard" })).toMatchObject({
			level: "high-impact",
		});

		expect(classifyOperationRisk("bash", { command: "npm run build" })).toMatchObject({
			level: "caution",
			isReadOnly: true,
		});
	});

	it("raises review level for Kimi script edits without affecting other models", () => {
		expect(
			classifyOperationRisk(
				"edit",
				{ path: "scripts/build-entrypoint.mjs", edits: [{ oldText: "a", newText: "b" }] },
				{ currentModel: { provider: "nvidia", id: "moonshotai/kimi-k2.5" } },
			),
		).toMatchObject({
			level: "review",
			label: "Kimi reliability review for script/config change",
		});

		expect(
			classifyOperationRisk(
				"edit",
				{ path: "scripts/build-entrypoint.mjs", edits: [{ oldText: "a", newText: "b" }] },
				{ currentModel: { provider: "openai", id: "gpt-5.4" } },
			),
		).toMatchObject({
			level: "caution",
		});
	});

	it("raises review level for GLM-5 script writes", () => {
		expect(
			classifyOperationRisk(
				"write",
				{ path: "scripts/build-entrypoint.mjs", content: "console.log('x')" },
				{ currentModel: { provider: "nvidia", id: "z-ai/glm5" } },
			),
		).toMatchObject({
			level: "review",
			label: "GLM-5 reliability review for script/config write",
		});
	});

	it("summarizes evidence for config-changing operations", () => {
		expect(summarizeOperationEvidence("write", { path: "tsconfig.json", content: "{}" })).toMatchObject({
			filesTouched: 1,
			verificationRecommended: true,
		});
		expect(summarizeOperationEvidence("write", { path: "tsconfig.json", content: "{}" }).surfaces).toContain(
			"config",
		);
	});
});
