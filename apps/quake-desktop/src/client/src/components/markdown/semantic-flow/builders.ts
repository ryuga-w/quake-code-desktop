import type { ToolCardState } from "../../../state/app-store";
import type { ToolActivityLocale } from "../../../lib/tool-activity";
import {
  getToolActivity,
  isActiveTool,
  isBrowserTool,
  isCommandTool,
  isReadTool,
  isSubagentTool,
  summarizeToolBatch,
} from "../../../lib/tool-activity";
import type { ToolNoticeHeadline } from "./types";

export function isGenericThinkingFallback(headline: ToolNoticeHeadline): boolean {
  return headline.kind === "thinking"
    && !headline.verb
    && (!headline.subject || headline.subject === "Düşünüyor");
}

export function headlineSignature(headline: ToolNoticeHeadline): string {
  return `${headline.kind}\u0001${headline.verb}\u0001${headline.subject}\u0001${headline.meta || ""}\u0001${headline.live ? "live" : ""}`;
}

export function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

export function buildToolNoticeHeadline(
  tools: ToolCardState[],
  names: string[],
  pending: boolean,
  locale: ToolActivityLocale = "tr",
): ToolNoticeHeadline {
  const text = locale === "en"
    ? {
        creating: "Creating",
        agent: "agent",
        creatingLower: "creating",
        thinking: "Thinking",
        webSearching: "Searching the web",
        processing: "Processing",
        reading: "Reading",
        searching: "Searching",
        editing: "Editing",
        runningCommands: "Running commands",
        browsing: "Browsing",
        active: "active",
        file: "file",
        files: "files",
        search: "search",
        searches: "searches",
        create: "creation",
        edit: "edit",
        delete: "deletion",
        command: "command",
        browser: "browser",
        tool: "tool",
        tools: "tools",
        error: "Tool error",
        ready: "Response ready",
      }
    : {
        creating: "Oluşturuluyor",
        agent: "ajan",
        creatingLower: "oluşturuluyor",
        thinking: "Düşünüyor",
        webSearching: "Web aranıyor",
        processing: "İşleniyor",
        reading: "Okunuyor",
        searching: "Aranıyor",
        editing: "Düzenleniyor",
        runningCommands: "Komutlar çalışıyor",
        browsing: "Geziniyor",
        active: "aktif",
        file: "dosya",
        files: "dosya",
        search: "arama",
        searches: "arama",
        create: "oluşturma",
        edit: "düzenleme",
        delete: "silme",
        command: "komut",
        browser: "tarayıcı",
        tool: "araç",
        tools: "araç",
        error: "Araç hatası",
        ready: "Yanıt hazır",
      };
  const activeTools = pending ? tools.filter(isActiveTool) : [];
  if (activeTools.length > 0 && activeTools.every((tool) => isSubagentTool(tool.toolName))) {
    return {
      kind: "thinking",
      verb: activeTools.length === 1 ? text.creating : `${activeTools.length} ${text.agent}`,
      subject: activeTools.length === 1 ? (locale === "en" ? `an ${text.agent}` : "bir ajan") : text.creatingLower,
      meta: activeTools.length > 1 ? `${activeTools.length} ${text.active}` : undefined,
    };
  }
  // buildConcurrentToolHeadline(activeTools) remains the default Turkish contract;
  // the locale argument keeps the same headline bilingual in the live UI.
  if (activeTools.length > 1) return buildConcurrentToolHeadline(activeTools, locale);
  const activeTool = activeTools[0];
  if (activeTool) {
    const activity = getToolActivity(activeTool, locale);
    const stats = activity.lineStats;
    const delta = [stats.added > 0 ? `+${stats.added}` : "", stats.removed > 0 ? `−${stats.removed}` : ""].filter(Boolean).join(" ");
    if (activity.mutationKind) {
      return {
        kind: "edit",
        verb: activity.actionLabel,
        subject: toolNoticeMutationSubject(activity),
        meta: delta || undefined,
      };
    }
    if (isCommandTool(activeTool.toolName)) return { kind: "command", verb: activity.actionLabel, subject: toolNoticeCommandLabel(activity, locale) };
    if (isReadTool(activeTool.toolName)) return { kind: "read", verb: activity.actionLabel, subject: toolNoticeMutationSubject(activity) };
    if (isWebSearchActivityTool(activeTool.toolName)) return { kind: "search", verb: text.webSearching, subject: activity.subject };
    if (isSearchActivityTool(activeTool.toolName)) return { kind: "search", verb: activity.actionLabel, subject: activity.subject };
    if (isBrowserTool(activeTool.toolName)) return { kind: "browser", verb: activity.actionLabel, subject: activity.subject };
    return { kind: "thinking", verb: activity.actionLabel, subject: activity.subject };
  }
  if (pending) return { kind: "thinking", verb: "", subject: text.thinking, live: true };
  const hasError = tools.some((tool) => tool.status === "error");
  const batch = summarizeToolBatch(tools, names, locale);
  return hasError
    ? { kind: "error", verb: "", subject: batch || text.error }
    : { kind: "summary", verb: "", subject: batch };
}

type ConcurrentToolCounts = {
  reads: number;
  searches: number;
  creates: number;
  edits: number;
  deletes: number;
  commands: number;
  browsers: number;
  other: number;
};

