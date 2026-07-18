import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AgentManager } from "../src/bundled/extensions/quake-subagents/agent-manager.js";
import { registerAgents } from "../src/bundled/extensions/quake-subagents/agent-types.js";
import { registerCodexMultiAgentTools } from "../src/bundled/extensions/quake-subagents/codex-tools.js";
import {
	loadPersistedAgentRecords,
	SUBAGENT_RECORD_ENTRY,
	serializeAgentRecord,
} from "../src/bundled/extensions/quake-subagents/persistence.js";

vi.mock("../src/bundled/extensions/quake-subagents/agent-runner.js", () => ({
	runAgent: vi.fn(),
	resumeAgent: vi.fn(),
}));

import { runAgent } from "../src/bundled/extensions/quake-subagents/agent-runner.js";

const ctx = {
	cwd: "C:/workspace",
	model: undefined,
	modelRegistry: {
		getAvailable: () => [],
		getAll: () => [],
		find: () => undefined,
	},
	sessionManager: {
		getSessionId: () => "root-session",
		getBranch: () => [],
		getEntries: () => [],
	},
	getSystemPrompt: () => "system",
} as any;

const quake = {
	appendEntry: vi.fn(),
	events: { emit: vi.fn() },
} as any;

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function fakeSession() {
	return {
		sessionFile: "C:/sessions/child.jsonl",
		abort: vi.fn(),
		dispose: vi.fn(),
		steer: vi.fn(),
		followUp: vi.fn(),
	};
}

describe("Codex V1 manager parity", () => {
	it("counts completed agents until close_agent releases the slot", async () => {
		const first = deferred<any>();
		const second = deferred<any>();
		vi.mocked(runAgent)
			.mockReset()
			.mockImplementationOnce(() => first.promise)
			.mockImplementationOnce(() => second.promise);
		const manager = new AgentManager();
		const firstId = manager.spawn(quake, ctx, "default", "first", {
			name: "Atlas",
			description: "first",
			isBackground: true,
			protocol: "codex-v1",
			maxResidentAgents: 1,
			queueWhenBusy: false,
		});
		first.resolve({
			responseText: "done",
			session: fakeSession(),
			aborted: false,
			steered: false,
		});
		await vi.waitFor(() => expect(manager.getRecord(firstId)?.status).toBe("completed"));

		expect(() =>
			manager.spawn(quake, ctx, "default", "second", {
				name: "Nova",
				description: "second",
				isBackground: true,
				protocol: "codex-v1",
				maxResidentAgents: 1,
				queueWhenBusy: false,
			}),
		).toThrow(/agent limit reached/i);

		await manager.closeAgentById(firstId);
		const secondId = manager.spawn(quake, ctx, "default", "second", {
			name: "Nova",
			description: "second",
			isBackground: true,
			protocol: "codex-v1",
			maxResidentAgents: 1,
			queueWhenBusy: false,
		});
		expect(manager.getRecord(secondId)?.status).toBe("running");
		second.resolve({
			responseText: "done",
			session: fakeSession(),
			aborted: false,
			steered: false,
		});
		await manager.waitForAll();
		manager.dispose();
	});

	it("returns not_found immediately and an empty map on timeout", async () => {
		const manager = new AgentManager();
		const missing = randomUUID();
		await expect(manager.waitForCodexTargets([missing], { timeoutMs: 1 })).resolves.toEqual({
			status: { [missing]: "not_found" },
			timedOut: false,
		});

		const running = deferred<any>();
		vi.mocked(runAgent)
			.mockReset()
			.mockImplementationOnce(() => running.promise);
		const id = manager.spawn(quake, ctx, "default", "work", {
			name: "Atlas",
			description: "work",
			isBackground: true,
			protocol: "codex-v1",
			queueWhenBusy: false,
		});
		await expect(manager.waitForCodexTargets([id], { timeoutMs: 1 })).resolves.toEqual({
			status: {},
			timedOut: true,
		});
		manager.dispose();
	});

	it("restores persisted running agents as interrupted resumable records", () => {
		const manager = new AgentManager();
		const id = randomUUID();
		manager.restorePersisted(
			[
				{
					version: 2,
					id,
					name: "Hypatia",
					type: "default",
					description: "inspect",
					status: "running",
					protocol: "codex-v1",
					taskName: id,
					taskPath: `/root/${id}`,
					depth: 1,
					lastTaskMessage: "inspect",
					toolUses: 0,
					startedAt: 1,
					sessionFile: "C:/sessions/child.jsonl",
				},
			],
			quake,
			ctx,
		);
		expect(manager.getRecord(id)).toMatchObject({
			id,
			status: "interrupted",
			sessionFile: "C:/sessions/child.jsonl",
		});
		manager.dispose();
	});
});

