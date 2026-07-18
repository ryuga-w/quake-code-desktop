/**
 * Codex guardian / approval runtime:
 * - active approval preset (Read Only / Default / Full Access)
 * - session approval cache (Accept for session)
 * - durable always-allows (S-TRUST.1 — survives restart; session clear does NOT wipe)
 * - pending UI requests with Accept / Accept for session / Always / Decline / Cancel
 */

import { createSandbox, setActiveSandbox, type Sandbox } from "../sandbox/index.js";
import {
	type ApprovalDecision,
	type ApprovalKind,
	type ApprovalPreset,
	type ApprovalRequest,
	type ApprovalResponse,
	type ApprovalTrailEntry,
	type AskForApproval,
	type ExecPolicyAmendment,
	type NetworkPolicyAmendment,
	approvalDecisionToAllow,
	builtinApprovalPresets,
	inferApprovalKind,
	proposeExecPrefix,
} from "./types.js";
import {
	isGuardianAlwaysCommandKey,
	listDurableGuardianAllows,
	matchesGuardianAlwaysPrefix,
	rememberGuardianAlwaysCommandKey,
	rememberGuardianAlwaysHost,
	rememberGuardianAlwaysPrefix,
	type GuardianDurableSnapshot,
} from "./durable-allows.js";
import { tokenizeCommand, prefixMatch } from "../execpolicy/policy.js";
import { sessionNetworkPolicy } from "../network-policy/index.js";
import { extractNetworkTargets } from "../network-policy/extract.js";

export type ApprovalUiHandler = (request: ApprovalRequest) => Promise<ApprovalDecision>;

export interface GuardianRuntimeState {
	presetId: string;
	approvalPolicy: AskForApproval;
	permissionProfile: string;
	sandboxMode: string;
	sessionApprovals: number;
	pending: number;
	/** Consecutive declines in the current turn (circuit-breaker) */
	consecutiveDenials: number;
	trailSize: number;
}

/** After this many consecutive declines in one turn → interrupt (Codex guardian spirit). */
export const DEFAULT_DENIAL_CIRCUIT_BREAKER = 3;

class GuardianRuntime {
	private preset: ApprovalPreset;
	private sessionCache = new Set<string>();
	/** Codex AcceptWithExecpolicyAmendment — session argv prefixes that skip prompt (never override forbidden). */
	private sessionPrefixAllows: string[][] = [];
	private pending = new Map<
		string,
		{
			request: ApprovalRequest;
			resolve: (d: ApprovalDecision) => void;
		}
	>();
	private uiHandler?: ApprovalUiHandler;
	private workspaceRoot = process.cwd();
	private requestSeq = 0;
	private consecutiveDenials = 0;
	private trail: ApprovalTrailEntry[] = [];
	private turnId?: string;
	private circuitLimit = DEFAULT_DENIAL_CIRCUIT_BREAKER;
	/** When circuit trips, next approval auto-declines with interrupt reason */
	private circuitTripped = false;

	constructor() {
		this.preset = builtinApprovalPresets().find((p) => p.id === "auto")!;
	}

	setWorkspaceRoot(root: string): void {
		this.workspaceRoot = root;
		this.applySandboxFromPreset();
	}

	getPreset(): ApprovalPreset {
		return this.preset;
	}

	listPresets(): ApprovalPreset[] {
		return builtinApprovalPresets();
	}

	setPreset(id: string): ApprovalPreset {
		const found = builtinApprovalPresets().find((p) => p.id === id);
		if (!found) throw new Error(`Unknown approval preset: ${id}`);
		this.preset = found;
		this.applySandboxFromPreset();
		// Full Access clears friction; session cache still useful but not required
		if (found.id === "full-access") {
			this.sessionCache.clear();
			this.sessionPrefixAllows = [];
			sessionNetworkPolicy.clear();
		}
		return found;
	}

