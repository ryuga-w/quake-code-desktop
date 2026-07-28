import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import registerAgentRoomExtension from "../src/bundled/extensions/quake-agent-room/index.js";
import { buildRoomPrompt } from "../src/bundled/extensions/quake-agent-room/prompts.js";
import type { AgentRoomMessage } from "../src/bundled/extensions/quake-agent-room/types.js";

let tempDirs: string[] = [];

function tempCwd(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quake-agent-room-tools-"));
	tempDirs.push(dir);
	return dir;
}

function getText(result: any): string {
	return result.content.find((entry: any) => entry.type === "text")?.text ?? "";
}

function createRegisteredTools() {
	const tools = new Map<string, any>();
	registerAgentRoomExtension({
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
	} as any);
	return tools;
}

afterEach(() => {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

describe("quake agent room tools", () => {
	it("registers the public AgentRoom tool surface", () => {
		const tools = createRegisteredTools();

		expect([...tools.keys()].sort()).toEqual([
			"agent_room_add_task",
			"agent_room_claim_task",
			"agent_room_complete_task",
			"agent_room_list_tasks",
			"agent_room_post",
			"agent_room_read",
			"agent_room_spawn",
			"agent_room_status",
			"agent_room_update_task",
			"create_agent_room",
		]);
	});

	it("creates, posts, reads, and reports status through tool execute handlers", async () => {
		const cwd = tempCwd();
		const ctx = { cwd };
		const tools = createRegisteredTools();
		const signal = new AbortController().signal;
		const noop = () => {};

		const created = await tools.get("create_agent_room").execute(
			"create",
			{
				id: "Landing Room",
				name: "Landing Room",
				goal: "Coordinate landing work",
				brief: "Keep copy plain Turkish.",
			},
			signal,
			noop,
			ctx,
		);
		expect(getText(created)).toContain("landing-room");

		await tools
			.get("agent_room_post")
			.execute(
				"post",
				{
					roomId: "landing-room",
					from: "copywriter",
					type: "decision",
					message: "Demo and trial CTAs stay separate.",
				},
				signal,
				noop,
				ctx,
			);

		const read = await tools
			.get("agent_room_read")
			.execute("read", { roomId: "landing-room", limit: 5 }, signal, noop, ctx);
		expect(getText(read)).toContain("copywriter");
		expect(getText(read)).toContain("Demo and trial CTAs stay separate.");

		const added = await tools
			.get("agent_room_add_task")
			.execute(
				"task",
				{
					roomId: "landing-room",
					title: "Review CTA copy",
					priority: "high",
				},
				signal,
				noop,
				ctx,
			);
		const taskId = added.details.task.id;
		expect(getText(added)).toContain("Task added");

		await tools
			.get("agent_room_claim_task")
			.execute("claim", { roomId: "landing-room", taskId, assignee: "qa" }, signal, noop, ctx);
		await tools
			.get("agent_room_update_task")
			.execute("update", { roomId: "landing-room", taskId, status: "in_progress" }, signal, noop, ctx);

		const tasks = await tools
			.get("agent_room_list_tasks")
			.execute("tasks", { roomId: "landing-room" }, signal, noop, ctx);
		expect(getText(tasks)).toContain("Review CTA copy");
		expect(getText(tasks)).toContain("in_progress/high");

		await tools
			.get("agent_room_complete_task")
			.execute("complete", { roomId: "landing-room", taskId }, signal, noop, ctx);

		const status = await tools
			.get("agent_room_status")
			.execute("status", { roomId: "landing-room" }, signal, noop, ctx);
		expect(getText(status)).toContain("Room: Landing Room");
		expect(getText(status)).toContain("Messages: 6");
		expect(getText(status)).toContain("Tasks: 1 (done:1)");
		expect(status.details.status.countsByType.system).toBe(1);
		expect(status.details.status.countsByType.decision).toBe(1);
		expect(status.details.status.countsByTaskStatus.done).toBe(1);
	});

	it("builds bounded room prompts according to context mode", () => {
		const room = {
			id: "qa-room",
			name: "QA Room",
			goal: "Validate coordination prompt",
			brief: "Shared brief.",
			createdAt: "2026-04-30T00:00:00.000Z",
			updatedAt: "2026-04-30T00:00:00.000Z",
		};
		const messages: AgentRoomMessage[] = Array.from({ length: 20 }, (_, index) => ({
			id: String(index),
			roomId: room.id,
			from: "agent",
			type: "finding",
			message: `message-${index}`,
			createdAt: "2026-04-30T00:00:00.000Z",
		}));

		const prompt = buildRoomPrompt({
			room,
			messages,
			tasks: [
				{
					id: "task-1",
					roomId: room.id,
					title: "Validate prompt task context",
					status: "open",
					priority: "normal",
					createdAt: "2026-04-30T00:00:00.000Z",
					updatedAt: "2026-04-30T00:00:00.000Z",
				},
			],
			role: "QA",
			task: "Check the room prompt.",
			contextMode: "compact",
		});

		expect(prompt).toContain("Room: QA Room (qa-room)");
		expect(prompt).toContain("Your role: QA");
		expect(prompt).toContain("Validate prompt task context");
		expect(prompt).toContain("message-19");
		expect(prompt).toContain("message-8");
		expect(prompt).not.toContain("message-7");
	});
});
