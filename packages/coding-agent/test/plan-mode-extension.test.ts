import { describe, expect, it, vi } from "vitest";
import planModeExtension from "../src/bundled/extensions/plan-mode/index.js";

type Handler = (event: any, ctx: any) => Promise<any> | any;

function createHarness(initialMode: "default" | "plan" = "default") {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, { handler: Handler }>();
	const tools = new Map<string, { execute: Handler }>();
	let mode = initialMode;
	let activeTools = ["read", "bash", "edit", "write", "update_plan", "request_user_input"];
	const emitPlanUpdate = vi.fn();
	const requestUserInput = vi.fn(async (request: any) => ({
		answers: Object.fromEntries(request.questions.map((question: any) => [question.id, { answers: ["A"] }])),
	}));

	const quake = {
		registerTool: vi.fn((tool: { name: string; execute: Handler }) => tools.set(tool.name, tool)),
		registerFlag: vi.fn(),
		registerCommand: vi.fn((name: string, command: { handler: Handler }) => commands.set(name, command)),
		registerShortcut: vi.fn(),
		on: vi.fn((name: string, handler: Handler) => handlers.set(name, handler)),
		getFlag: vi.fn(() => false),
		getActiveTools: vi.fn(() => [...activeTools]),
		setActiveTools: vi.fn((next: string[]) => {
			activeTools = [...next];
		}),
	};

	const ctx = {
		getCollaborationMode: () => mode,
		setCollaborationMode: (next: "default" | "plan") => {
			mode = next;
		},
		emitPlanUpdate,
		isRootAgent: () => true,
		ui: {
			requestUserInput,
			setStatus: vi.fn(),
			select: vi.fn(),
			editor: vi.fn(),
		},
	};

	planModeExtension(quake as any);
	return {
		commands,
		ctx,
		emitPlanUpdate,
		getActiveTools: () => activeTools,
		getMode: () => mode,
		handlers,
		requestUserInput,
		tools,
	};
}

describe("Codex-compatible plan mode extension", () => {
	it("keeps update_plan active and hides request_user_input in Default mode", async () => {
		const harness = createHarness();
		await harness.handlers.get("session_start")!({}, harness.ctx);
		expect(harness.getActiveTools()).toContain("update_plan");
		expect(harness.getActiveTools()).not.toContain("request_user_input");
	});

	it("toggles Plan mode and exposes request_user_input", async () => {
		const harness = createHarness();
		await harness.commands.get("plan")!.handler("", harness.ctx);
		expect(harness.getMode()).toBe("plan");
		expect(harness.getActiveTools()).toContain("request_user_input");
		await harness.commands.get("plan")!.handler("", harness.ctx);
		expect(harness.getMode()).toBe("default");
		expect(harness.getActiveTools()).not.toContain("request_user_input");
	});

	it("emits an authoritative update_plan snapshot and returns Plan updated", async () => {
		const harness = createHarness();
		const result = await harness.tools.get("update_plan")!.execute(
			"call-1",
			{
				explanation: "Starting",
				plan: [
					{ step: "Inspect", status: "in_progress" },
					{ step: "Report", status: "pending" },
				],
			},
			undefined,
			undefined,
			harness.ctx,
		);
		expect(harness.emitPlanUpdate).toHaveBeenCalledWith({
			explanation: "Starting",
			plan: [
				{ step: "Inspect", status: "in_progress" },
				{ step: "Report", status: "pending" },
			],
		});
		expect(result.content[0].text).toBe("Plan updated");
	});

	it("rejects update_plan in Plan mode", async () => {
		const harness = createHarness("plan");
		await expect(
			harness.tools.get("update_plan")!.execute(
				"call-1",
				{ plan: [{ step: "Inspect", status: "in_progress" }] },
				undefined,
				undefined,
				harness.ctx,
			),
		).rejects.toThrow("not allowed in Plan mode");
	});

	it("round-trips request_user_input only in root Plan mode", async () => {
		const harness = createHarness("plan");
		const result = await harness.tools.get("request_user_input")!.execute(
			"call-2",
			{
				questions: [
					{
						header: "Scope",
						id: "scope",
						question: "Which scope?",
						options: [
							{ label: "A", description: "First" },
							{ label: "B", description: "Second" },
						],
					},
				],
			},
			undefined,
			undefined,
			harness.ctx,
		);
		expect(harness.requestUserInput).toHaveBeenCalledOnce();
		expect(JSON.parse(result.content[0].text)).toEqual({ answers: { scope: { answers: ["A"] } } });
	});

	it("injects the Plan Mode collaboration instructions", async () => {
		const harness = createHarness("plan");
		const result = await harness.handlers.get("before_agent_start")!(
			{ systemPrompt: "base" },
			harness.ctx,
		);
		expect(result.systemPrompt).toContain("<collaboration_mode>");
		expect(result.systemPrompt).toContain("# Plan Mode (Conversational)");
		expect(result.systemPrompt).toContain("<proposed_plan>");
	});

	it("injects Codex's full Default-mode planning decision rules", async () => {
		const harness = createHarness("default");
		const result = await harness.handlers.get("before_agent_start")!(
			{ systemPrompt: "base" },
			harness.ctx,
		);
		expect(result.systemPrompt).toContain("## Planning");
		expect(result.systemPrompt).toContain("Use a plan when:");
		expect(result.systemPrompt).toContain("The task is non-trivial and will require multiple actions");
		expect(result.systemPrompt).toContain("## `update_plan`");
		expect(result.systemPrompt).toContain("There should always be exactly one `in_progress` step");
	});

	it("blocks mutating tools and unsafe shell commands in Plan mode", async () => {
		const harness = createHarness("plan");
		expect(await harness.handlers.get("tool_call")!({ toolName: "write", input: {} }, harness.ctx)).toMatchObject({
			block: true,
		});
		expect(
			await harness.handlers.get("tool_call")!(
				{ toolName: "bash", input: { command: "rm -rf ." } },
				harness.ctx,
			),
		).toMatchObject({ block: true });
	});
});
