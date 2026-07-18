import type { ToolCardState } from "../state/app-store";
import {
  isBrowserTool as isBrowserToolModel,
  isCommandTool as isCommandToolModel,
  isSearchTool as isSearchToolModel,
  normalizeToolArgs as normalizeToolArgsModel,
  summarizeToolArgs as summarizeToolArgsModel,
  toolArgPath as toolArgPathModel,
  toolContextText as toolContextTextModel,
  toolDetailsText as toolDetailsTextModel,
  toolDiffText as toolDiffTextModel,
  toolDisplayName as toolDisplayNameModel,
  toolMutationKind as toolMutationKindModel,
  toolPreviewText as toolPreviewTextModel,
  toolSortTime as toolSortTimeModel,
} from "./tool-activity";
import { TOOL_SEARCH_TEXT_LIMIT, CHANGE_TOOL_SCAN_LIMIT } from "../constants";
import { statusLabel } from "./format-utils";

export function toolDisplayName(name: string): string {
  return toolDisplayNameModel(name);
}

export function summarizeToolArgs(name: string, args: unknown): string | undefined {
  return summarizeToolArgsModel(name, args, { writeVerb: "create" });
}

export function toolPreviewText(card: ToolCardState): string {
  return toolPreviewTextModel(card);
}

export function toolMutationKind(card: ToolCardState) {
  return toolMutationKindModel(card);
}

export function toolDiffText(card: ToolCardState): string {
  return toolDiffTextModel(card);
}

export function toolDetailsText(card: ToolCardState): string {
  return toolDetailsTextModel(card);
}

export function toolContextText(card: ToolCardState): string {
  return toolContextTextModel(card);
}

export function normalizeToolArgs(value: unknown): unknown {
  return normalizeToolArgsModel(value);
}

export function toolSortTime(tool: ToolCardState): number {
  return toolSortTimeModel(tool);
}

export function isCommandTool(name: string): boolean {
  return isCommandToolModel(name);
}

export function isBrowserTool(name: string): boolean {
  return isBrowserToolModel(name);
}

export function isSearchTool(name: string): boolean {
  return isSearchToolModel(name);
}

export function toolArgPath(args: Record<string, any>): string | undefined {
  return toolArgPathModel(args);
}

export function isPlanProtocolToolName(toolName: unknown): boolean {
  return toolName === "update_plan" || toolName === "request_user_input";
}

/**
 * Changes whenever a streamed tool call's arguments change. The renderer uses
 * this to ignore duplicate assistant snapshots without dropping progressive
 * apply_patch/write payloads whose filename and +/- counts are still growing.
 */
export function toolCallStreamSignature(message: unknown): string {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((part): part is Record<string, unknown> => Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "toolCall"))
    .filter((part) => !isPlanProtocolToolName(part.name ?? part.toolName))
    .map((part, index) => {
      const name = String(part.name ?? part.toolName ?? "tool");
      const id = String(part.id ?? part.toolCallId ?? `${index}:${name}`);
      return `${id}:${name}:${toolArgumentsProgressSignature(part.arguments ?? part.args)}`;
    })
    .join("|");
}

