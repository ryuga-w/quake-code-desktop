import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readdirSync } from "node:fs";

export type ComputerUseToolMode = "custom" | "claude_native";

export type ComputerUsePolicy = {
	actuateEnabled: boolean;
	stepLimit: number;
	toolMode?: ComputerUseToolMode;
};

export const DEFAULT_COMPUTER_USE_POLICY: ComputerUsePolicy = {
	actuateEnabled: false,
	stepLimit: 40,
	toolMode: "custom",
};

function policyFile(cwd: string): string {
	return join(cwd, ".quake-code", "computer-use", "policy.json");
}

export function loadComputerUsePolicy(cwd: string): ComputerUsePolicy {
	const file = policyFile(cwd);
	if (!existsSync(file)) return { ...DEFAULT_COMPUTER_USE_POLICY };
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<ComputerUsePolicy>;
		const toolMode = parsed.toolMode === "claude_native" ? "claude_native" : "custom";
		return {
			actuateEnabled: parsed.actuateEnabled === true,
			stepLimit:
				typeof parsed.stepLimit === "number" && parsed.stepLimit > 0
					? Math.min(Math.floor(parsed.stepLimit), 200)
					: DEFAULT_COMPUTER_USE_POLICY.stepLimit,
			toolMode,
		};
	} catch {
		return { ...DEFAULT_COMPUTER_USE_POLICY };
	}
}

export function saveComputerUsePolicy(cwd: string, patch: Partial<ComputerUsePolicy>): ComputerUsePolicy {
	const current = loadComputerUsePolicy(cwd);
	const next: ComputerUsePolicy = {
		actuateEnabled: patch.actuateEnabled ?? current.actuateEnabled,
		stepLimit: patch.stepLimit ?? current.stepLimit,
		toolMode: patch.toolMode ?? current.toolMode ?? "custom",
	};
	const dir = dirname(policyFile(cwd));
	mkdirSync(dir, { recursive: true });
	writeFileSync(policyFile(cwd), `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return next;
}

export type TrajectoryStepSummary = {
	at: string;
	kind: string;
	tool?: string;
	action?: string;
	ok: boolean;
	error?: string;
	detail?: Record<string, unknown>;
};

export type ComputerUseCursorState = {
	x: number;
	y: number;
	kind: string;
	label?: string;
	at: number;
};

export function listRecentTrajectorySteps(cwd: string, limit = 20): TrajectoryStepSummary[] {
	const dir = join(cwd, ".quake-code", "computer-use", "trajectories");
	if (!existsSync(dir)) return [];
	const files = readdirSync(dir)
		.filter((name) => name.endsWith(".jsonl"))
		.map((name) => join(dir, name))
		.sort((a, b) => b.localeCompare(a));
	const steps: TrajectoryStepSummary[] = [];
	for (const file of files) {
		if (steps.length >= limit) break;
		const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
		for (let i = lines.length - 1; i >= 0; i -= 1) {
			if (steps.length >= limit) break;
			try {
				const row = JSON.parse(lines[i]!) as TrajectoryStepSummary;
				steps.push(row);
			} catch {
				// ignore malformed lines
			}
		}
	}
	return steps;
}

export async function probeComputerUseBridge(): Promise<{
	available: boolean;
	embedded: boolean;
	targetWidth?: number;
	targetHeight?: number;
	sessionActive?: boolean;
	lastCursor?: ComputerUseCursorState | null;
}> {
	const port = process.env.QUAKE_COMPUTER_USE_BRIDGE_PORT?.trim() || "9224";
	const host = process.env.QUAKE_CDP_HOST?.trim() || "127.0.0.1";
	try {
		const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(2000) });
		if (!res.ok) return { available: false, embedded: false };
		const data = (await res.json()) as {
			ok?: boolean;
			embedded?: boolean;
			targetWidth?: number;
			targetHeight?: number;
			sessionActive?: boolean;
			lastCursor?: ComputerUseCursorState | null;
		};
		return {
			available: data.ok === true,
			embedded: data.embedded === true,
			targetWidth: data.targetWidth,
			targetHeight: data.targetHeight,
			sessionActive: data.sessionActive === true,
			lastCursor: data.lastCursor ?? null,
		};
	} catch {
		return { available: false, embedded: false };
	}
}