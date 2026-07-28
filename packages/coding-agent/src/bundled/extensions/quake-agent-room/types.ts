export type AgentRoomMessageType =
	| "finding"
	| "decision"
	| "question"
	| "answer"
	| "task"
	| "status"
	| "risk"
	| "summary"
	| "system";

export type AgentRoomContextMode = "compact" | "standard" | "full";

export type AgentRoomTaskStatus = "open" | "claimed" | "in_progress" | "blocked" | "done" | "cancelled";

export type AgentRoomTaskPriority = "low" | "normal" | "high";

export interface AgentRoom {
	id: string;
	name: string;
	goal: string;
	brief?: string;
	createdAt: string;
	updatedAt: string;
}

export interface AgentRoomMessage {
	id: string;
	roomId: string;
	from: string;
	type: AgentRoomMessageType;
	message: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface AgentRoomTask {
	id: string;
	roomId: string;
	title: string;
	description?: string;
	status: AgentRoomTaskStatus;
	priority: AgentRoomTaskPriority;
	assignee?: string;
	agentId?: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
}

export interface AgentRoomStatus {
	room: AgentRoom;
	messageCount: number;
	countsByType: Record<string, number>;
	recentMessages: AgentRoomMessage[];
	taskCount: number;
	countsByTaskStatus: Record<string, number>;
	recentTasks: AgentRoomTask[];
}
