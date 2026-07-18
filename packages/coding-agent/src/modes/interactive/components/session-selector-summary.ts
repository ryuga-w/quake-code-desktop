import type { SessionInfo } from "../../../core/session-manager.js";
import { theme } from "../theme/theme.js";

function trimInline(text: string | undefined): string {
	return (text ?? "")
		.replace(/[\r\n\t]+/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function excerpt(text: string | undefined, max = 88): string {
	const value = trimInline(text);
	if (!value) return "";
	return value.length > max ? `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…` : value;
}

function formatModel(session: SessionInfo): string {
	if (!session.lastModel) return "Model unknown";
	const thinking = session.lastThinkingLevel ? ` · ${session.lastThinkingLevel}` : "";
	return `${session.lastModel.modelId} (${session.lastModel.provider})${thinking}`;
}

export type SessionHealth = "fresh" | "active" | "deep" | "branched" | "compacted" | "draft";
export type ResumeConfidence = "high" | "medium" | "low";

// Session operational posture for operator-grade resume guidance
export type ResumePosture =
	| "ready" // Clean resume, no pending work
	| "verification-needed" // Changes made, awaiting verification
	| "review-needed" // Significant changes, human review recommended
	| "interrupted" // Session ended mid-operation
	| "context-fragile" // Compacted or branched, context may be incomplete
	| "stale" // Old session, may need refresh
	| "error-pending"; // Previous operation failed, needs attention

export interface SessionOperationalPosture {
	posture: ResumePosture;
	label: string;
	detail?: string;
	safestNextStep?: string;
	riskIndicators: string[];
}

// Session unresolved work detection
export interface UnresolvedWork {
	hasPendingVerification: boolean;
	hasUnacknowledgedError: boolean;
	hasIncompleteCompaction: boolean;
	hasQueuedMessages: boolean;
	lastActionWasDestructive: boolean;
	timeSinceLastActivity: number; // ms
	touchedSensitiveSurface: boolean;
}

export function getSessionHealth(session: SessionInfo): SessionHealth {
	if (session.assistantMessageCount === 0) return "draft";
	if (session.compactionCount > 0) return "compacted";
	if (session.branchSummaryCount > 0 || session.parentSessionPath) return "branched";
	if (session.messageCount >= 24) return "deep";
	if (session.messageCount <= 4) return "fresh";
	return "active";
}

export function getResumeConfidence(session: SessionInfo): ResumeConfidence {
	if (!session.lastUserMessage && !session.firstMessage) return "low";
	if (!session.lastModel && session.assistantMessageCount === 0) return "low";
	if (session.compactionCount > 0 && !session.lastAssistantMessage) return "medium";
	if (session.assistantMessageCount > 0 && session.lastModel) return "high";
	return "medium";
}

function healthLabel(session: SessionInfo): string {
	const health = getSessionHealth(session);
	if (health === "draft") return theme.fg("muted", "Draft session");
	if (health === "compacted") return theme.fg("warning", "Compacted session");
	if (health === "branched") return theme.fg("accent", "Branched session");
	if (health === "deep") return theme.fg("warning", "Deep session");
	if (health === "fresh") return theme.fg("muted", "Fresh session");
	return theme.fg("accent", "Active session");
}

function confidenceLabel(session: SessionInfo): string {
	const confidence = getResumeConfidence(session);
	if (confidence === "high") return theme.fg("accent", "Resume confidence: high");
	if (confidence === "medium") return theme.fg("warning", "Resume confidence: medium");
	return theme.fg("error", "Resume confidence: low");
}

function formatSessionCounts(session: SessionInfo): string {
	const parts = [
		`${session.userMessageCount} user`,
		`${session.assistantMessageCount} assistant`,
		`${session.compactionCount} compact`,
		`${session.branchSummaryCount} branch`,
	];
	if (session.labelCount > 0) {
		parts.push(`${session.labelCount} label`);
	}
	return parts.join(" · ");
}

export function buildSessionStateBadges(session: SessionInfo): string[] {
	const badges: string[] = [];
	if (session.name?.trim()) badges.push(theme.fg("warning", "named"));
	if (session.parentSessionPath) badges.push(theme.fg("accent", "forked"));
	if (session.branchSummaryCount > 0) badges.push(theme.fg("accent", "branched"));
	if (session.compactionCount > 0) badges.push(theme.fg("warning", "compacted"));
	if (session.messageCount >= 24) badges.push(theme.fg("muted", "deep"));
	if (session.assistantMessageCount === 0) badges.push(theme.fg("muted", "draft"));
	if (badges.length === 0) badges.push(theme.fg("muted", "fresh"));
	const confidence = getResumeConfidence(session);
	badges.push(
		confidence === "high"
			? theme.fg("accent", "ready")
			: confidence === "medium"
				? theme.fg("warning", "check")
				: theme.fg("error", "review"),
	);
	return badges;
}

export function buildSessionMetaLine(
	session: SessionInfo,
	workspaceText: string,
	age: string,
	fileSize: string,
): string {
	const badges = buildSessionStateBadges(session).join(theme.fg("dim", " · "));
	return [workspaceText, age, badges, fileSize].filter(Boolean).join(theme.fg("dim", " · "));
}

export function buildSessionPreview(session: SessionInfo | undefined, currentWorkspace?: string): string {
	if (!session) {
		return theme.fg("muted", "Select a session to inspect its resume context.");
	}

	const title = trimInline(session.name ?? session.firstMessage) || session.id;
	const location = session.cwd || currentWorkspace || "Unknown workspace";
	const subtitle = session.name ? excerpt(session.firstMessage, 110) : "";
	const lines = [
		theme.bold(theme.fg("accent", title)),
		...(subtitle ? [theme.fg("muted", subtitle)] : []),
		theme.fg("muted", `${location}`),
		healthLabel(session),
		confidenceLabel(session),
		theme.fg("muted", formatSessionCounts(session)),
		theme.fg("muted", formatModel(session)),
	];

	const lastUser = excerpt(session.lastUserMessage || session.firstMessage, 110);
	const lastAssistant = excerpt(session.lastAssistantMessage, 110);
	if (lastUser) {
		lines.push(`${theme.fg("warning", "Last user")}: ${theme.fg("text", lastUser)}`);
	}
	if (lastAssistant) {
		lines.push(`${theme.fg("accent", "Last assistant")}: ${theme.fg("text", lastAssistant)}`);
	}
	if (!lastAssistant && session.compactionCount > 0) {
		lines.push(theme.fg("muted", "Compacted session: summaries exist even if the latest assistant text is terse."));
	}
	if (session.parentSessionPath) {
		lines.push(theme.fg("muted", "Fork lineage detected: this session branched from another transcript."));
	}

	return lines.join("\n");
}

// Calculate operational posture for operator-grade resume guidance
// This transforms session metadata into actionable resume intelligence
export function calculateSessionPosture(
	session: SessionInfo,
	unresolvedWork?: UnresolvedWork,
): SessionOperationalPosture {
	const riskIndicators: string[] = [];
	const now = Date.now();
	const age = now - session.modified.getTime();
	const hoursSinceActivity = Math.floor(age / (1000 * 60 * 60));

	// Determine posture
	let posture: ResumePosture = "ready";
	let label = "Resume ready";
	let detail: string | undefined;
	let safestNextStep: string | undefined;

	// Error-pending: last assistant ended with error
	if (unresolvedWork?.hasUnacknowledgedError) {
		posture = "error-pending";
		label = "Error pending attention";
		detail = "Previous operation failed and needs review";
		safestNextStep = "Review the error and retry or adjust your approach";
		riskIndicators.push("error-state");
	}
	// Interrupted: ended mid-operation (no recent assistant after user)
	else if (unresolvedWork?.hasQueuedMessages) {
		posture = "interrupted";
		label = "Session interrupted";
		detail = "User message sent but no assistant response yet";
		safestNextStep = "Continue to generate assistant response";
		riskIndicators.push("incomplete-turn");
	}
	// Verification-needed: changes made without recent verification
	else if (unresolvedWork?.hasPendingVerification) {
		posture = "verification-needed";
		label = "Verification recommended";
		detail = "Code or workspace changes may need validation";
		safestNextStep = "Run targeted build/tests to verify changes";
		riskIndicators.push("unverified-changes");
	}
	// Review-needed: touched sensitive surfaces
	else if (unresolvedWork?.touchedSensitiveSurface) {
		posture = "review-needed";
		label = "Review recommended";
		detail = "Sensitive configuration or dependency surface touched";
		safestNextStep = "Review changes before proceeding";
		riskIndicators.push("sensitive-surface");
	}
	// Context-fragile: compacted or branched
	else if (session.compactionCount > 0 || session.branchSummaryCount > 0) {
		posture = "context-fragile";
		label = "Context compacted";
		detail = "Session history summarized; some details may be condensed";
		safestNextStep = "Ask for clarification if context seems incomplete";
		riskIndicators.push("compacted-context");
	}
	// Stale: no activity in 24+ hours
	else if (hoursSinceActivity >= 24) {
		posture = "stale";
		label = "Session stale";
		detail = `Last activity ${hoursSinceActivity}h ago`;
		safestNextStep = "Consider if workspace state has changed externally";
		riskIndicators.push("stale-session");
	}

	// Add time-based indicator
	if (hoursSinceActivity > 4 && hoursSinceActivity < 24) {
		riskIndicators.push("recent-but-idle");
	}

	return {
		posture,
		label,
		detail,
		safestNextStep,
		riskIndicators,
	};
}

// Generate the posture badge for display in selector
export function getPostureBadge(posture: ResumePosture): string {
	switch (posture) {
		case "ready":
			return theme.fg("accent", "✦ ready");
		case "verification-needed":
			return theme.fg("warning", "✦ verify");
		case "review-needed":
			return theme.fg("warning", "✦ review");
		case "interrupted":
			return theme.fg("error", "✦ interrupted");
		case "context-fragile":
			return theme.fg("muted", "✦ compacted");
		case "stale":
			return theme.fg("muted", "✦ stale");
		case "error-pending":
			return theme.fg("error", "✦ error");
		default:
			return theme.fg("dim", "✦");
	}
}

// Build posture-aware preview line for selector items
export function buildPosturePreviewLine(posture: SessionOperationalPosture): string {
	const parts: string[] = [getPostureBadge(posture.posture)];
	if (posture.safestNextStep) {
		parts.push(theme.fg("muted", posture.safestNextStep));
	}
	return parts.join("  ");
}