	/** Map legacy terminal policy modes */
	setFromTerminalPolicy(mode: "safe" | "allow-all" | "disabled"): ApprovalPreset {
		if (mode === "allow-all") return this.setPreset("full-access");
		if (mode === "disabled") return this.setPreset("read-only");
		return this.setPreset("auto");
	}

	setUiHandler(handler: ApprovalUiHandler | undefined): void {
		this.uiHandler = handler;
	}

	getState(): GuardianRuntimeState {
		return {
			presetId: this.preset.id,
			approvalPolicy: this.preset.approval,
			permissionProfile: this.preset.permissionProfile,
			sandboxMode: this.preset.sandboxMode,
			sessionApprovals: this.sessionCache.size,
			pending: this.pending.size,
			consecutiveDenials: this.consecutiveDenials,
			trailSize: this.trail.length,
		};
	}

	listPending(): ApprovalRequest[] {
		return [...this.pending.values()].map((p) => p.request);
	}

	/** Cache key for session-scoped auto-approve (also durable commandKeys format). */
	cacheKey(tool: string, summary: string): string {
		return `${tool}::${summary.trim().slice(0, 500)}`;
	}

	rememberSessionApproval(tool: string, summary: string): void {
		this.sessionCache.add(this.cacheKey(tool, summary));
	}

	/**
	 * Durable exact tool::summary key (write-through to guardian-always.json when loaded).
	 * Survives restart; not cleared by clearSessionApprovals().
	 */
	rememberAlwaysApproval(tool: string, summary: string): void {
		const key = this.cacheKey(tool, summary);
		this.sessionCache.add(key); // also session so current process hits without re-check path edge cases
		rememberGuardianAlwaysCommandKey(key);
	}

	isSessionApproved(tool: string, summary: string): boolean {
		const key = this.cacheKey(tool, summary);
		return this.sessionCache.has(key) || isGuardianAlwaysCommandKey(key);
	}

	/**
	 * Clear session-scoped approvals only.
	 * Durable guardian always-allows (commandKeys / prefixes / hosts) are NOT wiped.
	 */
	clearSessionApprovals(): void {
		this.sessionCache.clear();
		this.sessionPrefixAllows = [];
		// Session network only — durable hosts stay via durable-allows store
		sessionNetworkPolicy.clear();
	}

	rememberSessionPrefixAllow(prefix: string[]): void {
		const cleaned = prefix.map((p) => String(p || "").trim()).filter(Boolean);
		if (!cleaned.length) return;
		// de-dupe
		const key = cleaned.join("\0");
		if (this.sessionPrefixAllows.some((p) => p.join("\0") === key)) return;
		this.sessionPrefixAllows.push(cleaned);
	}

	/** Durable argv prefix allow (write-through). Not cleared by clearSessionApprovals(). */
	rememberAlwaysPrefixAllow(prefix: string[]): void {
		const cleaned = prefix.map((p) => String(p || "").trim()).filter(Boolean);
		if (!cleaned.length) return;
		this.rememberSessionPrefixAllow(cleaned);
		rememberGuardianAlwaysPrefix(cleaned);
	}

	matchesSessionPrefixAllow(command: string | undefined): boolean {
		if (!command?.trim()) return false;
		const tokens = tokenizeCommand(command.trim());
		if (this.sessionPrefixAllows.some((prefix) => prefixMatch(tokens, prefix))) return true;
		return matchesGuardianAlwaysPrefix(tokens);
	}

	listSessionPrefixAllows(): string[][] {
		return this.sessionPrefixAllows.map((p) => [...p]);
	}

	/** Snapshot of durable always-allows (Settings / API). */
	listDurableAllows(): GuardianDurableSnapshot {
		return listDurableGuardianAllows();
	}

