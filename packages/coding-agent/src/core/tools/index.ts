import {
	applyPatchTool,
	applyPatchToolDefinition,
	createApplyPatchTool,
	createApplyPatchToolDefinitionForCwd,
} from "./apply-patch.js";
import {
	codexMemoryToolDefinitions,
	codexMemoryTools,
	createCodexMemoryToolDefinitions,
	DEFAULT_CODEX_MEMORY_ACTIVE_TOOL_NAMES,
} from "./codex-memory-tools.js";
import { createMemoryToolDefinitions, memoryToolDefinitions, memoryTools } from "./memory-tools.js";

export {
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	bashTool,
	bashToolDefinition,
	createBashTool,
	createBashToolDefinition,
	createLocalBashOperations,
} from "./bash.js";
export {
	createEditTool,
	createEditToolDefinition,
	type EditOperations,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
	editTool,
	editToolDefinition,
} from "./edit.js";
export { withFileMutationQueue } from "./file-mutation-queue.js";
export {
	createFindTool,
	createFindToolDefinition,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
	findTool,
	findToolDefinition,
} from "./find.js";
export {
	createGrepTool,
	createGrepToolDefinition,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
	grepTool,
	grepToolDefinition,
} from "./grep.js";
export {
	createLsTool,
	createLsToolDefinition,
	type LsOperations,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
	lsTool,
	lsToolDefinition,
} from "./ls.js";
export {
	inspectWindowsUiTool,
	inspectWindowsUiToolDefinition,
	osControlActionTool,
	osControlActionToolDefinition,
	osPerformStepTool,
	osPerformStepToolDefinition,
	osWaitForTextTool,
	osWaitForTextToolDefinition,
	osWaitForWindowTool,
	osWaitForWindowToolDefinition,
} from "./os-control.js";
export {
	createReadTool,
	createReadToolDefinition,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
	readTool,
	readToolDefinition,
} from "./read.js";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./truncate.js";
export {
	createWriteTool,
	createWriteToolDefinition,
	type WriteOperations,
	type WriteToolInput,
	type WriteToolOptions,
	writeTool,
	writeToolDefinition,
} from "./write.js";

import type { AgentTool } from "@mrquake/quakecode-agent-core";
import type { ToolDefinition } from "../extensions/types.js";
import {
	type BashToolOptions,
	bashTool,
	bashToolDefinition,
	createBashTool,
	createBashToolDefinition,
} from "./bash.js";
import { createEditTool, createEditToolDefinition, editTool, editToolDefinition } from "./edit.js";
import { createFindTool, createFindToolDefinition, findTool, findToolDefinition } from "./find.js";
import { createGrepTool, createGrepToolDefinition, grepTool, grepToolDefinition } from "./grep.js";
import { createLsTool, createLsToolDefinition, lsTool, lsToolDefinition } from "./ls.js";
import {
	inspectWindowsUiTool,
	inspectWindowsUiToolDefinition,
	osControlActionTool,
	osControlActionToolDefinition,
	osPerformStepTool,
	osPerformStepToolDefinition,
	osWaitForTextTool,
	osWaitForTextToolDefinition,
	osWaitForWindowTool,
	osWaitForWindowToolDefinition,
} from "./os-control.js";
import {
	createReadTool,
	createReadToolDefinition,
	type ReadToolOptions,
	readTool,
	readToolDefinition,
} from "./read.js";
import { createWriteTool, createWriteToolDefinition, writeTool, writeToolDefinition } from "./write.js";
import {
	createGenerateImageToolDefinition,
	generateImageTool,
	generateImageToolDefinition,
} from "./generate-image.js";
import {
	createGenerateVideoToolDefinition,
	generateVideoTool,
	generateVideoToolDefinition,
} from "./generate-video.js";
import {
	createWebFindInPageToolDefinition,
	createWebOpenPageToolDefinition,
	createWebSearchToolDefinition,
	webFindInPageTool,
	webFindInPageToolDefinition,
	webOpenPageTool,
	webOpenPageToolDefinition,
	webSearchTool,
	webSearchToolDefinition,
} from "./web-search.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import {
	createUpdatePlanToolDefinition,
	updatePlanTool,
	updatePlanToolDefinition,
} from "./update-plan.js";
import {
	createClearPlanToolDefinition,
	clearPlanTool,
	clearPlanToolDefinition,
} from "./clear-plan.js";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;

