/**
 * Codex-style execpolicy: prefix rules + heuristics for dangerous shell commands.
 */

import { type ExecDecision, maxStrictness } from "./decision.js";

export interface PrefixRule {
	/** First token (program) and optional argv prefix */
	prefix: string[];
	decision: ExecDecision;
	reason?: string;
}

export interface ExecPolicyMatch {
	decision: ExecDecision;
	reason: string;
	matched_rule?: string;
}

export interface ExecPolicyOptions {
	/** approval_policy=never means prompt → forbidden */
	approvalNever?: boolean;
	extraRules?: PrefixRule[];
}

const DEFAULT_FORBIDDEN_PREFIXES: string[][] = [
	["rm", "-rf", "/"],
	["rm", "-rf", "/*"],
	["mkfs"],
	["dd", "if="],
	["shutdown"],
	["reboot"],
	["format"],
	[":(){ :|:& };:"],
];

const DEFAULT_PROMPT_PREFIXES: string[][] = [
	["sudo"],
	["su"],
	["chmod", "777"],
	["chown"],
	["curl"],
	["wget"],
	["npm", "publish"],
	["git", "push", "--force"],
	["git", "push", "-f"],
	["Remove-Item", "-Recurse", "-Force"],
];

export function tokenizeCommand(command: string): string[] {
	// Lightweight tokenization (quoted strings kept as one token)
	const tokens: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(command))) {
		tokens.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
	}
	return tokens.filter(Boolean);
}

/** @deprecated use tokenizeCommand */
function tokenize(command: string): string[] {
	return tokenizeCommand(command);
}

export function prefixMatch(tokens: string[], prefix: string[]): boolean {
	if (prefix.length > tokens.length) return false;
	for (let i = 0; i < prefix.length; i += 1) {
		const p = prefix[i];
		const t = tokens[i];
		if (p.endsWith("=")) {
			if (!t.startsWith(p) && t !== p.slice(0, -1)) return false;
		} else if (t !== p && !t.toLowerCase().endsWith(`\\${p.toLowerCase()}`) && t.toLowerCase() !== p.toLowerCase()) {
			// allow path\rm.exe style
			const base = t.replace(/^.*[/\\]/, "").toLowerCase();
			if (base !== p.toLowerCase() && base !== `${p.toLowerCase()}.exe`) return false;
			if (i !== 0) return false;
		}
	}
	return true;
}

function heuristicDecision(command: string, tokens: string[]): ExecPolicyMatch | undefined {
	const lower = command.toLowerCase();
	if (/rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)/i.test(command) && /\/\s*$|\/\*|~|\$home|c:\\/i.test(command)) {
		return { decision: "forbidden", reason: "destructive recursive delete" };
	}
	if (/invoke-expression|iex\s*\(|downloadstring|frombase64string/i.test(lower)) {
		return { decision: "prompt", reason: "download/eval pattern" };
	}
	if (tokens[0]?.toLowerCase() === "curl" || tokens[0]?.toLowerCase() === "wget") {
		if (/\|.*(sh|bash|powershell|pwsh|cmd)/i.test(command)) {
			return { decision: "forbidden", reason: "pipe remote content to shell" };
		}
	}
	return undefined;
}

export function evaluateCommand(command: string, options: ExecPolicyOptions = {}): ExecPolicyMatch {
	const tokens = tokenize(command.trim());
	if (!tokens.length) return { decision: "allow", reason: "empty" };

	let decision: ExecDecision = "allow";
	let reason = "default allow";
	let matched_rule: string | undefined;

	const rules: PrefixRule[] = [
		...DEFAULT_FORBIDDEN_PREFIXES.map((prefix) => ({ prefix, decision: "forbidden" as const })),
		...DEFAULT_PROMPT_PREFIXES.map((prefix) => ({ prefix, decision: "prompt" as const })),
		...(options.extraRules || []),
	];

	for (const rule of rules) {
		if (prefixMatch(tokens, rule.prefix)) {
			decision = maxStrictness(decision, rule.decision);
			reason = rule.reason || `matched prefix ${rule.prefix.join(" ")}`;
			matched_rule = rule.prefix.join(" ");
			if (decision === "forbidden") break;
		}
	}

	const heur = heuristicDecision(command, tokens);
	if (heur) {
		decision = maxStrictness(decision, heur.decision);
		reason = heur.reason;
	}

	if (options.approvalNever && decision === "prompt") {
		decision = "forbidden";
		reason = `${reason} (approval_policy=never)`;
	}

	return { decision, reason, matched_rule };
}

export function createDefaultExecPolicy(options: ExecPolicyOptions = {}) {
	return {
		check(command: string): ExecPolicyMatch {
			return evaluateCommand(command, options);
		},
	};
}