	/**
	 * Apply network host allow/deny.
	 * @param scope session (default) or always (durable hosts in guardian-always.json)
	 */
	applyNetworkAmendment(
		amendment: NetworkPolicyAmendment,
		scope: "session" | "always" = "session",
	): void {
		if (scope === "always") {
			rememberGuardianAlwaysHost(amendment.host, amendment.action);
			// Mirror into session for immediate process consistency
			if (amendment.action === "deny") sessionNetworkPolicy.denyHost(amendment.host);
			else sessionNetworkPolicy.allowHost(amendment.host);
			return;
		}
		if (amendment.action === "deny") sessionNetworkPolicy.denyHost(amendment.host);
		else sessionNetworkPolicy.allowHost(amendment.host);
	}

	/** Bind consecutive-denial counter to a turn (reset when turn changes). */
	beginTurn(turnId: string): void {
		if (this.turnId !== turnId) {
			this.turnId = turnId;
			this.consecutiveDenials = 0;
			this.circuitTripped = false;
		}
	}

	endTurn(): void {
		this.consecutiveDenials = 0;
		this.circuitTripped = false;
	}

	getConsecutiveDenials(): number {
		return this.consecutiveDenials;
	}

	isCircuitTripped(): boolean {
		return this.circuitTripped;
	}

	getDecisionTrail(): ApprovalTrailEntry[] {
		return [...this.trail];
	}

	clearDecisionTrail(): void {
		this.trail = [];
	}

	setCircuitBreakerLimit(n: number): void {
		this.circuitLimit = Math.max(1, n);
	}

	private recordTrail(entry: Omit<ApprovalTrailEntry, "at" | "turnId">): void {
		this.trail.push({
			...entry,
			at: Date.now(),
			turnId: this.turnId,
		});
		// Bound memory
		if (this.trail.length > 200) this.trail.splice(0, this.trail.length - 200);
	}

