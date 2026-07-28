import type { AgentRoomTaskPriority, AgentRoomWorkflowStep, AgentRoomWorkflowType } from "./types.js";

interface StepTemplate {
	title: string;
	description: string;
	priority?: AgentRoomTaskPriority;
	role: string;
	subagentType: string;
}

const WORKFLOW_TEMPLATES: Record<AgentRoomWorkflowType, StepTemplate[]> = {
	architecture: [
		{
			title: "Explore repository structure",
			description:
				"Identify relevant packages, entrypoints, ownership boundaries, tests, and docs for the requested architecture work.",
			priority: "urgent",
			role: "repository explorer",
			subagentType: "Explore",
		},
		{
			title: "Map current architecture and data flow",
			description:
				"Explain the current modules, data flow, dependencies, extension points, and integration seams that matter for the goal.",
			priority: "high",
			role: "architect",
			subagentType: "Plan",
		},
		{
			title: "Identify constraints and risks",
			description:
				"Find coupling, hidden assumptions, migration risks, test gaps, and operational hazards before implementation starts.",
			priority: "high",
			role: "risk reviewer",
			subagentType: "general-purpose",
		},
		{
			title: "Design safe implementation sequence",
			description:
				"Break the work into small, reviewable phases with rollback-aware ordering and validation checkpoints.",
			priority: "high",
			role: "implementation planner",
			subagentType: "Plan",
		},
		{
			title: "Review architecture plan",
			description:
				"Challenge the proposed architecture plan for missing constraints, overengineering, and correctness risks.",
			priority: "normal",
			role: "senior reviewer",
			subagentType: "general-purpose",
		},
		{
			title: "Prepare validation strategy",
			description:
				"Define the smallest useful tests, builds, smoke checks, and manual verification needed to prove the work.",
			priority: "normal",
			role: "QA strategist",
			subagentType: "general-purpose",
		},
		{
			title: "Security and trust-boundary review",
			description:
				"Inspect the proposed architecture for auth, secrets, filesystem, network, and privilege boundary risks.",
			priority: "normal",
			role: "security reviewer",
			subagentType: "general-purpose",
		},
		{
			title: "Performance and scale review",
			description:
				"Assess likely performance, concurrency, storage, and scale implications of the architecture plan.",
			priority: "normal",
			role: "performance reviewer",
			subagentType: "general-purpose",
		},
		{
			title: "Developer experience review",
			description:
				"Evaluate maintainability, file ownership, naming, debugging ergonomics, and future extension cost.",
			priority: "normal",
			role: "DX reviewer",
			subagentType: "general-purpose",
		},
		{
			title: "Synthesize architecture recommendations",
			description:
				"Merge findings into a concise recommendation with decisions, risks, open questions, and next implementation steps.",
			priority: "high",
			role: "synthesis lead",
			subagentType: "Plan",
		},
	],
	"frontend-design": [
		{
			title: "Inspect frontend stack and conventions",
			description:
				"Identify framework, styling system, component conventions, layout constraints, routes, and existing visual language.",
			priority: "urgent",
			role: "frontend explorer",
			subagentType: "Explore",
		},
		{
			title: "Define product and UX direction",
			description:
				"Clarify audience, page purpose, user journey, information hierarchy, and interaction priorities for the requested UI.",
			priority: "high",
			role: "UX strategist",
			subagentType: "Plan",
		},
		{
			title: "Create distinctive visual direction",
			description:
				"Propose a premium visual system: composition, typography, spacing, color, surfaces, motion, and brand mood without generic AI aesthetics.",
			priority: "high",
			role: "visual designer",
			subagentType: "general-purpose",
		},
		{
			title: "Plan component-level implementation",
			description:
				"Map the design direction to concrete files, components, states, responsive behavior, and acceptance criteria.",
			priority: "high",
			role: "frontend architect",
			subagentType: "Plan",
		},
		{
			title: "Implement primary UI pass",
			description:
				"Apply the design direction in a focused, reviewable implementation that respects the existing component system.",
			priority: "high",
			role: "frontend implementer",
			subagentType: "general-purpose",
		},
		{
			title: "Critique visual quality",
			description:
				"Review hierarchy, spacing, contrast, rhythm, generic-AI patterns, polish, and product credibility.",
			priority: "normal",
			role: "design critic",
			subagentType: "general-purpose",
		},
		{
			title: "Review accessibility and responsiveness",
			description:
				"Check keyboard, contrast, semantics, reduced motion, layout breakpoints, overflow, and mobile usability risks.",
			priority: "normal",
			role: "accessibility reviewer",
			subagentType: "general-purpose",
		},
		{
			title: "Polish copy and microinteractions",
			description: "Refine labels, empty states, CTAs, affordances, loading/error states, and small motion details.",
			priority: "normal",
			role: "UX copy and polish reviewer",
			subagentType: "general-purpose",
		},
		{
			title: "Validate frontend implementation",
			description:
				"Run or recommend targeted lint/build/test checks and identify remaining UI risks or regressions.",
			priority: "normal",
			role: "frontend QA",
			subagentType: "general-purpose",
		},
		{
			title: "Synthesize final design handoff",
			description:
				"Summarize final UI decisions, changed files, validation results, known tradeoffs, and next polish opportunities.",
			priority: "high",
			role: "design lead",
			subagentType: "Plan",
		},
	],
	"quality-gate": [
		{
			title: "Run TypeScript and build diagnostics",
			description:
				"Inspect TypeScript, build, lint, and test signals. Report exact failing commands, file/line hints, likely root cause, and minimal fix recommendations.",
			priority: "urgent",
			role: "TypeScript and build guardian",
			subagentType: "general-purpose",
		},
		{
			title: "Triage quality gate failures",
			description:
				"Group failures by owning task or agent, identify whether they block delivery, and decide what needs a fix task.",
			priority: "high",
			role: "quality triage lead",
			subagentType: "Plan",
		},
		{
			title: "Recommend minimal fixes",
			description:
				"For each blocking TypeScript/build/test issue, propose the smallest safe correction without broad rewrites or unrelated cleanup.",
			priority: "high",
			role: "fix planner",
			subagentType: "general-purpose",
		},
		{
			title: "Verify final readiness",
			description:
				"Summarize quality status, remaining failures, artifacts, commands run, and whether the room is ready for final synthesis.",
			priority: "high",
			role: "quality gate lead",
			subagentType: "Plan",
		},
	],
	implementation: [
		{
			title: "Explore affected files",
			description:
				"Find the relevant code paths, tests, configs, and existing conventions for the requested implementation.",
			priority: "urgent",
			role: "code explorer",
			subagentType: "Explore",
		},
		{
			title: "Create implementation plan",
			description:
				"Define the smallest safe change, affected files, risks, acceptance criteria, and validation commands.",
			priority: "high",
			role: "planner",
			subagentType: "Plan",
		},
		{
			title: "Implement focused change",
			description: "Make the scoped implementation with minimal churn and preserve existing style and conventions.",
			priority: "high",
			role: "implementer",
			subagentType: "general-purpose",
		},
		{
			title: "Review diff for correctness",
			description: "Inspect the implementation for bugs, edge cases, maintainability risks, and missing tests.",
			priority: "normal",
			role: "code reviewer",
			subagentType: "general-purpose",
		},
		{
			title: "Run validation and summarize",
			description:
				"Run targeted checks where appropriate and summarize pass/fail status, residual risks, and follow-ups.",
			priority: "normal",
			role: "QA validator",
			subagentType: "general-purpose",
		},
		{
			title: "Security and safety pass",
			description:
				"Check the implementation for unsafe input handling, permission issues, secret exposure, or risky defaults.",
			priority: "normal",
			role: "security reviewer",
			subagentType: "general-purpose",
		},
		{
			title: "Refactor and maintainability pass",
			description:
				"Identify opportunities to simplify the implementation without broad rewrites or unrelated churn.",
			priority: "normal",
			role: "maintainability reviewer",
			subagentType: "general-purpose",
		},
		{
			title: "Documentation and handoff pass",
			description: "Note user-facing behavior, docs or release-note needs, and operational rollout considerations.",
			priority: "low",
			role: "handoff writer",
			subagentType: "general-purpose",
		},
		{
			title: "Regression risk review",
			description: "Think through likely regressions, compatibility concerns, and missing scenario coverage.",
			priority: "normal",
			role: "regression reviewer",
			subagentType: "general-purpose",
		},
		{
			title: "Synthesize implementation result",
			description: "Merge implementation, review, and validation notes into a concise final status and next steps.",
			priority: "high",
			role: "delivery lead",
			subagentType: "Plan",
		},
	],
};

export function buildWorkflowSteps(input: {
	workflow: AgentRoomWorkflowType;
	goal?: string;
	agents?: number;
	model?: string;
}): AgentRoomWorkflowStep[] {
	const templates = WORKFLOW_TEMPLATES[input.workflow];
	const count = Math.min(Math.max(1, Math.floor(input.agents ?? templates.length)), templates.length);
	return templates.slice(0, count).map((template, index) => ({
		title: template.title,
		description: `${template.description}${input.goal ? `\n\nWorkflow goal: ${input.goal}` : ""}`,
		priority: template.priority ?? "normal",
		role: template.role,
		subagentType: template.subagentType,
		model: input.model,
		stepIndex: index + 1,
		stepCount: count,
	}));
}
