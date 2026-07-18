import { isDiff } from "./render";
import type { ToolCardState } from "../state/app-store";
import type { WorkspaceChangeSummary } from "../types";
import { TOOL_SCAN_TEXT_LIMIT } from "../constants";
import { compactToolText, toolDiffText } from "./tool-helpers";

export type FileChangeKind = "created" | "modified" | "deleted";
export type FileChange = { path: string; kind: FileChangeKind; summary: string; patch: string; tool: ToolCardState };

export function countPatchLines(text: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

export function summarizeComposerChanges(tools: ToolCardState[]): WorkspaceChangeSummary | undefined {
  const changes = extractFileChanges(tools);
  if (!changes.length) return undefined;
  const stats = countPatchLines(changes.map((change) => change.patch).join("\n"));
  return { files: changes.length, ...stats };
}

export function extractFileChanges(tools: ToolCardState[]): FileChange[] {
  const changes = new Map<string, FileChange>();
  for (const tool of tools) {
    const name = tool.toolName.toLowerCase();
    const output = toolDiffText(tool) || compactToolText(tool.output || "", TOOL_SCAN_TEXT_LIMIT);
    const paths = extractToolPaths(tool);
    if (!paths.length) continue;
    const isFileWriteTool = /\b(edit|write|apply_patch|patch|delete|remove|rm)\b/.test(name) || isDiff(output);
    if (!isFileWriteTool) continue;
    for (const path of paths) {
      const kind = classifyFileChange(tool, path);
      const key = path;
      changes.set(key, { path, kind, summary: summarizePatch(output), patch: output, tool });
    }
  }
  return [...changes.values()].sort((a, b) => (b.tool.updatedAt || 0) - (a.tool.updatedAt || 0));
}

export function extractToolPaths(tool: ToolCardState): string[] {
  const args: any = tool.args || {};
  const direct = [args.path, args.filePath, args.file_path, args.targetFile, args.relativePath, args.sourcePath, args.destPath, args.destinationPath].filter(Boolean);
  const outputPaths = extractPathsFromText(`${compactToolText(tool.output || "", TOOL_SCAN_TEXT_LIMIT)}\n${compactToolText(toolDiffText(tool) || "", TOOL_SCAN_TEXT_LIMIT)}`);
  return [...new Set([...direct, ...outputPaths].filter((value) => typeof value === "string").map((value) => normalizeChangePath(String(value))).filter(Boolean))];
}

export function extractPathsFromText(text: string): string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(/(?:^|\s)(?:---|\+\+\+)\s+(?:a\/|b\/)?([^\n\r\t]+)/g)) paths.add(match[1].trim());
  for (const match of text.matchAll(/Successfully wrote \d+ bytes to ([^\n\r]+)/gi)) paths.add(match[1].trim());
  for (const match of text.matchAll(/(?:Created|Modified|Updated|Deleted|Wrote|Edited)\s+(?:file\s+)?[`'"]?([^`'"\n]+)[`'"]?/gi)) paths.add(match[1].trim());
  return [...paths];
}

export function normalizeChangePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^[ab]\//, "").replace(/[,.;:)]+$/, "").trim();
}

export function classifyFileChange(tool: ToolCardState, path: string): FileChangeKind {
  const diff = toolDiffText(tool) || "";
  const haystack = `${tool.toolName} ${path} ${compactToolText(tool.output || "", TOOL_SCAN_TEXT_LIMIT)} ${compactToolText(diff, TOOL_SCAN_TEXT_LIMIT)}`.toLowerCase();
  if (/\b(deleted|removed|delete|remove|rm)\b/.test(haystack)) return "deleted";
  if (/\b(created|new file|create|write)\b/.test(haystack) || /---\s+\/dev\/null/.test(diff || tool.output || "")) return "created";
  return "modified";
}

export function summarizePatch(text: string): string {
  if (!text) return "çıktı yok";
  const summary = scanPatchSummary(text);
  if (summary.added || summary.removed) return `+${summary.added} / -${summary.removed}`;
  const first = summary.first || "güncellendi";
  return first.length > 80 ? `${first.slice(0, 77)}…` : first;
}

export function scanPatchSummary(text: string): { added: number; removed: number; first: string } {
  let added = 0;
  let removed = 0;
  let first = "";
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index < text.length && text.charCodeAt(index) !== 10) continue;
    const end = index > start && text.charCodeAt(index - 1) === 13 ? index - 1 : index;
    const line = text.slice(start, end);
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
    if (!first) {
      const trimmed = line.trim();
      if (trimmed) first = trimmed;
    }
    start = index + 1;
  }
  return { added, removed, first };
}

export function parseDiff(text: string) {
  const original: string[] = [];
  const modified: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) modified.push(line.slice(1));
    else if (line.startsWith("-") && !line.startsWith("---")) original.push(line.slice(1));
    else {
      const value = line.startsWith(" ") ? line.slice(1) : line;
      original.push(value);
      modified.push(value);
    }
  }
  return { original: original.join("\n"), modified: modified.join("\n") };
}