	/**
	 * Core gate used by tools.
	 * Returns allow=true when execution may proceed.
	 * On circuit-breaker trip: allow=false, reason includes interrupt.
	 */
	async requestApproval(input: {
		tool: string;
		summary: string;
		command?: string;
		reason?: string;
		risk?: "low" | "medium" | "high";
		details?: Record<string, unknown>;
		/** If policy already said forbidden */
		forcedDeny?: boolean;
		/** execpolicy said prompt */
		needsPrompt?: boolean;
	}): Promise<{
		allow: boolean;
		decision: ApprovalDecision | "auto";
		reason: string;
		kind: ApprovalKind;
		circuitTripped?: boolean;
	}> {
		const kind = inferApprovalKind(input.tool, input.details);

		if (this.circuitTripped) {
			const result = {
				allow: false as const,
				decision: "cancel" as const,
				reason: "guardian circuit-breaker: turn interrupted after repeated denials",
				kind,
				circuitTripped: true,
			};
			this.recordTrail({
				id: `auto_${++this.requestSeq}`,
				tool: input.tool,
				kind,
				summary: input.summary,
				decision: "cancel",
				allow: false,
				reason: result.reason,
			});
			return result;
		}

		if (input.forcedDeny) {
			const result = {
				allow: false as const,
				decision: "decline" as const,
				reason: input.reason || "forbidden",
				kind,
			};
			this.noteDenial(true);
			this.recordTrail({
				id: `deny_${++this.requestSeq}`,
				tool: input.tool,
				kind,
				summary: input.summary,
				decision: "decline",
				allow: false,
				reason: result.reason,
			});
			return { ...result, circuitTripped: this.circuitTripped };
		}

		// Full Access / never: auto-allow (Codex Never + danger full access)
		if (this.preset.approval === "never" && this.preset.id === "full-access") {
			this.consecutiveDenials = 0;
			const result = { allow: true as const, decision: "auto" as const, reason: "full-access preset", kind };
			this.recordTrail({
				id: `auto_${++this.requestSeq}`,
				tool: input.tool,
				kind,
				summary: input.summary,
				decision: "auto",
				allow: true,
				reason: result.reason,
			});
			return result;
		}

		// Read-only: block shell/write without even prompting? Codex still prompts for edits.
		// We prompt for high risk; auto-deny pure shell when no UI and untrusted-like.

		const risk = input.risk || "medium";
		const policyWantsPrompt = Boolean(input.needsPrompt);

		// Session / durable prefix allow (AcceptWithExecpolicyAmendment) — before exact cache
		if (input.command && this.matchesSessionPrefixAllow(input.command)) {
			this.consecutiveDenials = 0;
			const result = {
				allow: true as const,
				decision: "auto" as const,
				reason: "approved (execpolicy prefix — session or durable)",
				kind,
			};
			this.recordTrail({
				id: `auto_${++this.requestSeq}`,
				tool: input.tool,
				kind,
				summary: input.summary,
				decision: "auto",
				allow: true,
				reason: result.reason,
			});
			return result;
		}

		// Session host allow (network policy)
		const netTargets = input.command ? extractNetworkTargets(input.command) : [];
		if (netTargets.length) {
			const hosts = netTargets.map((t) => t.host);
			const hostDecision = sessionNetworkPolicy.evaluateHosts(hosts);
			if (hostDecision === "deny") {
				this.noteDenial(true);
				const result = {
					allow: false as const,
					decision: "decline" as const,
					reason: `network policy denied host: ${hosts.join(", ")}`,
					kind: "network" as ApprovalKind,
					circuitTripped: this.circuitTripped,
				};
				this.recordTrail({
					id: `deny_${++this.requestSeq}`,
					tool: input.tool,
					kind: "network",
					summary: input.summary,
					decision: "decline",
					allow: false,
					reason: result.reason,
				});
				return result;
			}
			if (hostDecision === "allow" && !policyWantsPrompt && risk !== "high") {
				// Host already allowed — still respect high-risk / forced prompt
			} else if (hostDecision === "allow" && policyWantsPrompt) {
				// e.g. curl still in prompt prefixes — host allow skips network ask only;
				// if the only reason for prompt is curl/wget, allow through when host allowed.
				const onlyNetworkPrompt =
					/curl|wget|invoke-webrequest|iwr|network/i.test(input.reason || "") ||
					netTargets.length > 0;
				if (onlyNetworkPrompt) {
					this.consecutiveDenials = 0;
					const result = {
						allow: true as const,
						decision: "auto" as const,
						reason: "network host approved (session or durable)",
						kind: "network" as ApprovalKind,
					};
					this.recordTrail({
						id: `auto_${++this.requestSeq}`,
						tool: input.tool,
						kind: "network",
						summary: input.summary,
						decision: "auto",
						allow: true,
						reason: result.reason,
					});
					return result;
				}
			}
		}

		// Session / durable cache (Accept for session / Always) — exact tool+summary
		if (this.isSessionApproved(input.tool, input.summary)) {
			this.consecutiveDenials = 0;
			const result = {
				allow: true as const,
				decision: "auto" as const,
				reason: isGuardianAlwaysCommandKey(this.cacheKey(input.tool, input.summary))
					? "approved always (durable)"
					: "approved for session",
				kind,
			};
			this.recordTrail({
				id: `auto_${++this.requestSeq}`,
				tool: input.tool,
				kind,
				summary: input.summary,
				decision: "auto",
				allow: true,
				reason: result.reason,
			});
			return result;
		}

		// Never (but not full-access): auto-deny prompts without showing UI (strict)
		if (this.preset.approval === "never" && this.preset.id !== "full-access") {
			this.noteDenial(true);
			const result = {
				allow: false as const,
				decision: "decline" as const,
				reason: "approval_policy=never",
				kind,
				circuitTripped: this.circuitTripped,
			};
			this.recordTrail({
				id: `deny_${++this.requestSeq}`,
				tool: input.tool,
				kind,
				summary: input.summary,
				decision: "decline",
				allow: false,
				reason: result.reason,
			});
			return result;
		}

		// Network host ask: attach context (Codex dual fields; kind stays exec for shell)
		const promptKind = kind;
		const primaryNet = netTargets[0];
		const forceNetworkPrompt =
			netTargets.length > 0 && sessionNetworkPolicy.evaluateHosts(netTargets.map((t) => t.host)) === "ask";
		const networkApprovalContext = forceNetworkPrompt && primaryNet
			? { host: primaryNet.host, protocol: primaryNet.protocol }
			: undefined;
		const proposedNetworkPolicyAmendments: NetworkPolicyAmendment[] | undefined = networkApprovalContext
			? [
					{ host: networkApprovalContext.host, action: "allow", protocol: networkApprovalContext.protocol },
					{ host: networkApprovalContext.host, action: "deny", protocol: networkApprovalContext.protocol },
				]
			: undefined;
		const proposedExecpolicyAmendment: ExecPolicyAmendment | undefined =
			kind === "exec" || input.command
				? (() => {
						const prefix = proposeExecPrefix(input.command);
						return prefix?.length ? { command: prefix } : undefined;
					})()
				: undefined;

		// Untrusted / low-risk auto allow when policy did not flag (never skip unknown network hosts)
		if (!policyWantsPrompt && risk === "low" && !forceNetworkPrompt) {
			this.consecutiveDenials = 0;
			return { allow: true, decision: "auto", reason: "low risk auto", kind };
		}

		// Default (workspace): medium risk without execpolicy prompt → allow
		if (!policyWantsPrompt && this.preset.id === "auto" && risk === "medium" && !forceNetworkPrompt) {
			this.consecutiveDenials = 0;
			return { allow: true, decision: "auto", reason: "default workspace allow", kind };
		}

		// Read Only or high risk or policy prompt → ask user
		const decision = await this.promptUser({
			tool: input.tool,
			summary: input.summary,
			command: input.command,
			reason: input.reason || (forceNetworkPrompt ? `network access: ${primaryNet?.host}` : undefined),
			risk: forceNetworkPrompt && risk === "low" ? "medium" : risk,
			details: {
				...input.details,
				kind: promptKind,
				networkApprovalContext,
				proposedNetworkPolicyAmendments,
				proposedExecpolicyAmendment,
			},
			kind: forceNetworkPrompt ? "exec" : promptKind,
			proposedExecpolicyAmendment,
			networkApprovalContext,
			proposedNetworkPolicyAmendments,
		});

		if (decision === "acceptForSession") {
			this.rememberSessionApproval(input.tool, input.summary);
			// When network context present, also allow host for session (Codex convenience)
			if (networkApprovalContext) {
				sessionNetworkPolicy.allowHost(networkApprovalContext.host);
			}
		}
		if (decision === "acceptAlways") {
			this.rememberAlwaysApproval(input.tool, input.summary);
			// Durable host allow when network context present
			if (networkApprovalContext) {
				this.applyNetworkAmendment(
					{ host: networkApprovalContext.host, action: "allow", protocol: networkApprovalContext.protocol },
					"always",
				);
			}
		}

		const allow = approvalDecisionToAllow(decision);
		if (allow) this.consecutiveDenials = 0;
		else this.noteDenial(decision === "decline" || decision === "cancel");

		const result = {
			allow,
			decision,
			reason: input.reason || decision,
			kind: forceNetworkPrompt ? ("exec" as ApprovalKind) : kind,
			circuitTripped: this.circuitTripped,
		};
		this.recordTrail({
			id: `ui_${++this.requestSeq}`,
			tool: input.tool,
			kind: result.kind,
			summary: input.summary,
			decision,
			allow,
			reason: result.reason,
		});
		return result;
	}

