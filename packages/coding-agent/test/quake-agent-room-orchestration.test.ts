import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertRoomLeader, pathsOverlap } from "../src/bundled/extensions/quake-agent-room/orchestration.js";
import {
	addTask,
	claimTask,
	createRoom,
	listRooms,
	updateTask,
} from "../src/bundled/extensions/quake-agent-room/store.js";
import type { AgentRoom } from "../src/bundled/extensions/quake-agent-room/types.js";

let tempDirs: string[] = [];

function tempCwd(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quake-agent-room-orch-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

describe("agent room orchestration", () => {
	it("detects overlapping path scopes", () => {
		expect(pathsOverlap(["src/auth"], ["src/auth/session.ts"])).toBe(true);
		expect(pathsOverlap(["src/auth"], ["src/ui"])).toBe(false);
	});

	it("enforces leader-only operations when leader is assigned", () => {
		const room: AgentRoom = {
			id: "ops",
			name: "Ops",
			goal: "test",
			leaderSessionId: "leader-session-1",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		expect(() => assertRoomLeader(room, "other-session", "finalize")).toThrow(/leader/i);
		expect(() => assertRoomLeader(room, "leader-session-1", "finalize")).not.toThrow();
	});

	it("blocks claim when dependencies are unmet", () => {
		const cwd = tempCwd();
		const room = createRoom(cwd, { name: "Deps", goal: "dependency chain", leaderSessionId: "leader-1" });
		const first = addTask(cwd, room.id, { title: "First" });
		const second = addTask(cwd, room.id, { title: "Second", dependsOn: [first.id] });
		expect(() => claimTask(cwd, room.id, { taskId: second.id, assignee: "worker" })).toThrow(/unmet dependencies/i);
		updateTask(cwd, room.id, { taskId: first.id, status: "done" });
		const claimed = claimTask(cwd, room.id, { taskId: second.id, assignee: "worker" });
		expect(claimed.status).toBe("claimed");
	});

	it("blocks overlapping active task scopes", () => {
		const cwd = tempCwd();
		const room = createRoom(cwd, { name: "Scope", goal: "path isolation" });
		const a = addTask(cwd, room.id, { title: "Task A", allowedPaths: ["src/auth"] });
		const b = addTask(cwd, room.id, { title: "Task B", allowedPaths: ["src/auth/session.ts"] });
		updateTask(cwd, room.id, { taskId: a.id, status: "in_progress" });
		expect(() => claimTask(cwd, room.id, { taskId: b.id, assignee: "worker-b" })).toThrow(/path scope conflicts/i);
	});

	it("lists rooms with summary counts", () => {
		const cwd = tempCwd();
		createRoom(cwd, { id: "alpha", name: "Alpha", goal: "one", leaderSessionId: "s1", phase: "plan" });
		const beta = createRoom(cwd, { id: "beta", name: "Beta", goal: "two" });
		addTask(cwd, beta.id, { title: "Only task" });
		const rooms = listRooms(cwd);
		expect(rooms).toHaveLength(2);
		expect(rooms.find((entry) => entry.room.id === "beta")?.taskCount).toBe(1);
	});
});