function toolArgumentsProgressSignature(value: unknown): string {
  let serialized = "";
  try {
    const encoded = typeof value === "string" ? value : JSON.stringify(value);
    serialized = encoded ?? "";
  } catch {
    serialized = String(value ?? "");
  }

  // FNV-1a keeps the retained signature tiny while still detecting same-length
  // partial-JSON changes. Updates are already coalesced to one browser frame.
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${serialized.length}:${(hash >>> 0).toString(36)}`;
}

export function compactToolText(value: unknown, limit: number): string {
  const text = String(value || "");
  if (text.length <= limit) return text;
  const edge = Math.max(400, Math.floor(limit / 2));
  return `${text.slice(0, edge)}\n…\n${text.slice(-edge)}`;
}

export function formatToolOutputPreview(output: string): string {
  if (output.trim() === "(no output)") return "Çıktı üretilmedi.";
  const writeMatch = output.match(/^Successfully wrote (\d+) bytes to .+$/m);
  if (writeMatch) return `Yazıldı: ${writeMatch[1]} bayt`;
  return output;
}

export function toolEditArgumentPreview(card: ToolCardState): string | undefined {
  if (toolMutationKind(card) !== "modify") return undefined;
  const args = card.args && typeof card.args === "object" ? card.args as Record<string, any> : {};
  const edits = collectEditReplacements(args);
  if (!edits.length) return undefined;
  const preview: string[] = ["Canlı düzenleme önizlemesi"];
  edits.slice(0, 3).forEach((edit, index) => {
    if (edits.length > 1) preview.push(`@@ değişim ${index + 1}`);
    preview.push(...formatReplacementPreview(edit));
  });
  if (edits.length > 3) preview.push(`… ${edits.length - 3} değişim daha`);
  return preview.join("\n");
}

export function toolWrittenContentPreview(card: ToolCardState): string | undefined {
  const args = card.args && typeof card.args === "object" ? card.args as Record<string, any> : {};
  const raw = args.content ?? args.text ?? args.newText ?? args.new_text ?? args.replacement ?? args.patch;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const title = toolMutationKind(card) === "create" ? "Yazılan içerik" : "Değişen içerik";
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const preview = lines.slice(0, 14).map((line, index) => `${String(index + 1).padStart(2, " ")} | ${line.length > 142 ? `${line.slice(0, 141)}…` : line}`).join("\n");
  return `${title}\n${preview}${lines.length > 14 ? "\n…" : ""}`;
}

export function toolIntentPreview(card: ToolCardState): string | undefined {
  const args = card.args && typeof card.args === "object" ? card.args as Record<string, any> : {};
  if (isCommandTool(card.toolName) && typeof args.command === "string") return `$ ${args.command}`;
  if (isBrowserTool(card.toolName)) return toolBrowserIntentPreview(args);
  if (isSearchTool(card.toolName)) return toolSearchIntentPreview(args);
  if (card.toolName === "read") {
    const path = toolArgPath(args);
    return path ? `Okuma isteği\n${path}` : undefined;
  }
  return undefined;
}

export function toolBrowserIntentPreview(args: Record<string, any>): string | undefined {
  const code = firstStringArg(args, ["code", "script", "function", "fn", "expression"]);
  if (code) return `Tarayıcı kodu\n${previewCodeFragment(code, 12)}`;
  const lines: string[] = [];
  const url = firstStringArg(args, ["url", "href"]);
  const target = firstStringArg(args, ["target", "selector", "element", "text"]);
  const action = firstStringArg(args, ["action", "method", "name"]);
  const file = firstStringArg(args, ["path", "filePath", "file_path", "filename"]);
  if (url) lines.push(`url: ${url}`);
  if (target) lines.push(`hedef: ${target}`);
  if (action) lines.push(`işlem: ${action}`);
  if (file) lines.push(`dosya: ${file}`);
  return lines.length ? `Tarayıcı işlemi\n${lines.map((line) => truncateLine(line, 142)).join("\n")}` : undefined;
}

export function toolSearchIntentPreview(args: Record<string, any>): string | undefined {
  const lines: string[] = [];
  const query = firstStringArg(args, ["pattern", "query", "q", "glob", "needle", "search"]);
  const path = toolArgPath(args);
  const include = firstStringArg(args, ["include", "type", "extension"]);
  const depth = args.maxDepth ?? args.max_depth ?? args.depth;
  if (query) lines.push(`aranan: ${query}`);
  if (path) lines.push(`konum: ${path}`);
  if (include) lines.push(`filtre: ${include}`);
  if (depth !== undefined) lines.push(`derinlik: ${depth}`);
  return lines.length ? `Arama isteği\n${lines.map((line) => truncateLine(line, 142)).join("\n")}` : undefined;
}

export function toolActivePlaceholder(card: ToolCardState): string | undefined {
  if (isCommandTool(card.toolName)) return undefined;
  if (isBrowserTool(card.toolName)) return "Tarayıcı işlemi çalışıyor.";
  if (isSearchTool(card.toolName)) return "Arama çalışıyor.";
  if (card.toolName === "read") return "Dosya okunuyor.";
  const kind = toolMutationKind(card);
  if (kind === "create") return "Dosya oluşturuluyor.";
  if (kind === "modify") return "Dosya düzenleniyor.";
  if (kind === "delete") return "Dosya siliniyor.";
  return "Araç çalışıyor.";
}

export function collectEditReplacements(args: Record<string, any>): Array<{ oldText: string; newText: string }> {
  const edits: Array<{ oldText: string; newText: string }> = [];
  if (Array.isArray(args.edits)) {
    for (const edit of args.edits) {
      if (!edit || typeof edit !== "object") continue;
      const value = edit as Record<string, any>;
      const oldText = textArg(value.oldText ?? value.old_text ?? value.oldString ?? value.old_string);
      const newText = textArg(value.newText ?? value.new_text ?? value.newString ?? value.new_string ?? value.replacement);
      if (oldText !== undefined || newText !== undefined) edits.push({ oldText: oldText || "", newText: newText || "" });
    }
  }
  const oldText = textArg(args.oldText ?? args.old_text ?? args.oldString ?? args.old_string);
  const newText = textArg(args.newText ?? args.new_text ?? args.newString ?? args.new_string ?? args.replacement);
  if (oldText !== undefined || newText !== undefined) edits.push({ oldText: oldText || "", newText: newText || "" });
  return edits;
}

export function formatReplacementPreview(edit: { oldText: string; newText: string }): string[] {
  const oldLines = previewTextLines(edit.oldText);
  const newLines = previewTextLines(edit.newText);
  const lines: string[] = [];
  if (oldLines.length) lines.push(...oldLines.map((line) => `- ${line}`));
  if (newLines.length) lines.push(...newLines.map((line) => `+ ${line}`));
  if (!lines.length) lines.push("+ boş değişiklik");
  return lines.slice(0, 12);
}

export function previewTextLines(value: string): string[] {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const compact = lines.length > 7 ? [...lines.slice(0, 4), "…", ...lines.slice(-2)] : lines;
  return compact.map((line) => truncateLine(line, 142));
}

export function textArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function firstStringArg(args: Record<string, any>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export function previewCodeFragment(code: string, limit: number): string {
  const lines = code.replace(/\r\n/g, "\n").split("\n");
  const visible = lines.slice(0, limit).map((line) => truncateLine(line, 142));
  if (lines.length > limit) visible.push("…");
  return visible.join("\n");
}

export function safeToolJson(value: unknown): string {
  if (value === undefined) return "";
  const seen = new WeakSet<object>();
  try {
    const text = JSON.stringify(value, (_key, entry) => {
      if (typeof entry === "string") return compactToolText(entry, 2_000);
      if (Array.isArray(entry)) return entry.length > 50 ? [...entry.slice(0, 50), `… ${entry.length - 50} öğe gizlendi`] : entry;
      if (entry && typeof entry === "object") {
        if (seen.has(entry)) return "[Döngüsel başvuru]";
        seen.add(entry);
        const fields = Object.entries(entry as Record<string, unknown>);
        if (fields.length > 60) return Object.fromEntries([...fields.slice(0, 60), ["…", `${fields.length - 60} alan gizlendi`]]);
      }
      return entry;
    }, 2);
    return text.length > 1600 ? `${text.slice(0, 1599)}…` : text;
  } catch {
    return String(value || "");
  }
}

export function safeToolScanJson(value: unknown): string {
  if (value === undefined) return "";
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, entry) => {
      if (typeof entry === "string") return compactToolText(entry, 2_000);
      if (Array.isArray(entry)) return entry.length > 50 ? [...entry.slice(0, 50), `… ${entry.length - 50} öğe gizlendi`] : entry;
      if (entry && typeof entry === "object") {
        if (seen.has(entry)) return "[Döngüsel başvuru]";
        seen.add(entry);
        const fields = Object.entries(entry as Record<string, unknown>);
        if (fields.length > 60) return Object.fromEntries([...fields.slice(0, 60), ["…", `${fields.length - 60} alan gizlendi`]]);
      }
      return entry;
    });
  } catch {
    return String(value || "");
  }
}

export function truncateLine(value: string, limit: number): string {
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

const toolSearchTextCache = new WeakMap<ToolCardState, string>();

export function toolSearchText(card: ToolCardState): string {
  const cached = toolSearchTextCache.get(card);
  if (cached !== undefined) return cached;
  const text = [
    toolDisplayName(card.toolName),
    card.toolName,
    statusLabel(card.status),
    card.status,
    card.turnId ? `tur ${card.turnId}` : "",
    summarizeToolArgs(card.toolName, card.args) || "",
    compactToolText(card.output || "", TOOL_SEARCH_TEXT_LIMIT),
    compactToolText(toolDiffText(card) || "", TOOL_SEARCH_TEXT_LIMIT),
  ].join("\n").toLowerCase();
  toolSearchTextCache.set(card, text);
  return text;
}

export function pushRecentToolBounded(selected: ToolCardState[], tool: ToolCardState, limit: number) {
  if (limit <= 0) return;
  if (selected.length < limit) {
    selected.push(tool);
    if (selected.length === limit) selected.sort((a, b) => toolSortTime(b) - toolSortTime(a));
    return;
  }
  const time = toolSortTime(tool);
  if (time <= toolSortTime(selected[selected.length - 1])) return;
  const index = selected.findIndex((item) => time > toolSortTime(item));
  selected.splice(index < 0 ? selected.length : index, 0, tool);
  selected.length = limit;
}

export function selectRecentToolsForChangesFromMap(toolMap: Record<string, ToolCardState>): ToolCardState[] {
  const selected: ToolCardState[] = [];
  for (const id in toolMap) {
    const tool = toolMap[id];
    if (isPlanProtocolToolName(tool.toolName)) continue;
    pushRecentToolBounded(selected, tool, CHANGE_TOOL_SCAN_LIMIT);
  }
  selected.sort((a, b) => toolSortTime(b) - toolSortTime(a));
  return selected;
}