describe("Codex tool surface parity", () => {
	it("registers only the stable V1 lifecycle tools by default", () => {
		registerAgents(new Map());
		const tools = new Map<string, any>();
		const api = { registerTool: (tool: any) => tools.set(tool.name, tool) } as any;
		const manager = new AgentManager();
		registerCodexMultiAgentTools(api, { manager });
		expect([...tools.keys()]).toEqual(["spawn_agent", "send_input", "wait_agent", "close_agent", "resume_agent"]);
		const spawnProperties = tools.get("spawn_agent").parameters.properties;
		expect(spawnProperties).toHaveProperty("fork_context");
		expect(spawnProperties).not.toHaveProperty("task_name");
		expect(tools.get("resume_agent").parameters.properties).toHaveProperty("id");
		manager.dispose();
	});

	it("hides V1 collaboration tools after the configured depth limit", () => {
		registerAgents(new Map());
		const tools = new Map<string, any>();
		const api = { registerTool: (tool: any) => tools.set(tool.name, tool) } as any;
		const manager = new AgentManager();
		registerCodexMultiAgentTools(api, {
			manager,
			runtimeScope: {
				manager,
				currentAgentId: randomUUID(),
				currentAgentPath: "/root/child",
				depth: 1,
				multiAgentVersion: "v1",
				maxDepth: 1,
			},
		});
		expect(tools.size).toBe(0);
		manager.dispose();
	});

	it("keeps the V2 task-path surface separate", () => {
		registerAgents(new Map());
		const tools = new Map<string, any>();
		const api = { registerTool: (tool: any) => tools.set(tool.name, tool) } as any;
		const manager = new AgentManager();
		registerCodexMultiAgentTools(api, {
			manager,
			runtimeScope: {
				manager,
				currentAgentId: randomUUID(),
				currentAgentPath: "/root/child",
				depth: 1,
				multiAgentVersion: "v2",
			},
		});
		expect([...tools.keys()]).toEqual([
			"spawn_agent",
			"send_message",
			"followup_task",
			"wait_agent",
			"list_agents",
			"interrupt_agent",
		]);
		expect(tools.get("spawn_agent").parameters.properties).toHaveProperty("task_name");
		manager.dispose();
	});
});

describe("Codex subagent persistence", () => {
	it("loads the newest record for each agent", () => {
		const record = {
			id: randomUUID(),
			name: "Euclid",
			type: "default",
			description: "task",
			status: "completed" as const,
			protocol: "codex-v1" as const,
			taskName: "task",
			taskPath: "/root/task",
			depth: 1,
			lastTaskMessage: "task",
			result: "done",
			toolUses: 0,
			startedAt: 1,
		};
		const first = serializeAgentRecord({ ...record, status: "running" } as any);
		const second = serializeAgentRecord(record as any);
		const loaded = loadPersistedAgentRecords([
			{ type: "custom", customType: SUBAGENT_RECORD_ENTRY, data: first },
			{ type: "custom", customType: SUBAGENT_RECORD_ENTRY, data: second },
		]);
		expect(loaded).toEqual([second]);
	});
});
