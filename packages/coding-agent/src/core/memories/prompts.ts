/**
 * Codex memories read-path developer instructions (templates/memories/read_path.md).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_TOOL_DEVELOPER_INSTRUCTIONS_SUMMARY_TOKEN_LIMIT } from "./constants.js";
import { defaultMemoriesRoot } from "./local-backend.js";

const READ_PATH_TEMPLATE = `## Memory

You have access to a memory folder with guidance from prior runs. It can save
time and help you stay consistent. Use it whenever it is likely to help.

Decision boundary: should you use memory for a new user query?

- Skip memory ONLY when the request is clearly self-contained and does not need
  workspace history, conventions, or prior decisions.
- Hard skip examples: current time/date, simple translation, simple sentence
  rewrite, one-line shell command, trivial formatting.
- Use memory by default when ANY of these are true:
  - the query mentions workspace/repo/module/path/files in MEMORY_SUMMARY below,
  - the user asks for prior context / consistency / previous decisions,
  - the task is ambiguous and could depend on earlier project choices,
  - the ask is a non-trivial and related to MEMORY_SUMMARY below.
- If unsure, do a quick memory pass.

Memory layout (general -> specific):

- {{ base_path }}/memory_summary.md (already provided below; do NOT open again)
- {{ base_path }}/MEMORY.md (searchable registry; primary file to query)
- {{ base_path }}/skills/<skill-name>/ (skill folder)
  - SKILL.md (entrypoint instructions)
  - scripts/ (optional helper scripts)
  - examples/ (optional example outputs)
  - templates/ (optional templates)
- {{ base_path }}/rollout_summaries/ (per-rollout recaps + evidence snippets)
- {{ base_path }}/extensions/ad_hoc/notes/ (append-only user-requested notes)

Tools (Codex-compatible):

- memories_list — list files/dirs under the memories root (optional path, cursor)
- memories_read — read a memory file by relative path (line_offset, max_lines)
- memories_search — search memory files (queries[], match_mode, path, …)
- memories_add_ad_hoc_note — create one append-only note when the user explicitly asks to remember something (filename: YYYY-MM-DDTHH-MM-SS-<slug>.md)

Quick memory pass (when applicable):

1. Skim the MEMORY_SUMMARY below and extract task-relevant keywords.
2. Search {{ base_path }}/MEMORY.md using those keywords via memories_search.
3. Only if MEMORY.md points to rollout summaries/skills, open the 1-2 most relevant files via memories_read.
4. If there are no relevant hits, stop memory lookup and continue normally.

Quick-pass budget:

- Keep memory lookup lightweight: ideally <= 4-6 search steps before main work.
- Avoid broad scans of all rollout summaries.

When answering from memory without current verification:

- If you rely on memory for a fact that you did not verify in the current turn, say so briefly.
- Do not present unverified memory-derived facts as confirmed-current.

MEMORY_SUMMARY:
{{ memory_summary }}
`;

function truncateApproxTokens(text: string, maxTokens: number): string {
	const maxChars = Math.max(200, maxTokens * 4);
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n…`;
}

/** Build Codex-style memory developer instructions, or undefined if no summary content. */
export function buildMemoryToolDeveloperInstructions(memoriesRoot = defaultMemoriesRoot()): string | undefined {
	const summaryPath = join(memoriesRoot, "memory_summary.md");
	if (!existsSync(summaryPath)) return undefined;
	let summary: string;
	try {
		summary = readFileSync(summaryPath, "utf-8").trim();
	} catch {
		return undefined;
	}
	if (!summary) return undefined;
	summary = truncateApproxTokens(summary, MEMORY_TOOL_DEVELOPER_INSTRUCTIONS_SUMMARY_TOKEN_LIMIT);
	return READ_PATH_TEMPLATE
		.replaceAll("{{ base_path }}", memoriesRoot.replace(/\\/g, "/"))
		.replace("{{ memory_summary }}", summary);
}
