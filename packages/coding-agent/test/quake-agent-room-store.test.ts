import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	addTask,
	appendMessage,
	claimTask,
	completeTask,
	createRoom,
	getStatus,
	listTasks,
	readMessages,
	updateTask,
} from "../src/bundled/extensions/quake-agent-room/store.js";

let tempDirs: string[] = [];

function tempCwd(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quake-agent-room-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

describe("quake agent room store", () => {
	it("creates a room and appends jsonl messages", () => {
		const cwd = tempCwd();
		const room = createRoom(cwd, {
			id: "Landing Redesign",
			name: "Landing Redesign",
			goal: "Coordinate a landing page redesign",
			brief: "Use plain Turkish SaaS copy.",
		});

		expect(room.id).toBe("landing-redesign");
		expect(room.goal).toContain("landing page");

		appendMessage(cwd, room.id, { from: "planner", type: "decision", message: "Separate trial and demo CTAs." });
		appendMessage(cwd, room.id, { from: "qa", type: "risk", message: "Do not use customer-facing SEO wording." });

		const messages = readMessages(cwd, room.id, 10);
		expect(messages).toHaveLength(2);
		expect(messages[0]?.type).toBe("decision");
		expect(messages[1]?.message).toContain("SEO");
	});

	it("tracks task lifecycle state", () => {
		const cwd = tempCwd();
		const room = createRoom(cwd, { name: "Agent Tasks", goal: "Coordinate queued work" });

		const task = addTask(cwd, room.id, {
			title: "Inspect the planner",
			description: "Find low-risk seams.",
			priority: "high",
		});
		expect(task.status).toBe("open");
		expect(task.priority).toBe("high");

		const claimed = claimTask(cwd, room.id, task.id, "planner");
		expect(claimed.status).toBe("claimed");
		expect(claimed.assignee).toBe("planner");

		const running = updateTask(cwd, room.id, task.id, { status: "in_progress", agentId: "agent-1" });
		expect(running.agentId).toBe("agent-1");

		const done = completeTask(cwd, room.id, task.id, { result: "ok" });
		expect(done.status).toBe("done");
		expect(done.completedAt).toBeDefined();
		expect(done.metadata?.result).toBe("ok");

		expect(listTasks(cwd, room.id, "done")).toHaveLength(1);
	});

	it("returns status with message and task counts", () => {
		const cwd = tempCwd();
		const room = createRoom(cwd, { name: "Admin CRM", goal: "Harden CRM admin" });
		appendMessage(cwd, room.id, { from: "backend", type: "finding", message: "Archive is soft delete." });
		appendMessage(cwd, room.id, { from: "frontend", type: "finding", message: "Archived leads are read-only." });
		addTask(cwd, room.id, { title: "Review archive permissions" });
		addTask(cwd, room.id, { title: "Check audit logs", assignee: "security" });

		const status = getStatus(cwd, room.id);
		expect(status.messageCount).toBe(2);
		expect(status.countsByType.finding).toBe(2);
		expect(status.recentMessages).toHaveLength(2);
		expect(status.taskCount).toBe(2);
		expect(status.countsByTaskStatus.open).toBe(1);
		expect(status.countsByTaskStatus.claimed).toBe(1);
	});
});
