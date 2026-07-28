/**
 * Codex-aligned approval types
 * (protocol AskForApproval + ReviewDecision / CommandExecutionApprovalDecision
 *  + approval-presets + network / execpolicy amendments).
 */

/** Codex AskForApproval */
export type AskForApproval =
	| "untrusted" // UnlessTrusted — only known-safe read commands auto-approved
	| "on-request" // model/policy decides when to ask
	| "never"; // never prompt; deny or auto-run depending on sandbox

/** Codex CommandExecutionApprovalDecision (UI-facing) */
export type ApprovalDecision =
	| "accept" // Approve once
	| "acceptForSession" // Approve exact key for session
	| "acceptAlways" // Approve exact key durable (survives restart)
	| "acceptWithExecpolicyAmendment" // Allow argv prefix for session (or always via scope)
	| "applyNetworkPolicyAmendment" // Allow/deny host for session (or always via scope)
	| "decline" // Deny, continue turn
	| "cancel"; // Deny + stop

/** Codex NetworkApprovalProtocol */
export type NetworkApprovalProtocol = "http" | "https" | "socks5_tcp" | "socks5_udp";

/** Codex NetworkApprovalContext */
export interface NetworkApprovalContext {
	host: string;
	protocol: NetworkApprovalProtocol;
}

/** Codex NetworkPolicyAmendment */
export interface NetworkPolicyAmendment {
	host: string;
	action: "allow" | "deny";
	protocol?: NetworkApprovalProtocol;
}

/** Codex ExecPolicyAmendment — argv prefix to allow without re-prompt */
export interface ExecPolicyAmendment {
	command: string[];
}

/** Sandbox / permission profile (Codex PermissionProfile built-ins) */
export type PermissionProfileId = "read-only" | "workspace" | "danger-full-access";

export interface ApprovalPreset {
	id: string;
	label: string;
	description: string;
	approval: AskForApproval;
	permissionProfile: PermissionProfileId;
	/** Maps to sandbox mode */
	sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
}

/** Built-in Codex approval-presets */
export function builtinApprovalPresets(): ApprovalPreset[] {
	return [
		{
			id: "read-only",
			label: "Read Only",
			description:
				"Quake can read files in the current workspace. Approval is required to edit files or access the internet.",
			approval: "on-request",
			permissionProfile: "read-only",
			sandboxMode: "read-only",
		},
		{
			id: "auto",
			label: "Default",
			description:
				"Quake can read and edit files in the current workspace, and run commands. Approval is required for risky commands or access outside the workspace.",
			approval: "on-request",
			permissionProfile: "workspace",
			sandboxMode: "workspace-write",
		},
		{
			id: "full-access",
			label: "Full Access",
			description:
				"Quake can edit files outside this workspace and run commands without asking for approval. Exercise caution when using.",
			approval: "never",
			permissionProfile: "danger-full-access",
			sandboxMode: "danger-full-access",
		},
	];
}

/** Distinguishes shell/exec vs file-change vs network vs generic tool prompts. */
export type ApprovalKind = "exec" | "file_change" | "network" | "generic";

export interface ApprovalRequest {
	id: string;
	tool: string;
	summary: string;
	command?: string;
	reason?: string;
	risk: "low" | "medium" | "high";
	/** exec = shell/command; file_change = apply_patch/edit/write; network = host; generic = other */
	kind: ApprovalKind;
	createdAt: number;
	/** Codex-style available decisions for this prompt */
	availableDecisions: ApprovalDecision[];
	details?: Record<string, unknown>;
	/** Proposed argv prefix for acceptWithExecpolicyAmendment */
	proposedExecpolicyAmendment?: ExecPolicyAmendment;
	/** Primary network target when host gate triggers */
	networkApprovalContext?: NetworkApprovalContext;
	/** Proposed allow/deny host rules (Codex dual buttons) */
	proposedNetworkPolicyAmendments?: NetworkPolicyAmendment[];
}

export interface ApprovalResponse {
	id: string;
	decision: ApprovalDecision;
	/** When decision is acceptWithExecpolicyAmendment */
	execpolicyAmendment?: ExecPolicyAmendment;
	/** When decision is applyNetworkPolicyAmendment */
	networkPolicyAmendment?: NetworkPolicyAmendment;
	/**
	 * Scope for prefix / network amendments.
	 * - session (default): memory only, cleared by clearSessionApprovals
	 * - always: durable write-through (guardian-always.json); session clear does not wipe
	 */
	scope?: "session" | "always";
}

/** Durable decision trail entry for audit / tests */
export interface ApprovalTrailEntry {
	id: string;
	tool: string;
	kind: ApprovalKind;
	summary: string;
	decision: ApprovalDecision | "auto";
	allow: boolean;
	reason: string;
	at: number;
	turnId?: string;
}

export function inferApprovalKind(tool: string, details?: Record<string, unknown>): ApprovalKind {
	if (
		details?.kind === "file_change" ||
		details?.kind === "exec" ||
		details?.kind === "generic" ||
		details?.kind === "network"
	) {
		return details.kind as ApprovalKind;
	}
	const t = String(tool || "").toLowerCase();
	if (t === "apply_patch" || t === "edit" || t === "write") return "file_change";
	if (t === "bash" || t === "run_command" || t.includes("shell") || t.includes("exec")) return "exec";
	return "generic";
}

export type GuardianDecisionLegacy = "allow" | "deny";

export function approvalDecisionToAllow(
	decision: ApprovalDecision,
	opts?: { networkAction?: "allow" | "deny" },
): boolean {
	if (
		decision === "accept" ||
		decision === "acceptForSession" ||
		decision === "acceptAlways" ||
		decision === "acceptWithExecpolicyAmendment"
	) {
		return true;
	}
	if (decision === "applyNetworkPolicyAmendment") {
		return (opts?.networkAction || "allow") === "allow";
	}
	return false;
}

/** Propose a stable argv prefix for "don't ask for commands starting with X". */
export function proposeExecPrefix(command: string | undefined, maxTokens = 4): string[] | undefined {
	if (!command?.trim()) return undefined;
	const tokens: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(command.trim()))) {
		tokens.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
		if (tokens.length >= maxTokens) break;
	}
	const filtered = tokens.filter(Boolean);
	if (!filtered.length) return undefined;
	// Avoid ultra-broad single token allows for common shells
	const broad = new Set(["cmd", "cmd.exe", "powershell", "pwsh", "bash", "sh", "zsh", "node", "python", "python3"]);
	if (filtered.length === 1 && broad.has(filtered[0].toLowerCase().replace(/^.*[/\\]/, ""))) {
		return undefined;
	}
	return filtered;
}
