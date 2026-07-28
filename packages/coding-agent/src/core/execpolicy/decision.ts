/** Codex execpolicy Decision. */

export type ExecDecision = "allow" | "prompt" | "forbidden";

export function parseExecDecision(raw: string): ExecDecision {
	const v = raw.trim().toLowerCase();
	if (v === "allow" || v === "prompt" || v === "forbidden") return v;
	throw new Error(`InvalidDecision: ${raw}`);
}

export function maxStrictness(a: ExecDecision, b: ExecDecision): ExecDecision {
	const rank = { allow: 0, prompt: 1, forbidden: 2 } as const;
	return rank[a] >= rank[b] ? a : b;
}
