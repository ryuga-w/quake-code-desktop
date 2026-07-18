import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
	AgentRoom,
	AgentRoomMessage,
	AgentRoomMessageType,
	AgentRoomStatus,
	AgentRoomTask,
	AgentRoomTaskPriority,
	AgentRoomTaskStatus,
} from "./types.js";

const ROOM_ROOT_DIR = ".quake-code/agent-rooms";

function ensureDir(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
}

function safeRoomId(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return normalized || `room-${Date.now()}`;
}

function nowIso(): string {
	return new Date().toISOString();
}

function roomDir(cwd: string, roomId: string): string {
	return path.join(cwd, ROOM_ROOT_DIR, safeRoomId(roomId));
}

function roomFile(cwd: string, roomId: string): string {
	return path.join(roomDir(cwd, roomId), "room.json");
}

function messagesFile(cwd: string, roomId: string): string {
	return path.join(roomDir(cwd, roomId), "messages.jsonl");
}

function tasksFile(cwd: string, roomId: string): string {
	return path.join(roomDir(cwd, roomId), "tasks.json");
}

function readJsonFile<T>(file: string): T | undefined {
	if (!fs.existsSync(file)) return undefined;
	return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function writeJsonFile(file: string, value: unknown): void {
	fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function touchRoom(cwd: string, room: AgentRoom): void {
	writeJsonFile(roomFile(cwd, room.id), { ...room, updatedAt: nowIso() });
}

function readTasks(cwd: string, roomId: string): AgentRoomTask[] {
	return readJsonFile<AgentRoomTask[]>(tasksFile(cwd, roomId)) ?? [];
}

function writeTasks(cwd: string, roomId: string, tasks: AgentRoomTask[]): void {
	writeJsonFile(tasksFile(cwd, roomId), tasks);
}

export function createRoom(cwd: string, input: { id?: string; name: string; goal: string; brief?: string }): AgentRoom {
	const id = safeRoomId(input.id || input.name);
	const dir = roomDir(cwd, id);
	ensureDir(dir);

	const existing = readJsonFile<AgentRoom>(roomFile(cwd, id));
	const room: AgentRoom = {
		id,
		name: input.name.trim(),
		goal: input.goal.trim(),
		brief: input.brief?.trim() || existing?.brief,
		createdAt: existing?.createdAt || nowIso(),
		updatedAt: nowIso(),
	};

	writeJsonFile(roomFile(cwd, id), room);
	if (!fs.existsSync(messagesFile(cwd, id))) fs.writeFileSync(messagesFile(cwd, id), "", "utf8");
	if (!fs.existsSync(tasksFile(cwd, id))) writeJsonFile(tasksFile(cwd, id), []);
	return room;
}

export function getRoom(cwd: string, roomId: string): AgentRoom {
	const room = readJsonFile<AgentRoom>(roomFile(cwd, roomId));
	if (!room) throw new Error(`Agent room not found: ${roomId}`);
	return room;
}

export function appendMessage(
	cwd: string,
	roomId: string,
	input: { from: string; type: AgentRoomMessageType; message: string; metadata?: Record<string, unknown> },
): AgentRoomMessage {
	const room = getRoom(cwd, roomId);
	const message: AgentRoomMessage = {
		id: randomUUID(),
		roomId: room.id,
		from: input.from.trim() || "agent",
		type: input.type,
		message: input.message.trim(),
		metadata: input.metadata,
		createdAt: nowIso(),
	};
	fs.appendFileSync(messagesFile(cwd, room.id), `${JSON.stringify(message)}\n`, "utf8");
	touchRoom(cwd, room);
	return message;
}

export function readMessages(cwd: string, roomId: string, limit = 50, type?: AgentRoomMessageType): AgentRoomMessage[] {
	const room = getRoom(cwd, roomId);
	const file = messagesFile(cwd, room.id);
	if (!fs.existsSync(file)) return [];

	const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
	const messages = lines.map((line) => JSON.parse(line) as AgentRoomMessage);
	const filtered = type ? messages.filter((message) => message.type === type) : messages;
	return filtered.slice(Math.max(0, filtered.length - Math.max(1, limit)));
}

export function addTask(
	cwd: string,
	roomId: string,
	input: {
		title: string;
		description?: string;
		priority?: AgentRoomTaskPriority;
		assignee?: string;
		metadata?: Record<string, unknown>;
	},
): AgentRoomTask {
	const room = getRoom(cwd, roomId);
	const tasks = readTasks(cwd, room.id);
	const createdAt = nowIso();
	const task: AgentRoomTask = {
		id: randomUUID().slice(0, 12),
		roomId: room.id,
		title: input.title.trim(),
		description: input.description?.trim() || undefined,
		status: input.assignee ? "claimed" : "open",
		priority: input.priority ?? "normal",
		assignee: input.assignee?.trim() || undefined,
		metadata: input.metadata,
		createdAt,
		updatedAt: createdAt,
	};
	tasks.push(task);
	writeTasks(cwd, room.id, tasks);
	touchRoom(cwd, room);
	return task;
}

export function listTasks(cwd: string, roomId: string, status?: AgentRoomTaskStatus): AgentRoomTask[] {
	const room = getRoom(cwd, roomId);
	const tasks = readTasks(cwd, room.id);
	return status ? tasks.filter((task) => task.status === status) : tasks;
}

export function getTask(cwd: string, roomId: string, taskId: string): AgentRoomTask {
	const task = listTasks(cwd, roomId).find((candidate) => candidate.id === taskId);
	if (!task) throw new Error(`Agent room task not found: ${taskId}`);
	return task;
}

export function updateTask(
	cwd: string,
	roomId: string,
	taskId: string,
	patch: {
		title?: string;
		description?: string;
		status?: AgentRoomTaskStatus;
		priority?: AgentRoomTaskPriority;
		assignee?: string;
		agentId?: string;
		metadata?: Record<string, unknown>;
	},
): AgentRoomTask {
	const room = getRoom(cwd, roomId);
	const tasks = readTasks(cwd, room.id);
	const index = tasks.findIndex((task) => task.id === taskId);
	if (index === -1) throw new Error(`Agent room task not found: ${taskId}`);

	const existing = tasks[index]!;
	const status = patch.status ?? existing.status;
	const updated: AgentRoomTask = {
		...existing,
		title: patch.title?.trim() || existing.title,
		description: patch.description !== undefined ? patch.description.trim() || undefined : existing.description,
		status,
		priority: patch.priority ?? existing.priority,
		assignee: patch.assignee !== undefined ? patch.assignee.trim() || undefined : existing.assignee,
		agentId: patch.agentId !== undefined ? patch.agentId.trim() || undefined : existing.agentId,
		metadata: patch.metadata !== undefined ? { ...(existing.metadata ?? {}), ...patch.metadata } : existing.metadata,
		updatedAt: nowIso(),
		completedAt: status === "done" || status === "cancelled" ? existing.completedAt ?? nowIso() : undefined,
	};
	tasks[index] = updated;
	writeTasks(cwd, room.id, tasks);
	touchRoom(cwd, room);
	return updated;
}

export function claimTask(cwd: string, roomId: string, taskId: string, assignee: string): AgentRoomTask {
	return updateTask(cwd, roomId, taskId, { assignee, status: "claimed" });
}

export function completeTask(
	cwd: string,
	roomId: string,
	taskId: string,
	metadata?: Record<string, unknown>,
): AgentRoomTask {
	return updateTask(cwd, roomId, taskId, { status: "done", metadata });
}

export function getStatus(cwd: string, roomId: string): AgentRoomStatus {
	const room = getRoom(cwd, roomId);
	const messages = readMessages(cwd, room.id, Number.MAX_SAFE_INTEGER);
	const tasks = listTasks(cwd, room.id);
	const countsByType: Record<string, number> = {};
	const countsByTaskStatus: Record<string, number> = {};
	for (const message of messages) countsByType[message.type] = (countsByType[message.type] || 0) + 1;
	for (const task of tasks) countsByTaskStatus[task.status] = (countsByTaskStatus[task.status] || 0) + 1;
	return {
		room,
		messageCount: messages.length,
		countsByType,
		recentMessages: messages.slice(-10),
		taskCount: tasks.length,
		countsByTaskStatus,
		recentTasks: tasks.slice(-10),
	};
}

export function roomPath(cwd: string, roomId: string): string {
	return roomDir(cwd, roomId);
}
