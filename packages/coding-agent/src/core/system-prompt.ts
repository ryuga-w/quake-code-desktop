/**
 * System prompt construction and project context loading.
 */

import { getDocsPath, getExamplesPath, getReadmePath } from "../config.js";
import type { AgentSession } from "./agent-session.js";
import {
	buildGlobalToolInstructionsSection,
	FALLBACK_TOOL_SNIPPETS,
	READ_TOOL_GUIDELINES,
	BASH_TOOL_GUIDELINES,
	WRITE_TOOL_GUIDELINES,
	EDIT_TOOL_GUIDELINES,
	WEB_TOOL_GUIDELINES,
	MEDIA_TOOL_GUIDELINES,
	PLAN_TOOL_GUIDELINES,
} from "./prompts/codex-templates.js";
import { formatSkillsForPrompt, type Skill } from "./skills.js";

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write] */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Additional guideline bullets appended to the default system prompt guidelines. */
	promptGuidelines?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. Default: process.cwd() */
	cwd?: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
	/** Memory block to inject into the agent's system prompt (from auto memory system). */
	memoryBlock?: string;
	/** Memory scope indicator for the agent. */
	memoryScope?: "user" | "project" | "local" | "none";
}

function isAgentSession(value: AgentSession | BuildSystemPromptOptions | undefined): value is AgentSession {
	return !!value && typeof value === "object" && "sessionManager" in value && "resourceLoader" in value;
}