/** Full coding toolkit: read/shell/edit/write/patch + search + web + media + plan. */
export const codingTools: Tool[] = [
	readTool,
	bashTool,
	editTool,
	writeTool,
	applyPatchTool,
	grepTool,
	findTool,
	lsTool,
	webSearchTool,
	webOpenPageTool,
	webFindInPageTool,
	generateImageTool,
	generateVideoTool,
	updatePlanTool,
	clearPlanTool,
];
export const readOnlyTools: Tool[] = [readTool, grepTool, findTool, lsTool, webSearchTool, webOpenPageTool, webFindInPageTool];

/**
 * Every built-in tool. Session default = ALL keys here (+ extension tools at runtime).
 * update_plan is a first-class Codex checklist tool (always on).
 */
export const allTools = {
	read: readTool,
	bash: bashTool,
	edit: editTool,
	write: writeTool,
	apply_patch: applyPatchTool,
	grep: grepTool,
	find: findTool,
	ls: lsTool,
	web_search: webSearchTool,
	web_open_page: webOpenPageTool,
	web_find_in_page: webFindInPageTool,
	generate_image: generateImageTool,
	generate_video: generateVideoTool,
	update_plan: updatePlanTool,
	clear_plan: clearPlanTool,
	inspect_windows_ui: inspectWindowsUiTool,
	os_control_action: osControlActionTool,
	os_wait_for_window: osWaitForWindowTool,
	os_wait_for_text: osWaitForTextTool,
	os_perform_step: osPerformStepTool,
	...memoryTools,
	...codexMemoryTools,
};

export const allToolDefinitions = {
	read: readToolDefinition,
	bash: bashToolDefinition,
	edit: editToolDefinition,
	write: writeToolDefinition,
	apply_patch: applyPatchToolDefinition,
	grep: grepToolDefinition,
	find: findToolDefinition,
	ls: lsToolDefinition,
	web_search: webSearchToolDefinition,
	web_open_page: webOpenPageToolDefinition,
	web_find_in_page: webFindInPageToolDefinition,
	generate_image: generateImageToolDefinition,
	generate_video: generateVideoToolDefinition,
	update_plan: updatePlanToolDefinition,
	clear_plan: clearPlanToolDefinition,
	inspect_windows_ui: inspectWindowsUiToolDefinition,
	os_control_action: osControlActionToolDefinition,
	os_wait_for_window: osWaitForWindowToolDefinition,
	os_wait_for_text: osWaitForTextToolDefinition,
	os_perform_step: osPerformStepToolDefinition,
	...memoryToolDefinitions,
	...codexMemoryToolDefinitions,
};

export type ToolName = keyof typeof allTools;
export type { MemoryToolName } from "./memory-tools.js";
export type { CodexMemoryToolName } from "./codex-memory-tools.js";
export {
	DEFAULT_CODEX_MEMORY_ACTIVE_TOOL_NAMES,
	createCodexMemoryToolDefinitions,
	codexMemoryTools,
	codexMemoryToolDefinitions,
} from "./codex-memory-tools.js";

export interface ToolsOptions {
	read?: ReadToolOptions;
	bash?: BashToolOptions;
}

export function createCodingToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
	return [
		createReadToolDefinition(cwd, options?.read),
		createBashToolDefinition(cwd, options?.bash),
		createEditToolDefinition(cwd),
		createWriteToolDefinition(cwd),
		createApplyPatchToolDefinitionForCwd(cwd),
		createGrepToolDefinition(cwd),
		createFindToolDefinition(cwd),
		createLsToolDefinition(cwd),
		createWebSearchToolDefinition(),
		createWebOpenPageToolDefinition(),
		createWebFindInPageToolDefinition(),
		createGenerateImageToolDefinition(cwd),
		createGenerateVideoToolDefinition(cwd),
		createUpdatePlanToolDefinition(),
		createClearPlanToolDefinition(),
		inspectWindowsUiToolDefinition,
		osControlActionToolDefinition,
		osWaitForWindowToolDefinition,
		osWaitForTextToolDefinition,
		osPerformStepToolDefinition,
	];
}