	private noteDenial(counts: boolean): void {
		if (!counts) return;
		this.consecutiveDenials += 1;
		if (this.consecutiveDenials >= this.circuitLimit) {
			this.circuitTripped = true;
			// Codex: repeated denials interrupt the turn
			try {
				fireGuardianInterruptHook(
					"guardian circuit-breaker: turn interrupted after repeated denials",
				);
			} catch {
				/* non-fatal */
			}
		}
	}

	/** Resolve a pending request from desktop / TUI; applies amendments then resolves decision. */
	respond(response: ApprovalResponse): boolean {
		const entry = this.pending.get(response.id);
		if (!entry) return false;
		this.pending.delete(response.id);

		let decision = response.decision;
		const scope = response.scope === "always" ? "always" : "session";

		if (decision === "acceptAlways") {
			this.rememberAlwaysApproval(entry.request.tool, entry.request.summary);
			const netHost = entry.request.networkApprovalContext?.host;
			if (netHost) {
				this.applyNetworkAmendment(
					{
						host: netHost,
						action: "allow",
						protocol: entry.request.networkApprovalContext?.protocol,
					},
					"always",
				);
			}
		}

		if (decision === "acceptWithExecpolicyAmendment") {
			const prefix =
				response.execpolicyAmendment?.command ||
				entry.request.proposedExecpolicyAmendment?.command;
			if (prefix?.length) {
				if (scope === "always") this.rememberAlwaysPrefixAllow(prefix);
				else this.rememberSessionPrefixAllow(prefix);
			}
			// Treat as allow for this run
			decision = "acceptWithExecpolicyAmendment";
		}
		if (decision === "applyNetworkPolicyAmendment") {
			const amd =
				response.networkPolicyAmendment ||
				entry.request.proposedNetworkPolicyAmendments?.find((a) => a.action === "allow") ||
				entry.request.proposedNetworkPolicyAmendments?.[0];
			if (amd) {
				this.applyNetworkAmendment(amd, scope);
				if (amd.action === "deny") {
					// Map deny host to decline for this execution
					entry.resolve("decline");
					return true;
				}
			}
		}

		entry.resolve(decision);
		return true;
	}

