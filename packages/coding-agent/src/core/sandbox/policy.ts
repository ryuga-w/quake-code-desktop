/**
 * Sandbox policy layer (Codex sandboxing spirit) for command/file operations.
 * Not OS-level isolation — policy gates before exec.
 */

import { evaluateCommand, type ExecPolicyMatch, type ExecPolicyOptions } from "../execpolicy/policy.js";
import { isPathInsideRoot } from "../apply-patch/apply.js";
import { resolve, isAbsolute } from "node:path";

export type SandboxMode = "danger-full-access" | "workspace-write" | "read-only";

export interface SandboxConfig {
	mode: SandboxMode;
	workspaceRoot: string;
	execPolicy?: ExecPolicyOptions;
	/** Extra allowed write roots (absolute) */
	writableRoots?: string[];
}

export interface SandboxCheckResult {
	allowed: boolean;
	decision?: ExecPolicyMatch["decision"];
	reason: string;
}

export function createSandbox(config: SandboxConfig) {
	const roots = [
		resolve(config.workspaceRoot),
		...(config.writableRoots || []).map((r) => resolve(r)),
	];

	function pathWritable(path: string): boolean {
		if (config.mode === "danger-full-access") return true;
		if (config.mode === "read-only") return false;
		const abs = isAbsolute(path) ? resolve(path) : resolve(config.workspaceRoot, path);
		// Separator-aware + case-insensitive (blocks C:\projEVIL when root is C:\proj)
		return roots.some((root) => isPathInsideRoot(abs, root));
	}

	function checkCommand(command: string): SandboxCheckResult {
		// Codex Read Only: shell is not hard-forbidden — it requires approval (prompt).
		if (config.mode === "read-only") {
			return {
				allowed: false,
				decision: "prompt",
				reason: "read-only profile: shell/command requires approval",
			};
		}
		const match = evaluateCommand(command, config.execPolicy);
		if (match.decision === "forbidden") {
			return { allowed: false, decision: match.decision, reason: match.reason };
		}
		if (match.decision === "prompt") {
			// Without interactive guardian approval, treat prompt as blocked when SANDBOX_STRICT=1
			if (process.env.QUAKE_SANDBOX_STRICT === "1" || process.env.QUAKE_SANDBOX_STRICT === "true") {
				return { allowed: false, decision: match.decision, reason: `${match.reason} (strict sandbox)` };
			}
		}
		return { allowed: true, decision: match.decision, reason: match.reason };
	}

	function checkWritePath(path: string): SandboxCheckResult {
		if (pathWritable(path)) return { allowed: true, reason: "writable root" };
		return { allowed: false, decision: "forbidden", reason: `write outside sandbox: ${path}` };
	}

	return { checkCommand, checkWritePath, pathWritable, config };
}

export type Sandbox = ReturnType<typeof createSandbox>;

let activeSandbox: Sandbox | undefined;

export function setActiveSandbox(sandbox: Sandbox | undefined): void {
	activeSandbox = sandbox;
}

export function getActiveSandbox(): Sandbox | undefined {
	return activeSandbox;
}

export function ensureDefaultSandbox(workspaceRoot: string): Sandbox {
	const root = resolve(workspaceRoot);
	// Prefer guardian approval-preset sandbox mode so Full Access / Read Only are not overwritten.
	let mode: SandboxMode = (process.env.QUAKE_SANDBOX_MODE as SandboxMode) || "workspace-write";
	try {
		// Lazy import avoids circular init issues
		const { guardianRuntime } = require("../guardian/runtime.js") as typeof import("../guardian/runtime.js");
		const presetMode = guardianRuntime.getPreset()?.sandboxMode;
		if (presetMode) mode = presetMode;
	} catch {
		/* guardian optional at boot */
	}
	if (!activeSandbox || activeSandbox.config.workspaceRoot !== root || activeSandbox.config.mode !== mode) {
		activeSandbox = createSandbox({ mode, workspaceRoot: root });
	}
	return activeSandbox;
}
