import { describe, expect, it } from "vitest";
import {
	ProposedPlanParser,
	extractProposedPlanText,
	stripProposedPlanBlocks,
} from "../src/bundled/extensions/plan-mode/proposed-plan.js";

describe("ProposedPlanParser", () => {
	it("streams plan segments across chunk boundaries", () => {
		const parser = new ProposedPlanParser();
		const chunks = [
			parser.pushStr("Intro\n<prop"),
			parser.pushStr("osed_plan>\n- step 1\n"),
			parser.pushStr("</proposed_plan>\nOutro"),
			parser.finish(),
		];
		expect(chunks.map((chunk) => chunk.visibleText).join("")).toBe("Intro\nOutro");
		expect(chunks.flatMap((chunk) => chunk.segments)).toEqual([
			{ kind: "normal", text: "Intro\n" },
			{ kind: "start" },
			{ kind: "delta", text: "- step 1\n" },
			{ kind: "end" },
			{ kind: "normal", text: "Outro" },
		]);
	});

	it("preserves non-tag lines", () => {
		const parser = new ProposedPlanParser();
		const result = parser.pushStr("  <proposed_plan> extra\n");
		expect(result.visibleText).toBe("  <proposed_plan> extra\n");
	});

	it("closes an unterminated plan block on finish", () => {
		const parser = new ProposedPlanParser();
		const first = parser.pushStr("<proposed_plan>\n- step 1\n");
		const last = parser.finish();
		expect([...first.segments, ...last.segments]).toEqual([
			{ kind: "start" },
			{ kind: "delta", text: "- step 1\n" },
			{ kind: "end" },
		]);
	});
});

describe("proposed plan helpers", () => {
	it("strips plan blocks from visible assistant text", () => {
		expect(
			stripProposedPlanBlocks("before\n<proposed_plan>\n- step\n</proposed_plan>\nafter"),
		).toBe("before\nafter");
	});

	it("extracts the authoritative final plan", () => {
		expect(
			extractProposedPlanText("before\n<proposed_plan>\n- step\n</proposed_plan>\nafter"),
		).toBe("- step\n");
	});
});