	private async promptUser(input: {
		tool: string;
		summary: string;
		command?: string;
		reason?: string;
		risk: "low" | "medium" | "high";
		details?: Record<string, unknown>;
		kind: ApprovalKind;
		proposedExecpolicyAmendment?: ExecPolicyAmendment;
		networkApprovalContext?: ApprovalRequest["networkApprovalContext"];
		proposedNetworkPolicyAmendments?: NetworkPolicyAmendment[];
	}): Promise<ApprovalDecision> {
		const id = `apr_${Date.now()}_${++this.requestSeq}`;
		const availableDecisions: ApprovalDecision[] = [
			"accept",
			"acceptForSession",
			"acceptAlways",
			"decline",
			"cancel",
		];
		if (input.proposedExecpolicyAmendment?.command?.length) {
			availableDecisions.splice(3, 0, "acceptWithExecpolicyAmendment");
		}
		if (input.networkApprovalContext) {
			availableDecisions.splice(3, 0, "applyNetworkPolicyAmendment");
		}
		// de-dupe while preserving order
		const seen = new Set<ApprovalDecision>();
		const decisions = availableDecisions.filter((d) => (seen.has(d) ? false : (seen.add(d), true)));

		const request: ApprovalRequest = {
			id,
			tool: input.tool,
			summary: input.summary,
			command: input.command,
			reason: input.reason,
			risk: input.risk,
			kind: input.kind,
			createdAt: Date.now(),
			availableDecisions: decisions,
			details: { ...input.details, kind: input.kind },
			proposedExecpolicyAmendment: input.proposedExecpolicyAmendment,
			networkApprovalContext: input.networkApprovalContext,
			proposedNetworkPolicyAmendments: input.proposedNetworkPolicyAmendments,
		};

		if (this.uiHandler) {
			return this.uiHandler(request);
		}

		// Wait for external respond() — with timeout → decline
		return new Promise<ApprovalDecision>((resolve) => {
			const timeoutMs = Number(process.env.QUAKE_APPROVAL_TIMEOUT_MS || 120_000);
			const timer = setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					resolve("decline");
				}
			}, timeoutMs);

