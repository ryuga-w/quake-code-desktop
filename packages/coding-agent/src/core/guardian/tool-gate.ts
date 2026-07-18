/**
 * Shared tool gate: sandbox profile + execpolicy + Codex approval presets.
 * Used by bash / apply_patch / edit / write so no path is left unwired.
 */

import { evaluateCommand } from "../execpolicy/policy.js";
import { getActiveSandbox } from "../sandbox/index.js";
import { loadQuakeFeatures } from "../features/index.js";
import { extractNetworkTargets, sessionNetworkPolicy } from "../network-policy/index.js";
import { guardianRuntime, riskForTool } from "./runtime.js";

export interface ToolGateInput {
	tool: string;
	summary: string;
	cwd: string;
	command?: string;
	/** Extra path for write/edit checks */
	path?: string;
	/** Force needing user prompt */
	needsPrompt?: boolean;
	risk?: "low" | "medium" | "high";
	details?: Record<string, unknown>;
}

export interface ToolGateResult {
	allow: boolean;
	reason: string;
	decision: string;
	/** True when guardian denial circuit-breaker tripped (host should interrupt turn). */
	circuitTripped?: boolean;
	kind?: "exec" | "file_change" | "network" | "generic";
}

export async function gateToolExecution(input: ToolGateInput): Promise<ToolGateResult> {
	const features = loadQuakeFeatures();
	if (!features.sandbox && !features.execPolicy && !features.guardian) {
		return { allow: true, reason: "features off", decision: "auto" };
	}

	guardianRuntime.setWorkspaceRoot(input.cwd);
	const sandbox = getActiveSandbox();
	const preset = guardianRuntime.getPreset();

	// Path write check (edit/write/apply_patch): non–full-access hard-denies path escape
	if (input.path && sandbox) {
		const writeCheck = sandbox.checkWritePath(input.path);
		if (!writeCheck.allowed) {
			if (preset.id === "full-access") {
				// Full Access may write outside workspace
			} else {
				// Codex workspace-write / read-only: path escape is forbidden (not a soft prompt)
				return {
					allow: false,
					reason: writeCheck.reason,
					decision: "forbidden",
				};
			}
		}
	}

	// Shell / command checks
	let policyDecision: "allow" | "prompt" | "forbidden" = "allow";
	let policyReason = "ok";
	if (input.command) {
		const policy = evaluateCommand(input.command);
		policyDecision = policy.decision;
		policyReason = policy.reason;
		if (sandbox) {
			const sc = sandbox.checkCommand(input.command);
			if (sc.decision === "forbidden" || (sc.decision === "prompt" && policyDecision === "allow")) {
				policyDecision = sc.decision === "forbidden" ? "forbidden" : "prompt";
				policyReason = sc.reason;
			}
			if (!sc.allowed && sc.decision === "prompt") {
				policyDecision = "prompt";
				policyReason = sc.reason;
			}
		}
	}

	if (policyDecision === "forbidden") {
		// Extreme commands never get a UI override (Codex-style hard deny)
		// Session prefix allow must NOT override forbidden.
		return { allow: false, reason: policyReason, decision: "forbidden" };
	}

	// Network host policy before any early auto-allow (full-access / auto / session prefix).
	// Deny is hard; ask forces requestApproval (amendment UI lives there — do not skip).
	let networkNeedsApproval = false;
	if (input.command) {
		const netTargets = extractNetworkTargets(input.command);
		if (netTargets.length) {
			const hosts = netTargets.map((t) => t.host);
			const hostDecision = sessionNetworkPolicy.evaluateHosts(hosts);
			if (hostDecision === "deny") {
				return {
					allow: false,
					reason: `network policy denied host: ${hosts.join(", ")}`,
					decision: "forbidden",
					kind: "network",
				};
			}
			if (hostDecision === "ask") {
				networkNeedsApproval = true;
			}
		}
	}

	// Session execpolicy prefix allow (after forbidden + network deny) — skip UI for matching prompt rules
	if (
		input.command &&
		policyDecision === "prompt" &&
		!networkNeedsApproval &&
		guardianRuntime.matchesSessionPrefixAllow(input.command)
	) {
		return {
			allow: true,
			reason: "approved for session (execpolicy prefix)",
			decision: "auto",
			kind: "exec",
		};
	}

	const needsPrompt =
		Boolean(input.needsPrompt) ||
		policyDecision === "prompt" ||
		preset.id === "read-only" ||
		networkNeedsApproval;

	// Full Access: auto-allow (except hard forbidden / network deny above).
	// Unknown network hosts still go through requestApproval (which auto-allows under full-access
	// when the store is empty after clear — deny list remains authoritative when present).
	if (preset.id === "full-access" && !networkNeedsApproval) {
		return { allow: true, reason: "full-access", decision: "auto" };
	}

	// Default workspace: normal bash/edit/write without policy flag → allow
	// (skipped when network host policy needs a prompt)
	if (!needsPrompt && preset.id === "auto" && policyDecision === "allow") {
		const risk = input.risk || riskForTool(input.tool, { decision: policyDecision });
		if (risk !== "high") {
			return { allow: true, reason: "default workspace allow", decision: "auto" };
		}
	}

	const kind =
		input.details?.kind === "file_change"
			? "file_change"
			: input.command
				? "exec"
				: input.path
					? "file_change"
					: "generic";

	const gate = await guardianRuntime.requestApproval({
		tool: input.tool,
		summary: input.summary,
		command: input.command,
		reason: policyReason,
		risk: input.risk || riskForTool(input.tool, { decision: policyDecision }),
		needsPrompt: needsPrompt || policyDecision === "prompt",
		details: { ...input.details, kind },
	});

	return {
		allow: gate.allow,
		reason: gate.reason,
		decision: gate.circuitTripped ? "circuit_interrupt" : String(gate.decision),
		circuitTripped: Boolean(gate.circuitTripped),
		kind: gate.kind || (kind as ToolGateResult["kind"]),
	};
}
