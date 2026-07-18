import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TrajectorySessionMeta, TrajectoryStep, TrajectoryStepKind } from "./types.js";

function trajectoryRoot(cwd: string): string {
	return path.join(cwd, ".quake-code", "computer-use", "trajectories");
}

function sessionFile(cwd: string, sessionId: string): string {
	return path.join(trajectoryRoot(cwd), `${sessionId}.jsonl`);
}

function metaFile(cwd: string, sessionId: string): string {
	return path.join(trajectoryRoot(cwd), `${sessionId}.meta.json`);
}

export function createSessionId(): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const suffix = Math.random().toString(36).slice(2, 8);
	return `cu-${stamp}-${suffix}`;
}

export function startTrajectorySession(cwd: string, sessionId: string): TrajectorySessionMeta {
	const root = trajectoryRoot(cwd);
	fs.mkdirSync(root, { recursive: true });
	const meta: TrajectorySessionMeta = {
		sessionId,
		startedAt: new Date().toISOString(),
		cwd,
		stepCount: 0,
	};
	fs.writeFileSync(metaFile(cwd, sessionId), `${JSON.stringify(meta)}\n`, "utf8");
	appendTrajectoryStep(cwd, {
		at: meta.startedAt,
		sessionId,
		kind: "session_start",
		ok: true,
	});
	return meta;
}

export function appendTrajectoryStep(cwd: string, step: TrajectoryStep): void {
	const root = trajectoryRoot(cwd);
	fs.mkdirSync(root, { recursive: true });
	fs.appendFileSync(sessionFile(cwd, step.sessionId), `${JSON.stringify(step)}\n`, "utf8");
	const metaPath = metaFile(cwd, step.sessionId);
	if (fs.existsSync(metaPath)) {
		const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as TrajectorySessionMeta;
		meta.stepCount += 1;
		fs.writeFileSync(metaPath, `${JSON.stringify(meta)}\n`, "utf8");
	}
}

export function endTrajectorySession(cwd: string, sessionId: string): TrajectorySessionMeta | undefined {
	const metaPath = metaFile(cwd, sessionId);
	if (!fs.existsSync(metaPath)) return undefined;
	const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as TrajectorySessionMeta;
	meta.endedAt = new Date().toISOString();
	fs.writeFileSync(metaPath, `${JSON.stringify(meta)}\n`, "utf8");
	appendTrajectoryStep(cwd, {
		at: meta.endedAt,
		sessionId,
		kind: "session_end",
		ok: true,
		detail: { stepCount: meta.stepCount },
	});
	return meta;
}

export function logToolStep(input: {
	cwd: string;
	sessionId: string;
	kind: TrajectoryStepKind;
	tool: string;
	ok: boolean;
	action?: string;
	detail?: Record<string, unknown>;
	error?: string;
}): void {
	appendTrajectoryStep(input.cwd, {
		at: new Date().toISOString(),
		sessionId: input.sessionId,
		kind: input.kind,
		tool: input.tool,
		action: input.action,
		ok: input.ok,
		detail: input.detail,
		error: input.error,
	});
}

export function readTrajectorySteps(cwd: string, sessionId: string): TrajectoryStep[] {
	const file = sessionFile(cwd, sessionId);
	if (!fs.existsSync(file)) return [];
	return fs
		.readFileSync(file, "utf8")
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line) as TrajectoryStep);
}

export function defaultTrajectoryCwd(): string {
	return process.cwd();
}

export function userTrajectoryFallbackDir(): string {
	return path.join(os.homedir(), ".quake-code", "computer-use", "trajectories");
}

export type TrajectorySessionListItem = {
	sessionId: string;
	startedAt?: string;
	endedAt?: string;
	stepCount: number;
};

export function listTrajectorySessions(cwd: string, limit = 20): TrajectorySessionListItem[] {
	const root = trajectoryRoot(cwd);
	if (!fs.existsSync(root)) return [];
	const entries = fs
		.readdirSync(root)
		.filter((name) => name.endsWith(".meta.json"))
		.map((name) => {
			try {
				const meta = JSON.parse(fs.readFileSync(path.join(root, name), "utf8")) as TrajectorySessionMeta;
				return {
					sessionId: meta.sessionId,
					startedAt: meta.startedAt,
					endedAt: meta.endedAt,
					stepCount: meta.stepCount,
				};
			} catch {
				return null;
			}
		})
		.filter((item): item is TrajectorySessionListItem => item !== null)
		.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""))
		.slice(0, limit);
	return entries;
}