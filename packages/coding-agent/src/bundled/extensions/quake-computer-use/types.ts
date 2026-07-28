export type DesktopCoordinate = [number, number];

export type DesktopDisplayInfo = {
	width: number;
	height: number;
	displayId: string;
	displayName: string;
	scaleFactor: number;
	physicalWidth: number;
	physicalHeight: number;
};

export type DesktopScreenshotResult = DesktopDisplayInfo & {
	mimeType: string;
	data: string;
};

export type TrajectoryStepKind = "session_start" | "session_end" | "screenshot" | "cursor_position" | "actuate" | "error";

export type TrajectoryStep = {
	at: string;
	sessionId: string;
	kind: TrajectoryStepKind;
	tool?: string;
	action?: string;
	ok: boolean;
	detail?: Record<string, unknown>;
	error?: string;
};

export type TrajectorySessionMeta = {
	sessionId: string;
	startedAt: string;
	endedAt?: string;
	cwd: string;
	stepCount: number;
};