export function buildConcurrentToolHeadline(activeTools: ToolCardState[], locale: ToolActivityLocale = "tr"): ToolNoticeHeadline {
  const text = locale === "en"
    ? { processing: "Processing", reading: "Reading", searching: "Searching", editing: "Editing", runningCommands: "Running commands", browsing: "Browsing", inspecting: "Inspecting", active: "active", file: "files", search: "searches", create: "creations", edit: "edits", delete: "deletions", command: "commands", browser: "browser actions", tool: "tools" }
    : { processing: "İşleniyor", reading: "Okunuyor", searching: "Aranıyor", editing: "Düzenleniyor", runningCommands: "Komutlar çalışıyor", browsing: "Geziniyor", inspecting: "İnceleniyor", active: "aktif", file: "dosya", search: "arama", create: "oluşturma", edit: "düzenleme", delete: "silme", command: "komut", browser: "tarayıcı", tool: "araç" };
  const counts: ConcurrentToolCounts = { reads: 0, searches: 0, creates: 0, edits: 0, deletes: 0, commands: 0, browsers: 0, other: 0 };
  for (const tool of activeTools) {
    const activity = getToolActivity(tool, locale);
    if (activity.mutationKind === "create") counts.creates += 1;
    else if (activity.mutationKind === "modify") counts.edits += 1;
    else if (activity.mutationKind === "delete") counts.deletes += 1;
    else if (isCommandTool(tool.toolName)) counts.commands += 1;
    else if (isReadTool(tool.toolName)) counts.reads += 1;
    else if (isWebSearchActivityTool(tool.toolName) || isSearchActivityTool(tool.toolName)) counts.searches += 1;
    else if (isBrowserTool(tool.toolName)) counts.browsers += 1;
    else counts.other += 1;
  }

  const categories = [counts.reads, counts.searches, counts.creates + counts.edits + counts.deletes, counts.commands, counts.browsers, counts.other].filter((count) => count > 0).length;
  const mutations = counts.creates + counts.edits + counts.deletes;
  let kind: ToolNoticeHeadline["kind"] = "thinking";
  let verb = text.processing;
  if (categories === 1 && counts.reads) { kind = "read"; verb = text.reading; }
  else if (categories === 1 && counts.searches) { kind = "search"; verb = text.searching; }
  else if (categories === 1 && mutations) { kind = "edit"; verb = text.editing; }
  else if (categories === 1 && counts.commands) { kind = "command"; verb = text.runningCommands; }
  else if (categories === 1 && counts.browsers) { kind = "browser"; verb = text.browsing; }
  else if (counts.reads && counts.searches && categories === 2) { kind = "search"; verb = text.inspecting; }
  else if (mutations) kind = "edit";
  else if (counts.commands) kind = "command";
  else if (counts.browsers) kind = "browser";
  else if (counts.searches) kind = "search";
  else if (counts.reads) kind = "read";

  const parts = [
    counts.reads ? `${counts.reads} ${text.file}` : "",
    counts.searches ? `${counts.searches} ${text.search}` : "",
    counts.creates ? `${counts.creates} ${text.create}` : "",
    counts.edits ? `${counts.edits} ${text.edit}` : "",
    counts.deletes ? `${counts.deletes} ${text.delete}` : "",
    counts.commands ? `${counts.commands} ${text.command}` : "",
    counts.browsers ? `${counts.browsers} ${text.browser}` : "",
    counts.other ? `${counts.other} ${text.tool}` : "",
  ].filter(Boolean);

  return {
    kind,
    verb,
    subject: parts.join(" · "),
    // meta: `${activeTools.length} aktif` is the Turkish default contract.
    meta: locale === "en" ? `${activeTools.length} active` : `${activeTools.length} aktif`,
  };
}

export function toolNoticeMutationSubject(activity: ReturnType<typeof getToolActivity>): string {
  const candidates = [activity.panelSubject, activity.subject, activity.argsSummary]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => String(value).replace(/^(reading|okunuyor|yazılıyor|oluşturuluyor|düzenleniyor|siliniyor)\s+/i, "").trim())
    .filter((value) => value && !/^(yeni\s*dosya|new\s*file|dosya|file|unnamed|untitled)$/i.test(value));

  const candidate = candidates[0];
  if (!candidate) return activity.displayName;

  const normalized = candidate.replace(/\\/g, "/");
  const pathish = normalized.match(/((?:[\w.-]+[\\/])*[\w.-]+\.[A-Za-z0-9]{1,12})$/);
  const segment = (pathish?.[1] || normalized).split("/").filter(Boolean).pop() || normalized;
  return segment.length > 56 ? `${segment.slice(0, 55)}…` : segment;
}

export function isWebSearchActivityTool(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "web_search" || normalized === "search_web";
}

export function isSearchActivityTool(name: string): boolean {
  const normalized = name.toLowerCase();
  return ["grep", "find", "ls", "list_dir", "ls_dir", "grep_search"].includes(normalized) || normalized.includes("search") || normalized.includes("glob");
}

export function toolNoticeCommandLabel(activity: ReturnType<typeof getToolActivity>, locale: ToolActivityLocale = "tr"): string {
  const candidate = [activity.subject, activity.argsSummary, activity.panelSubject, activity.displayName].find((value) => typeof value === "string" && value.trim());
  if (!candidate) return locale === "en" ? "Running command" : "Komut çalışıyor";
  return String(candidate).replace(/^\$\s*/, "");
}