export function createReadOnlyToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
	return [
		createReadToolDefinition(cwd, options?.read),
		createGrepToolDefinition(cwd),
		createFindToolDefinition(cwd),
		createLsToolDefinition(cwd),
	];
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<ToolName, ToolDef> {
	const defs: any = {
		read: createReadToolDefinition(cwd, options?.read),
		bash: createBashToolDefinition(cwd, options?.bash),
		edit: createEditToolDefinition(cwd),
		write: createWriteToolDefinition(cwd),
		apply_patch: createApplyPatchToolDefinitionForCwd(cwd),
		grep: createGrepToolDefinition(cwd),
		find: createFindToolDefinition(cwd),
		ls: createLsToolDefinition(cwd),
		web_search: createWebSearchToolDefinition(),
		web_open_page: createWebOpenPageToolDefinition(),
		web_find_in_page: createWebFindInPageToolDefinition(),
		generate_image: createGenerateImageToolDefinition(cwd),
		generate_video: createGenerateVideoToolDefinition(cwd),
		update_plan: createUpdatePlanToolDefinition(),
		clear_plan: createClearPlanToolDefinition(),
		inspect_windows_ui: inspectWindowsUiToolDefinition,
		os_control_action: osControlActionToolDefinition,
		os_wait_for_window: osWaitForWindowToolDefinition,
		os_wait_for_text: osWaitForTextToolDefinition,
		os_perform_step: osPerformStepToolDefinition,
	};
	Object.assign(defs, createMemoryToolDefinitions(cwd));
	Object.assign(defs, createCodexMemoryToolDefinitions());
	return defs;
}

export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createBashTool(cwd, options?.bash),
		createEditTool(cwd),
		createWriteTool(cwd),
		createApplyPatchTool(cwd),
		createGrepTool(cwd),
		createFindTool(cwd),
		createLsTool(cwd),
		webSearchTool,
		webOpenPageTool,
		webFindInPageTool,
		wrapToolDefinition(createGenerateImageToolDefinition(cwd)),
		wrapToolDefinition(createGenerateVideoToolDefinition(cwd)),
		updatePlanTool,
		inspectWindowsUiTool,
		osControlActionTool,
		osWaitForWindowTool,
		osWaitForTextTool,
		osPerformStepTool,
	];
}

export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createGrepTool(cwd),
		createFindTool(cwd),
		createLsTool(cwd),
		inspectWindowsUiTool,
	];
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	const tools: any = {
		read: createReadTool(cwd, options?.read),
		bash: createBashTool(cwd, options?.bash),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
		apply_patch: createApplyPatchTool(cwd),
		grep: createGrepTool(cwd),
		find: createFindTool(cwd),
		ls: createLsTool(cwd),
		web_search: webSearchTool,
		web_open_page: webOpenPageTool,
		web_find_in_page: webFindInPageTool,
		generate_image: wrapToolDefinition(createGenerateImageToolDefinition(cwd)),
		generate_video: wrapToolDefinition(createGenerateVideoToolDefinition(cwd)),
		update_plan: updatePlanTool,
		inspect_windows_ui: inspectWindowsUiTool,
		os_control_action: osControlActionTool,
		os_wait_for_window: osWaitForWindowTool,
		os_wait_for_text: osWaitForTextTool,
		os_perform_step: osPerformStepTool,
		...memoryTools,
		...codexMemoryTools,
	};
	// Bind layered memory cwd for session-scoped storage.
	createMemoryToolDefinitions(cwd);
	createCodexMemoryToolDefinitions();
	return tools;
}

/** Every built-in tool name — used as the default active set. */
export const ALL_BUILTIN_TOOL_NAMES: ToolName[] = Object.keys(allTools) as ToolName[];

export {
	createApplyPatchTool,
	createApplyPatchToolDefinitionForCwd,
	applyPatchTool,
	applyPatchToolDefinition,
} from "./apply-patch.js";

export {
	createWebSearchToolDefinition,
	createWebOpenPageToolDefinition,
	createWebFindInPageToolDefinition,
	webSearchTool,
	webOpenPageTool,
	webFindInPageTool,
	webSearchToolDefinition,
	webOpenPageToolDefinition,
	webFindInPageToolDefinition,
} from "./web-search.js";

export {
	createGenerateImageToolDefinition,
	generateImageTool,
	generateImageToolDefinition,
} from "./generate-image.js";

export {
	createGenerateVideoToolDefinition,
	generateVideoTool,
	generateVideoToolDefinition,
} from "./generate-video.js";

export {
	createUpdatePlanToolDefinition,
	updatePlanTool,
	updatePlanToolDefinition,
	UPDATE_PLAN_TOOL_DESCRIPTION,
	UPDATE_PLAN_PROMPT_GUIDELINES,
} from "./update-plan.js";