function normalizePromptSnippet(text: string | undefined): string | undefined {
	if (!text) return undefined;

	const normalized = text
		.replace(/[\r\n]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	return normalized.length > 0 ? normalized : undefined;
}

function normalizePromptGuidelines(guidelines: string[] | undefined): string[] {
	if (!guidelines || guidelines.length === 0) {
		return [];
	}

	const unique = new Set<string>();
	for (const guideline of guidelines) {
		const normalized = guideline.trim();
		if (normalized.length > 0) {
			unique.add(normalized);
		}
	}

	return Array.from(unique);
}

function resolveOptions(input: AgentSession | BuildSystemPromptOptions | undefined): BuildSystemPromptOptions {
	if (!isAgentSession(input)) {
		return input ?? {};
	}

	const selectedTools = input.getActiveToolNames();
	const toolSnippets: Record<string, string> = {};
	const promptGuidelines: string[] = [];

	for (const name of selectedTools) {
		const definition = input.getToolDefinition(name);
		const snippet = normalizePromptSnippet(definition?.promptSnippet);
		if (snippet) {
			toolSnippets[name] = snippet;
		}

		const guidelines = normalizePromptGuidelines(definition?.promptGuidelines);
		if (guidelines.length > 0) {
			promptGuidelines.push(...guidelines);
		}
	}

	const appendSystemPromptParts = input.resourceLoader.getAppendSystemPrompt();
	return {
		cwd: input.sessionManager.getCwd(),
		skills: input.resourceLoader.getSkills().skills,
		contextFiles: input.resourceLoader.getAgentsFiles().agentsFiles,
		customPrompt: input.resourceLoader.getSystemPrompt(),
		appendSystemPrompt: appendSystemPromptParts.length > 0 ? appendSystemPromptParts.join("\n\n") : undefined,
		selectedTools,
		toolSnippets,
		promptGuidelines,
	};
}

/** Resolve a one-line tool description for the Available tools list. */
function resolveToolSnippet(name: string, toolSnippets?: Record<string, string>): string {
	const fromDef = normalizePromptSnippet(toolSnippets?.[name]);
	if (fromDef) return fromDef;
	const fallback = FALLBACK_TOOL_SNIPPETS[name];
	if (fallback) return fallback;
	return name;
}

/**
 * Format Available tools list — always include every selected tool name.
 * Previously tools without promptSnippet were dropped from the list (Codex gap).
 */
function formatToolsList(tools: string[], toolSnippets?: Record<string, string>): string {
	if (!tools.length) return "(none)";
	return tools.map((name) => `- ${name}: ${resolveToolSnippet(name, toolSnippets)}`).join("\n");
}

/** Build the system prompt with tools, guidelines, and context. */
export function buildSystemPrompt(input: AgentSession | BuildSystemPromptOptions | undefined = {}): string {
	const {
		customPrompt,
		selectedTools,
		toolSnippets,
		promptGuidelines,
		appendSystemPrompt,
		cwd,
		contextFiles: providedContextFiles,
		skills: providedSkills,
	} = resolveOptions(input);

	const resolvedCwd = cwd ?? process.cwd();
	const promptCwd = resolvedCwd.replace(/\\/g, "/");
	const date = new Date().toISOString().slice(0, 10);
	const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";
	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];

	// Global core-tool doctrine (read/bash/edit/write/apply_patch/grep/find/ls)
	// Always inject — not dependent on tool-list registration.
	const globalToolSection = buildGlobalToolInstructionsSection();

	if (customPrompt) {
		let prompt = customPrompt;

		// Global inject even when a custom system prompt replaces the default template.
		if (!prompt.includes("## Core tools") && !prompt.includes("## Core coding tools")) {
			prompt += globalToolSection;
		}

		if (appendSection) {
			prompt += appendSection;
		}

		if (contextFiles.length > 0) {
			prompt += "\n\n# Project Context\n\n";
			prompt += "Project-specific instructions and guidelines:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `## ${filePath}\n\n${content}\n\n`;
			}
		}

		const customPromptSkillReader =
			!selectedTools || selectedTools.includes("bash")
				? "bash"
				: selectedTools.includes("read")
					? "read"
					: undefined;
		if (customPromptSkillReader && skills.length > 0) {
			prompt += formatSkillsForPrompt(skills, customPromptSkillReader);
		}

		prompt += `\nCurrent date: ${date}`;
		prompt += `\nCurrent working directory: ${promptCwd}`;
		return prompt;
	}

	const readmePath = getReadmePath();
	const docsPath = getDocsPath();
	const examplesPath = getExamplesPath();

	const tools = selectedTools || ["read", "bash", "edit", "write", "apply_patch", "grep", "find", "ls"];
	// Always list every selected tool (fallback snippets if definition missing)
	const toolsList = formatToolsList(tools, toolSnippets);

	const guidelinesList: string[] = [];
	const guidelinesSet = new Set<string>();
	const addGuideline = (guideline: string): void => {
		if (guidelinesSet.has(guideline)) {
			return;
		}
		guidelinesSet.add(guideline);
		guidelinesList.push(guideline);
	};

	const hasBash = tools.includes("bash");
	const hasRead = tools.includes("read");
	const skillFileReader = hasBash ? "bash" : hasRead ? "read" : undefined;

	if (hasBash) {
		addGuideline("Use bash for file operations like ls, rg, and find");
	}

	for (const guideline of promptGuidelines ?? []) {
		const normalized = guideline.trim();
		if (normalized.length > 0) {
			addGuideline(normalized);
		}
	}

	addGuideline("Be concise in your responses");
	addGuideline("Show file paths clearly when working with files");
	if (tools.includes("web_search")) {
		addGuideline("Use web_search first for general research and discovery");
	}
	if (tools.includes("web_open_page")) {
		addGuideline("Use web_open_page after web_search when you know which result to open");
	}
	if (tools.includes("web_find_in_page")) {
		addGuideline("Use web_find_in_page after opening a page when checking specific text");
	}
	if (tools.some((name) => name.startsWith("browser_"))) {
		addGuideline("Use browser tools only when direct page interaction or screenshots are required");
	}

	// Global core-tool guidelines (always — independent of which tools are active this turn)
	for (const g of READ_TOOL_GUIDELINES) addGuideline(g);
	for (const g of BASH_TOOL_GUIDELINES) addGuideline(g);
	for (const g of WRITE_TOOL_GUIDELINES) addGuideline(g);
	for (const g of EDIT_TOOL_GUIDELINES) addGuideline(g);
	for (const g of WEB_TOOL_GUIDELINES) addGuideline(g);
	for (const g of MEDIA_TOOL_GUIDELINES) addGuideline(g);
	for (const g of PLAN_TOOL_GUIDELINES) addGuideline(g);

	const guidelines = guidelinesList.map((guideline) => `- ${guideline}`).join("\n");

	let prompt = `You are an expert coding assistant operating inside Quake Code, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Tool availability rules:
- If a tool appears in Available tools, it is available in this session.
- Do not claim a listed tool is missing, unavailable, unsupported, hidden, or inaccessible.
- Never output meta-commentary about checking whether web_search exists.
- Never say you cannot browse the web when web_search is available.
- If a web tool like web_search, web_open_page, or web_find_in_page is listed above, use it directly instead of discussing whether it exists.
- If the user asks for a general web lookup, call web_search immediately and continue from its results.
- For a simple factual lookup that does not require interaction, use exactly one web_search call unless the results are empty or clearly ambiguous.
- For a simple factual lookup that does not require interaction, one successful web_search call is usually enough: answer directly from the returned results unless the user asks for deeper verification.
- After a successful web_search call, do not re-litigate tool availability, do not inspect the repo for tools, and do not switch to bash/curl-based searching.
- Do not use bash, curl, wget, or ad-hoc scraping as a replacement for web_search when web_search is available.
- If the user says not to open a browser, do not use browser_* tools unless the user later explicitly allows browser interaction.
- When the user says not to open a browser, do not suggest browser_navigate, browser_click, browser_snapshot, browser_type, or other browser_* tools.
- Do not narrate internal tool-selection uncertainty to the user. Prefer silent tool use followed by results.
- Use web_search for general web lookups and discovery.
- Use web_open_page only after you already know which URL should be opened.
- Use web_find_in_page only after opening a page when you need to confirm whether specific text appears on it.
- Use browser_* tools only for direct page interaction, screenshots, form filling, clicking, tabs, or browser state inspection.

Guidelines:
${guidelines}
${globalToolSection}
Quake Code documentation (read only when the user asks about Quake Code itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
- When asked about extensions, themes, skills, prompt templates, TUI components, keybindings, SDK integrations, custom providers, adding models, or Quake Code packages, read the relevant docs and examples first
- Always read Quake Code markdown files completely and follow related cross-references before implementing`;

	if (appendSection) {
		prompt += appendSection;
	}

	if (contextFiles.length > 0) {
		prompt += "\n\n# Project Context\n\n";
		prompt += "Project-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `## ${filePath}\n\n${content}\n\n`;
		}
	}

	if (skillFileReader && skills.length > 0) {
		prompt += formatSkillsForPrompt(skills, skillFileReader);
	}

	prompt += `\nCurrent date: ${date}`;
	prompt += `\nCurrent working directory: ${promptCwd}`;

	return prompt;
}
