import { beforeAll, describe, expect, it } from "vitest";
import type { SessionInfo } from "../src/core/session-manager.js";
import {
	buildSessionPreview,
	buildSessionStateBadges,
	getResumeConfidence,
	getSessionHealth,
} from "../src/modes/interactive/components/session-selector-summary.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function makeSession(overrides: Partial<SessionInfo> & { id: string }): SessionInfo {
	return {
		path: overrides.path ?? `/tmp/${overrides.id}.jsonl`,
		id: overrides.id,
		cwd: overrides.cwd ?? "",
		name: overrides.name,
		parentSessionPath: overrides.parentSessionPath,
		created: overrides.created ?? new Date(0),
		modified: overrides.modified ?? new Date(0),
		messageCount: overrides.messageCount ?? 1,
		userMessageCount: overrides.userMessageCount ?? 1,
		assistantMessageCount: overrides.assistantMessageCount ?? 0,
		compactionCount: overrides.compactionCount ?? 0,
		branchSummaryCount: overrides.branchSummaryCount ?? 0,
		labelCount: overrides.labelCount ?? 0,
		firstMessage: overrides.firstMessage ?? "hello",
		lastUserMessage: overrides.lastUserMessage ?? overrides.firstMessage ?? "hello",
		lastAssistantMessage: overrides.lastAssistantMessage ?? "",
		allMessagesText: overrides.allMessagesText ?? overrides.firstMessage ?? "hello",
		lastModel: overrides.lastModel,
		lastThinkingLevel: overrides.lastThinkingLevel,
	};
}

describe("session selector summary", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("classifies draft sessions as low-confidence drafts", () => {
		const session = makeSession({ id: "draft", assistantMessageCount: 0, lastModel: undefined });
		expect(getSessionHealth(session)).toBe("draft");
		expect(getResumeConfidence(session)).toBe("low");
	});

	it("classifies compacted sessions distinctly", () => {
		const session = makeSession({
			id: "compacted",
			assistantMessageCount: 4,
			compactionCount: 2,
			lastModel: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
		});
		expect(getSessionHealth(session)).toBe("compacted");
		expect(buildSessionStateBadges(session).join(" ")).toContain("compacted");
	});

	it("builds a premium preview with health, confidence, and lineage", () => {
		const session = makeSession({
			id: "named",
			name: "Release prep",
			firstMessage: "Prepare release checklist",
			lastUserMessage: "Prepare release checklist for next week",
			lastAssistantMessage: "Drafted the release plan and risks.",
			assistantMessageCount: 3,
			messageCount: 7,
			branchSummaryCount: 1,
			parentSessionPath: "/tmp/parent.jsonl",
			lastModel: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
			lastThinkingLevel: "high",
		});

		const preview = buildSessionPreview(session, "/repo");
		expect(preview).toContain("Release prep");
		expect(preview).toContain("Prepare release checklist");
		expect(preview).toContain("Resume confidence: high");
		expect(preview).toContain("Branched session");
		expect(preview).toContain("Fork lineage detected");
		expect(preview).toContain("claude-sonnet-4-5");
	});
});
