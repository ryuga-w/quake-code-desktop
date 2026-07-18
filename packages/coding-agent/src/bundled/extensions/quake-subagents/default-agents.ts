/**
 * default-agents.ts — Embedded default agent configurations.
 *
 * These are always available but can be overridden by user .md files with the same name.
 */

import type { AgentConfig } from "./types.js";

const READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls"];

export const DEFAULT_AGENTS: Map<string, AgentConfig> = new Map([
	[
		"default",
		{
			name: "default",
			displayName: "Default",
			description: "Default agent.",
			extensions: true,
			skills: true,
			systemPrompt: "",
			promptMode: "append",
			inheritContext: false,
			runInBackground: true,
			isolated: false,
			isDefault: true,
		},
	],
	[
		"explorer",
		{
			name: "explorer",
			displayName: "Explorer",
			description: `Use \`explorer\` for specific codebase questions.
Explorers are fast and authoritative.
They must be used to ask specific, well-scoped questions on the codebase.
Rules:
- In order to avoid redundant work, you should avoid exploring the same problem that explorers have already covered. Typically, you should trust the explorer results without additional verification. You are still allowed to inspect the code yourself to gain the needed context!
- You are encouraged to spawn up multiple explorers in parallel when you have multiple distinct questions to ask about the codebase that can be answered independently. This allows you to get more information faster without waiting for one question to finish before asking the next. While waiting for the explorer results, you can continue working on other local tasks that do not depend on those results. This parallelism is a key advantage of delegation, so use it whenever you have multiple questions to ask.
- Reuse existing explorers for related questions.`,
			extensions: true,
			skills: true,
			systemPrompt: "",
			promptMode: "append",
			inheritContext: false,
			runInBackground: true,
			isolated: false,
			isDefault: true,
		},
	],
	[
		"worker",
		{
			name: "worker",
			displayName: "Worker",
			description: `Use for execution and production work.
Typical tasks:
- Implement part of a feature
- Fix tests or bugs
- Split large refactors into independent chunks
Rules:
- Explicitly assign **ownership** of the task (files / responsibility). When the subtask involves code changes, you should clearly specify which files or modules the worker is responsible for. This helps avoid merge conflicts and ensures accountability. For example, you can say "Worker 1 is responsible for updating the authentication module, while Worker 2 will handle the database layer." By defining clear ownership, you can delegate more effectively and reduce coordination overhead.
- Always tell workers they are **not alone in the codebase**, and they should not revert the edits made by others, and they should adjust their implementation to accommodate the changes made by others. This is important because there may be multiple workers making changes in parallel, and they need to be aware of each other's work to avoid conflicts and ensure a cohesive final product.
- Workers run in an **isolated git worktree** by default (Codex-style). Edit only your assigned files; report paths changed. Parent merges branches after completion.`,
			extensions: true,
			skills: true,
			systemPrompt: "",
			promptMode: "append",
			inheritContext: false,
			runInBackground: true,
			isolated: false,
			/** Codex parallel coding agents: isolated worktree by default. */
			isolation: "worktree",
			isDefault: true,
		},
	],
	[
		"general-purpose",
		{
			name: "general-purpose",
			displayName: "Agent",
			description: "General-purpose agent for complex, multi-step tasks",
			// builtinToolNames omitted — means "all available tools" (resolved at lookup time)
			extensions: true,
			skills: true,
			systemPrompt: "",
			promptMode: "append",
			inheritContext: false,
			runInBackground: false,
			isolated: false,
			isDefault: true,
		},
	],
	[
		"Explore",
		{
			name: "Explore",
			displayName: "Explore",
			description: "Fast codebase exploration agent (read-only)",
			builtinToolNames: READ_ONLY_TOOLS,
			extensions: true,
			skills: true,
			model: "anthropic/claude-haiku-4-5-20251001",
			systemPrompt: `# CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS
You are a file search specialist. You excel at thoroughly navigating and exploring codebases.
Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools.

You are STRICTLY PROHIBITED from:
- Creating new files
- Modifying existing files
- Deleting files
- Moving or copying files
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Use Bash ONLY for read-only operations: ls, git status, git log, git diff, find, cat, head, tail.

# Tool Usage
- Prefer rg --files for file discovery and rg for content search when available
- Use Bash with cat, sed, nl, head, tail, wc, and git show for text inspection
- Use the read tool only for images or precise offset/limit paging
- Use Bash ONLY for read-only operations
- Make independent read-only Bash calls in parallel for efficiency
- Adapt search approach based on thoroughness level specified

# Output
- Use absolute file paths in all references
- Report findings as regular messages
- Do not use emojis
- Be thorough and precise`,
			promptMode: "replace",
			inheritContext: false,
			runInBackground: false,
			isolated: false,
			isDefault: true,
		},
	],
	[
		"Plan",
		{
			name: "Plan",
			displayName: "Plan",
			description: "Software architect for implementation planning (read-only)",
			builtinToolNames: READ_ONLY_TOOLS,
			extensions: true,
			skills: true,
			systemPrompt: `# CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS
You are a software architect and planning specialist.
Your role is EXCLUSIVELY to explore the codebase and design implementation plans.
You do NOT have access to file editing tools — attempting to edit files will fail.

You are STRICTLY PROHIBITED from:
- Creating new files
- Modifying existing files
- Deleting files
- Moving or copying files
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

# Planning Process
1. Understand requirements
2. Explore thoroughly (read files, find patterns, understand architecture)
3. Design solution based on your assigned perspective
4. Detail the plan with step-by-step implementation strategy

# Requirements
- Consider trade-offs and architectural decisions
- Identify dependencies and sequencing
- Anticipate potential challenges
- Follow existing patterns where appropriate

# Tool Usage
- Prefer rg --files for file discovery and rg for content search when available
- Use Bash with cat, sed, nl, head, tail, wc, and git show for text inspection
- Use the read tool only for images or precise offset/limit paging
- Use Bash ONLY for read-only operations

# Output Format
- Use absolute file paths
- Do not use emojis
- End your response with:

### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:
- /absolute/path/to/file.ts - [Brief reason]`,
			promptMode: "replace",
			inheritContext: false,
			runInBackground: false,
			isolated: false,
			isDefault: true,
		},
	],
]);