			this.pending.set(id, {
				request,
				resolve: (d) => {
					clearTimeout(timer);
					resolve(d);
				},
			});

			// Notify optional global listener (desktop binds this)
			try {
				globalApprovalEmitter?.emit(request);
			} catch {
				/* ignore */
			}
		});
	}

	private applySandboxFromPreset(): void {
		const sandbox: Sandbox = createSandbox({
			mode: this.preset.sandboxMode,
			workspaceRoot: this.workspaceRoot,
			execPolicy: {
				// Full access still runs execpolicy for extreme rm -rf / but never blocks on "prompt"
				approvalNever: this.preset.id === "full-access" ? false : this.preset.approval === "never",
			},
		});
		setActiveSandbox(sandbox);
	}
}

export const guardianRuntime = new GuardianRuntime();

/** Optional hook: circuit-breaker trips → host aborts the active turn (Codex interrupt). */
export type GuardianInterruptHook = (reason: string) => void;
let guardianInterruptHook: GuardianInterruptHook | undefined;

export function setGuardianInterruptHook(hook: GuardianInterruptHook | undefined): void {
	guardianInterruptHook = hook;
}

export function fireGuardianInterruptHook(reason: string): void {
	guardianInterruptHook?.(reason);
}

type Emitter = { emit: (req: ApprovalRequest) => void };
let globalApprovalEmitter: Emitter | undefined;

export function setGlobalApprovalEmitter(emitter: Emitter | undefined): void {
	globalApprovalEmitter = emitter;
}

// ── Legacy API compat ──────────────────────────────────────────────────────

export type GuardianDecision = "allow" | "deny";
export type GuardianApprover = (req: {
	tool: string;
	summary: string;
	details?: Record<string, unknown>;
	risk: "low" | "medium" | "high";
}) => Promise<GuardianDecision> | GuardianDecision;

export interface GuardianConfig {
	strict?: boolean;
	approver?: GuardianApprover;
	alwaysPromptTools?: string[];
}

/** @deprecated prefer guardianRuntime + presets */
export function configureGuardian(next: GuardianConfig): void {
	if (next.approver) {
		guardianRuntime.setUiHandler(async (req) => {
			const d = await next.approver!({
				tool: req.tool,
				summary: req.summary,
				details: req.details,
				risk: req.risk,
			});
			return d === "allow" ? "accept" : "decline";
		});
	}
	if (next.strict) {
		// strict without UI ≈ deny prompts when no handler — use untrusted
		if (!next.approver) guardianRuntime.setPreset("read-only");
	}
}

export function getGuardianConfig(): GuardianConfig {
	const s = guardianRuntime.getState();
	return { strict: s.presetId === "read-only" };
}

export async function requestGuardianApproval(req: {
	tool: string;
	summary: string;
	details?: Record<string, unknown>;
	risk: "low" | "medium" | "high";
}): Promise<GuardianDecision> {
	const result = await guardianRuntime.requestApproval({
		tool: req.tool,
		summary: req.summary,
		risk: req.risk,
		details: req.details,
		needsPrompt: req.risk !== "low",
		command: typeof req.details?.command === "string" ? req.details.command : undefined,
		reason: typeof req.details?.reason === "string" ? req.details.reason : undefined,
	});
	return result.allow ? "allow" : "deny";
}

export function riskForTool(tool: string, hint?: { decision?: string }): "low" | "medium" | "high" {
	if (hint?.decision === "forbidden") return "high";
	if (hint?.decision === "prompt") return "high";
	if (tool === "bash" || tool === "apply_patch" || tool === "os_control_action" || tool === "os_perform_step") {
		return "medium";
	}
	if (tool === "write" || tool === "edit") return "medium";
	return "low";
}
