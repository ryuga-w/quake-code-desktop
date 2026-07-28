import { describe, expect, it, beforeEach } from "vitest";
import { createUpdatePlanToolDefinition } from "./update-plan.js";
import {
	clearLastPlanUpdate,
	getLastPlanUpdate,
	publishPlanUpdate,
	setPlanUpdateListener,
} from "../plan-update-bus.js";
import { buildSystemPrompt } from "../system-prompt.js";
import { ALL_BUILTIN_TOOL_NAMES, allTools } from "./index.js";

describe("update_plan core tool (Codex PlanHandler)", () => {
	beforeEach(() => {
		clearLastPlanUpdate();
		setPlanUpdateListener(undefined);
	});

	it("is a builtin always-on tool name", () => {
		expect("update_plan" in allTools).toBe(true);
		expect(ALL_BUILTIN_TOOL_NAMES).toContain("update_plan");
	});

	it("publishes plan snapshot and returns Plan updated", async () => {
		const seen: unknown[] = [];
		setPlanUpdateListener((u) => seen.push(u));
		const def = createUpdatePlanToolDefinition();
		const result = await def.execute("c1", {
			explanation: "start work",
			plan: [
				{ step: "Read files", status: "completed" },
				{ step: "Edit code", status: "in_progress" },
				{ step: "Run tests", status: "pending" },
			],
		} as any);
		expect(result.content?.[0]).toMatchObject({ type: "text", text: "Plan updated" });
		expect(seen.length).toBe(1);
		expect(getLastPlanUpdate()?.plan).toHaveLength(3);
		expect(getLastPlanUpdate()?.plan[1].status).toBe("in_progress");
	});

	it("blocks in plan collaboration mode", async () => {
		const def = createUpdatePlanToolDefinition();
		await expect(
			def.execute(
				"c2",
				{ plan: [{ step: "Only step", status: "in_progress" }] } as any,
				undefined,
				undefined,
				{ getCollaborationMode: () => "plan" } as any,
			),
		).rejects.toThrow(/not allowed in Plan mode/i);
	});

	it("system prompt always includes Plan tool doctrine", () => {
		const prompt = buildSystemPrompt({
			selectedTools: ["read", "bash", "update_plan"],
			toolSnippets: {},
		});
		expect(prompt).toContain("## Plan tool");
		expect(prompt).toContain("update_plan");
		expect(prompt).toMatch(/after each sub-task|after having performed one of the sub-tasks/i);
		expect(prompt).toContain("- update_plan:");
	});
});

describe("plan-update-bus", () => {
	it("publishPlanUpdate stores last snapshot", () => {
		clearLastPlanUpdate();
		publishPlanUpdate({
			plan: [{ step: "A", status: "completed" }],
		});
		expect(getLastPlanUpdate()?.plan[0].step).toBe("A");
	});
});
