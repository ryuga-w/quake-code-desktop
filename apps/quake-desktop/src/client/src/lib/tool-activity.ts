import { TOOL_SCAN_TEXT_LIMIT } from "../constants";
import type { ToolCardState } from "../state/app-store";

export type ToolMutationKind = "create" | "modify" | "delete" | undefined;
export type ToolActivityLocale = "tr" | "en";

export type ToolLineStats = {
  added: number;
  removed: number;
  filesCreated: number;
  filesDeleted: number;
  kind: ToolMutationKind;
};

export type ToolFileMutation = {
  path: string;
  previousPath?: string;
  kind: Exclude<ToolMutationKind, undefined>;
  added: number;
  removed: number;
};

export type ToolActivity = {
  active: boolean;
  displayName: string;
  argsSummary?: string;
  previewText: string;
  executionPreview: string;
  previewLanguage: string;
  actionLabel: string;
  subject: string;
  panelSubject?: string;
  panelTitle: string;
  resultLabel: string;
  lineStats: ToolLineStats;
  mutationKind: ToolMutationKind;
  sortTime: number;
};

type ToolBatchSummary = {
  total: number;
  commands: number;
  reads: number;
  creates: number;
  edits: number;
  deletes: number;
  searches: number;
  browsers: number;
  createActive: boolean;
  modifyActive: boolean;
  deleteActive: boolean;
};

type SummarizeToolArgsOptions = {
  writeVerb?: "write" | "create";
};

const TOOL_PREVIEW_JSON_LIMIT = 1_600;
const TOOL_PREVIEW_ARG_WIDTH = 142;
/**
 * Inline chat tool bodies. Large values freeze the UI when many tools expand at once
 * (e.g. "18 komut çalıştırıldı") because each line becomes React highlight nodes.
 * Full output remains available via copy / inspect; keep this modest.
 */
const TOOL_BODY_MAX_LINES = 80;
const TOOL_BODY_LINE_WIDTH = 2_400;

const toolActivityCache = new WeakMap<ToolCardState, Map<ToolActivityLocale, ToolActivity>>();
const toolMutationKindCache = new WeakMap<ToolCardState, ToolMutationKind>();
const toolLineStatsCache = new WeakMap<ToolCardState, ToolLineStats>();
const toolFileMutationsCache = new WeakMap<ToolCardState, ToolFileMutation[]>();
const toolExecutionPreviewCache = new WeakMap<ToolCardState, Map<ToolActivityLocale, string>>();
const toolPreviewTextCache = new WeakMap<ToolCardState, Map<ToolActivityLocale, string>>();
const toolPreviewLanguageCache = new WeakMap<ToolCardState, { preview: string; language: string }>();

/**
 * Lightweight activity for list rows / headlines.
 * Does NOT build multi-thousand-line execution previews (those freeze when many
 * tools mount). Call `toolExecutionPreview(tool)` only when a row is expanded.
 */
export function getToolActivity(tool: ToolCardState, locale: ToolActivityLocale = "tr"): ToolActivity {
  const cachedByLocale = toolActivityCache.get(tool);
  const cached = cachedByLocale?.get(locale);
  if (cached) return cached;

  const mutationKind = toolMutationKind(tool);
  // Skip eager full-body preview. language inferred later when body is opened.
  const activity: ToolActivity = {
    active: isActiveTool(tool),
    displayName: toolDisplayName(tool.toolName, locale),
    argsSummary: summarizeToolArgs(tool.toolName, tool.args, {}, locale),
    previewText: toolPreviewText(tool, locale),
    executionPreview: "",
    previewLanguage: "typescript",
    actionLabel: toolRunActionLabel(tool, locale),
    subject: toolRunSubject(tool, locale),
    panelSubject: toolPanelSubject(tool, locale),
    panelTitle: toolPanelTitle(tool, locale),
    resultLabel: toolResultLabel(tool, locale),
    lineStats: toolLineStats(tool),
    mutationKind,
    sortTime: toolSortTime(tool),
  };
  if (cachedByLocale) cachedByLocale.set(locale, activity);
  else toolActivityCache.set(tool, new Map([[locale, activity]]));
  return activity;
}

export function isSubagentTool(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "spawn_agent" || normalized === "agent" || normalized === "spawn_agents_on_csv";
}

/** Tarayıcı adresini sadeleştir: host (+ kısa yol), protokolsüz, 48 karakterde kısaltma. */
export function formatBrowserAddress(raw: string): string {
  const value = String(raw || "").trim();
  const clamp = (text: string) => (text.length > 48 ? `${text.slice(0, 47)}…` : text);
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      const path = url.pathname && url.pathname !== "/" ? url.pathname : "";
      return clamp(`${url.hostname}${path}${url.search}`);
    }
  } catch {
    // URL değilse (tıklama hedefi, tarayıcı kodu vb.) metni olduğu gibi göster.
  }
  return clamp(value);
}

/** Aktif tarayıcı aracından sadeleştirilmiş adresi çöz (yoksa null). */
export function selectActiveBrowserAddress(toolMap: Record<string, ToolCardState>): string | null {
  let latest: ToolCardState | undefined;
  for (const id in toolMap) {
    const tool = toolMap[id];
    if (!isBrowserTool(tool.toolName) || !isActiveTool(tool)) continue;
    if (!latest || (tool.updatedAt || 0) > (latest.updatedAt || 0)) latest = tool;
  }
  if (!latest) return null;
  const args = latest.args && typeof latest.args === "object" ? (latest.args as Record<string, any>) : {};
  const raw = typeof args.url === "string" ? args.url : typeof args.target === "string" ? args.target : "";
  const address = formatBrowserAddress(raw);
  return address || null;
}

/** Full body + language — only for expanded tool cards. */
export function getToolExecutionBody(tool: ToolCardState, locale: ToolActivityLocale = "tr"): { preview: string; language: string } {
  const preview = toolExecutionPreview(tool, locale);
  return { preview, language: inferToolPreviewLanguage(tool, preview, locale) };
}

export function toolDisplayName(name: string, locale: ToolActivityLocale = "tr"): string {
  const map: Record<string, string> = {
    read: "Dosya okuma",
    read_file: "Dosya okuma",
    view_file: "Dosya okuma",
    bash: "Terminal komutu",
    run_command: "Terminal komutu",
    edit: "Dosya düzenleme",
    replace_file_content: "Dosya düzenleme",
    multi_replace_file_content: "Dosya düzenleme",
    write: "Dosya oluşturma",
    write_to_file: "Dosya oluşturma",
    write_file: "Dosya oluşturma",
    create_file: "Dosya oluşturma",
    grep: "Metin arama",
    grep_search: "Metin arama",
    find: "Dosya arama",
    ls: "Klasör listeleme",
    list_dir: "Klasör listeleme",
    apply_patch: "Değişiklik uygulama",
    spawn_agent: "Subagent",
    agent: "Subagent",
    spawn_agents_on_csv: "Subagent grubu",
    create_scheduled_task: "Zamanlanmış görev oluşturma",
    schedule_task: "Zamanlanmış görev oluşturma",
    file_search: "Dosya arama",
    list_directory: "Klasör listeleme",
  };
  if (locale === "en") {
    const englishMap: Record<string, string> = {
      read: "File read",
      read_file: "File read",
      view_file: "File read",
      bash: "Terminal command",
      run_command: "Terminal command",
      edit: "File edit",
      replace_file_content: "File edit",
      multi_replace_file_content: "File edit",
      write: "File creation",
      write_to_file: "File creation",
      write_file: "File creation",
      create_file: "File creation",
      grep: "Text search",
      grep_search: "Text search",
      find: "File search",
      ls: "Directory listing",
      list_dir: "Directory listing",
      apply_patch: "Apply changes",
      spawn_agent: "Subagent",
      agent: "Subagent",
      spawn_agents_on_csv: "Subagent group",
      create_scheduled_task: "Scheduled task creation",
      schedule_task: "Scheduled task creation",
      file_search: "File search",
      list_directory: "Directory listing",
    };
    if (isBrowserTool(name)) return "Browser action";
    return englishMap[name] || name;
  }
  if (isBrowserTool(name)) return "Tarayıcı işlemi";
  return map[name] || name;
}

/** Compact NOUN-phrase label for a Quake Chrome Bridge (chrome_*) call header.
 *  The UI already prepends a status verb ("Çalıştırıldı" / "Çalışıyor"), so this
 *  must be a short target/object — never a verb like "...yorum". */
function summarizeChromeArgs(name: string, value: Record<string, any>, locale: ToolActivityLocale): string | undefined {
  const en = locale === "en";
  const n = name.toLowerCase();
  const cleanSel = (s: unknown): string => {
    const str = String(s ?? "").trim();
    return (str.startsWith("text=") ? str.slice(5) : str).slice(0, 60);
  };
  if (n === "chrome_click") {
    const sel = cleanSel(value.selector);
    return sel ? `“${sel}”` : en ? "element" : "öğe";
  }
  if (n === "chrome_type") {
    const txt = String(value.text ?? "").slice(0, 40);
    return txt ? `“${txt}”` : en ? "text input" : "metin";
  }
  if (n === "chrome_fill_form") {
    const count = value.fields && typeof value.fields === "object" ? Object.keys(value.fields).length : 0;
    return en ? `form (${count} fields)` : `form (${count} alan)`;
  }
  if (n === "chrome_scroll") return en ? "page scroll" : "sayfa kaydırma";
  if (n === "chrome_navigate" || n === "chrome_open_tab") {
    const url = String(value.url ?? "").slice(0, 80);
    return url || undefined;
  }
  if (n === "chrome_run_js") return en ? "page script" : "sayfa scripti";
  if (n === "chrome_get_page_content") return en ? "page content" : "sayfa içeriği";
  if (n === "chrome_screenshot") return en ? "screenshot" : "ekran görüntüsü";
  if (n === "chrome_create_group") {
    const title = String(value.title ?? "").slice(0, 40);
    return title ? `${en ? "group" : "grup"}: “${title}”` : en ? "tab group" : "sekme grubu";
  }
  if (n === "chrome_close_my_groups") return en ? "group cleanup" : "grup temizliği";
  if (n === "chrome_list_tabs") return en ? "tab list" : "sekme listesi";
  if (n === "chrome_list_groups") return en ? "group list" : "grup listesi";
  if (n === "chrome_activate_tab") return en ? "switch tab" : "sekme geçişi";
  if (n === "chrome_bridge_status") return en ? "bridge status" : "köprü durumu";
  if (n === "chrome_close_tab") return en ? "close tab" : "sekme kapatma";
  if (n === "chrome_reload_tab") return en ? "reload tab" : "sekme yenileme";
  if (n === "chrome_ungroup") return en ? "ungroup" : "grup çözme";
  if (n === "chrome_set_group_color") return en ? "group color" : "grup rengi";
  if (n === "chrome_set_group_title") return en ? "group title" : "grup başlığı";
  if (n === "chrome_add_tabs_to_group") return en ? "add to group" : "gruba ekleme";
  if (n === "chrome_my_color") return en ? "my color" : "rengim";
  // Fallback for any other chrome_* tool: empty, never show tabId.
  return "";
}

export function summarizeToolArgs(name: string, args: unknown, options: SummarizeToolArgsOptions = {}, locale: ToolActivityLocale = "tr"): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const value = args as Record<string, any>;
  const path = toolArgPath(value);
  const writeVerb = options.writeVerb === "create" ? "Oluşturuluyor" : "Yazılıyor";
  // Quake Chrome Bridge tools: show a meaningful action summary (selector / text
  // / url) instead of the raw "tabId: 12345" that the generic branch would pick.
  if (name.toLowerCase().startsWith("chrome_")) {
    const chromeSummary = summarizeChromeArgs(name, value, locale);
    if (chromeSummary !== undefined) return chromeSummary;
  }
  if (isSubagentTool(name)) {
    const prompt = value.message ?? value.prompt ?? value.description;
    return prompt ? `${locale === "en" ? "Input" : "Girdi"}: ${truncateOneLine(String(prompt), 118)}` : undefined;
  }
  if (isCommandTool(name)) {
    const cmd = value.command ?? value.CommandLine;
    return cmd ? `$ ${String(cmd).slice(0, 140)}` : undefined;
  }
  if (isSearchTool(name)) {
    const query = value.query ?? value.pattern ?? value.glob;
    if (typeof query === "string" && query.trim()) {
      return `${locale === "en" ? "Searching" : "Aranıyor"} “${truncateOneLine(query, 118)}”`;
    }
  }
  if (isReadTool(name)) return path ? `${locale === "en" ? "Reading" : "Okunuyor"} ${shortPath(path)}` : undefined;
  if (isWriteTool(name)) return path ? `${locale === "en" ? (options.writeVerb === "create" ? "Creating" : "Writing") : writeVerb} ${shortPath(path)}` : undefined;
  if (isEditTool(name)) return path ? `${locale === "en" ? "Editing" : "Düzenleniyor"} ${shortPath(path)}` : undefined;
  if (isBrowserTool(name)) return value.url ? String(value.url).slice(0, 140) : value.target ? `${locale === "en" ? "Target" : "Hedef"}: ${String(value.target).slice(0, 80)}` : undefined;
  if (path) return shortPath(path);
  const first = Object.entries(value).find(([, entry]) => typeof entry === "string" || typeof entry === "number");
  return first ? `${first[0]}: ${String(first[1]).slice(0, 120)}` : undefined;
}

export function summarizeToolBatch(tools: ToolCardState[], fallbackNames: string[], locale: ToolActivityLocale = "tr"): string {
  const text = locale === "en"
    ? {
        agent: "agent",
        creating: "creating",
        created: "created",
        fileCreated: "file created",
        fileEdited: "file edited",
        fileDeleted: "file removed",
        fileRead: "file read",
        searchDone: "search performed",
        browser: "browser action",
        operation: "operation",
        operationsRun: "operations run",
        command: "command",
        commands: "commands",
      }
    : {
        agent: "ajan",
        creating: "oluşturuluyor",
        created: "oluşturuldu",
        fileCreated: "dosya oluşturuldu",
        fileEdited: "dosya düzenlendi",
        fileDeleted: "dosya kaldırıldı",
        fileRead: "dosya okundu",
        searchDone: "arama yapıldı",
        browser: "tarayıcı işlemi",
        operation: "işlem",
        operationsRun: "işlem çalıştırıldı",
        command: "komut",
        commands: "komutlar",
      };
  if (tools.length > 0 && tools.every((tool) => isSubagentTool(tool.toolName))) {
    const active = tools.some(isActiveTool);
    return `${tools.length} ${text.agent} ${active ? text.creating : text.created}`;
  }
  const summary = collectToolBatchSummary(tools, fallbackNames);
  const total = Math.max(1, summary.total || fallbackNames.length || 1);
  const categories: Array<{ count: number; label: string }> = [];
  if (summary.commands) categories.push({ count: summary.commands, label: summary.commands === 1 ? text.command : text.commands });
  if (summary.creates) categories.push({ count: summary.creates, label: text.fileCreated });
  if (summary.edits) categories.push({ count: summary.edits, label: text.fileEdited });
  if (summary.deletes) categories.push({ count: summary.deletes, label: text.fileDeleted });
  if (summary.reads) categories.push({ count: summary.reads, label: text.fileRead });
  if (summary.searches) categories.push({ count: summary.searches, label: text.searchDone });
  if (summary.browsers) categories.push({ count: summary.browsers, label: text.browser });

  const known = summary.creates + summary.edits + summary.deletes + summary.commands + summary.reads + summary.searches + summary.browsers;
  const other = Math.max(0, total - known);

  // One category owns the whole batch → single clean line ("10 komut çalıştırıldı").
  if (categories.length === 1 && other === 0) {
    const only = categories[0];
    if (summary.commands) return locale === "en" ? `Ran ${only.count} ${only.label}` : `${only.count} ${only.label} çalıştırıldı`;
    return `${only.count} ${only.label}`;
  }

  // Unclassified tools only (e.g. update_plan) → neutral count, not "X araç kullanıldı".
  if (categories.length === 0) {
    return total === 1 ? `1 ${text.operationsRun}` : `${total} ${text.operationsRun}`;
  }

  // Mixed kinds: prefer one total when many steps, else short category list.
  if (other > 0 || categories.length >= 3 || total >= 8) {
    return `${total} ${text.operationsRun}`;
  }

  const parts = categories.map((item) => `${item.count} ${item.label}`);
  if (other) parts.push(`${other} ${text.operation}`);
  return parts.join(" · ");
}

export function toolMutationKind(tool: ToolCardState): ToolMutationKind {
  const cached = toolMutationKindCache.get(tool);
  if (cached !== undefined) return cached;

  const name = tool.toolName.toLowerCase();
  const isFileMutationTool = ["write", "edit", "apply_patch"].includes(name) || isWriteTool(name) || isEditTool(name) || /\b(patch|delete|remove|rm)\b/.test(name);
  if (!isFileMutationTool) {
    toolMutationKindCache.set(tool, undefined);
    return undefined;
  }

  const args = (tool.args || {}) as Record<string, any>;
  const output = String(tool.output || "");
  const diff = toolDiffText(tool);
  const haystack = [
    name,
    safeToolScanJson(args),
    compactToolText(output, TOOL_SCAN_TEXT_LIMIT),
    compactToolText(diff, TOOL_SCAN_TEXT_LIMIT),
  ].join("\n").toLowerCase();

  const explicitOperation = String(args.operation ?? args.action ?? args.mode ?? "").toLowerCase();
  const isExplicitDelete = /\b(delete|remove|rm)\b/.test(name)
    || /^(delete|remove|rm)$/.test(explicitOperation)
    || /\+\+\+\s+(?:[ab]\/)?\/dev\/null/.test(diff);

  const kind = isExplicitDelete
    ? "delete"
    : name === "write" || isWriteTool(name) || /successfully wrote \d+ bytes to/i.test(output) || /---\s+\/dev\/null/.test(diff) || /\b(add file|new file|created|create)\b/.test(haystack)
      ? "create"
      : ["edit", "apply_patch"].includes(name) || isEditTool(name) || /\b(edit|patch|modified|updated)\b/.test(haystack) || diff.trim()
        ? "modify"
        : undefined;

  toolMutationKindCache.set(tool, kind);
  return kind;
}

export function toolLineStats(tool: ToolCardState): ToolLineStats {
  const cached = toolLineStatsCache.get(tool);
  if (cached) return cached;

  const kind = toolMutationKind(tool);
  if (!kind) {
    const stats = { added: 0, removed: 0, filesCreated: 0, filesDeleted: 0, kind };
    toolLineStatsCache.set(tool, stats);
    return stats;
  }

  const args = (tool.args || {}) as Record<string, any>;
  const diffStats = diffLineStats(toolDiffText(tool));
  const editArgStats = editArgumentLineStats(args);
  const written = writtenContentLineCount(args);

  const stats = kind === "create"
    ? { added: diffStats.added || written, removed: 0, filesCreated: 1, filesDeleted: 0, kind }
    : kind === "delete"
      ? { added: 0, removed: diffStats.removed || editArgStats.removed, filesCreated: 0, filesDeleted: 1, kind }
      : {
          added: diffStats.added || editArgStats.added || replacementLineCount(args),
          removed: diffStats.removed || editArgStats.removed,
          filesCreated: 0,
          filesDeleted: 0,
          kind,
        };

  toolLineStatsCache.set(tool, stats);
  return stats;
}

export function toolFileMutations(tool: ToolCardState): ToolFileMutation[] {
  const cached = toolFileMutationsCache.get(tool);
  if (cached) return cached;

  let mutations: ToolFileMutation[] = [];

  // Structured apply_patch / write tool details (Codex FileChange summary path)
  mutations = parseStructuredMutationDetails(tool);
  if (!mutations.length) {
    for (const candidate of mutationPatchCandidates(tool)) {
      mutations = parseApplyPatchMutations(candidate);
      if (!mutations.length) mutations = parseUnifiedDiffMutations(candidate);
      if (mutations.length) break;
    }
  }

  if (!mutations.length) {
    mutations = parseMutationResultLines(String(tool.output || ""));
  }

  if (!mutations.length) {
    const kind = toolMutationKind(tool);
    const path = resolveToolFilePath(tool);
    if (kind && path) {
      const stats = toolLineStats(tool);
      mutations = [{
        path: normalizeMutationPath(path),
        kind,
        added: stats.added,
        removed: stats.removed,
      }];
    }
  }

  const merged = mergeFileMutations(mutations);
  toolFileMutationsCache.set(tool, merged);
  return merged;
}

/** Parse apply_patch execute details: { added, updated, deleted, moved } + edit details.diff */
function parseStructuredMutationDetails(tool: ToolCardState): ToolFileMutation[] {
  const details = tool.details;
  if (!details || typeof details !== "object") return [];
  const d = details as Record<string, unknown>;
  const out: ToolFileMutation[] = [];

  const pushList = (list: unknown, kind: ToolFileMutation["kind"]) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      const path = normalizeMutationPath(String(entry || ""));
      if (!path) continue;
      out.push({ path, kind, added: kind === "create" ? 1 : 0, removed: kind === "delete" ? 1 : 0 });
    }
  };

  // Preferred: per-file stats from apply_patch tool details.files
  if (Array.isArray(d.files)) {
    for (const entry of d.files) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as {
        path?: unknown;
        kind?: unknown;
        added?: unknown;
        removed?: unknown;
        previousPath?: unknown;
      };
      const path = normalizeMutationPath(String(e.path || ""));
      if (!path) continue;
      const kindRaw = String(e.kind || "modify");
      const kind: ToolFileMutation["kind"] =
        kindRaw === "create" || kindRaw === "delete" ? kindRaw : "modify";
      out.push({
        path,
        kind,
        added: Number(e.added) || 0,
        removed: Number(e.removed) || 0,
        previousPath: e.previousPath ? normalizeMutationPath(String(e.previousPath)) : undefined,
      });
    }
    if (out.length) return out;
  }

  pushList(d.added, "create");
  pushList(d.updated, "modify");
  pushList(d.deleted, "delete");

  if (Array.isArray(d.moved)) {
    for (const entry of d.moved) {
      if (!entry || typeof entry !== "object") continue;
      const to = normalizeMutationPath(String((entry as { to?: unknown }).to || ""));
      const from = normalizeMutationPath(String((entry as { from?: unknown }).from || ""));
      if (!to) continue;
      out.push({ path: to, previousPath: from || undefined, kind: "modify", added: 0, removed: 0 });
    }
  }

  if (typeof d.diff === "string" && d.diff.trim()) {
    const fromDiff = parseUnifiedDiffMutations(d.diff);
    if (fromDiff.length) return fromDiff;
    const stats = countDiffLinesSimple(d.diff);
    const path = resolveToolFilePath(tool);
    if (path && (stats.added || stats.removed)) {
      out.push({ path: normalizeMutationPath(path), kind: "modify", ...stats });
    }
  }

  return out;
}

function countDiffLinesSimple(text: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

export function toolRunActionLabel(tool: ToolCardState, locale: ToolActivityLocale = "tr"): string {
  const labels = locale === "en"
    ? {
        creating: "Creating",
        created: "Created",
        runningCommand: "Running command",
        commandFailed: "Command failed",
        ran: "Ran",
        reading: "Reading",
        readFailed: "Read failed",
        read: "Read",
        deleting: "Deleting",
        deleted: "Deleted",
        editing: "Editing",
        edited: "Edited",
        searching: "Searching",
        searched: "Searched",
        browser: "Browser",
        working: "Working",
        worked: "Completed",
        failed: "Failed",
      }
    : {
        creating: "Oluşturuluyor",
        created: "Oluşturuldu",
        runningCommand: "Komut çalışıyor",
        commandFailed: "Komut başarısız",
        ran: "Çalıştı",
        reading: "Okunuyor",
        readFailed: "Okuma başarısız",
        read: "Okundu",
        deleting: "Kaldırılıyor",
        deleted: "Kaldırıldı",
        editing: "Düzenleniyor",
        edited: "Düzenlendi",
        searching: "Aranıyor",
        searched: "Arandı",
        browser: "Tarayıcı",
        working: "Çalışıyor",
        worked: "Çalıştı",
        failed: "Başarısız",
      };

  // Quake Chrome Bridge tools narrate in first person via the subject itself
  // ("sekme listesindeyim"), so they carry no separate action verb.
  if (tool.toolName.toLowerCase().startsWith("chrome_")) {
    if (tool.status === "error") return labels.failed;
    return "";
  }
  // update_plan / request_user_input also narrate via the subject only.
  if (tool.toolName === "update_plan" || tool.toolName === "request_user_input") {
    if (tool.status === "error") return labels.failed;
    return "";
  }
  if (isSubagentTool(tool.toolName)) return pastStatus(tool, labels.creating, labels.created, labels.failed);
  if (isCommandTool(tool.toolName)) {
    if (isActiveTool(tool)) return labels.runningCommand;
    if (tool.status === "error") return labels.commandFailed;
    return labels.ran;
  }
  if (isReadTool(tool.toolName)) {
    if (isActiveTool(tool)) return labels.reading;
    if (tool.status === "error") return labels.readFailed;
    return labels.read;
  }

  const kind = toolMutationKind(tool);
  if (kind === "create") return pastStatus(tool, labels.creating, labels.created, labels.failed);
  if (kind === "delete") return pastStatus(tool, labels.deleting, labels.deleted, labels.failed);
  if (kind === "modify") return pastStatus(tool, labels.editing, labels.edited, labels.failed);
  if (isSearchTool(tool.toolName)) return pastStatus(tool, labels.searching, labels.searched, labels.failed);
  if (isBrowserTool(tool.toolName)) return pastStatus(tool, labels.browser, labels.browser, labels.failed);
  return pastStatus(tool, labels.working, labels.worked, labels.failed);
}

/** First-person, tense-aware narration for a Quake Chrome Bridge tool row.
 *  active  → present continuous ("sayfayı kaydırıyorum")
 *  done    → completed ("sayfayı kaydırdım") */
function chromeFirstPersonPhrase(tool: ToolCardState, locale: ToolActivityLocale): string {
  const en = locale === "en";
  const n = tool.toolName.toLowerCase();
  const active = isActiveTool(tool);
  const args = asToolArgsRecord(tool.args);
  const sel = (() => {
    const s = String(args.selector ?? "").trim();
    return (s.startsWith("text=") ? s.slice(5) : s).slice(0, 50);
  })();
  const txt = String(args.text ?? "").slice(0, 40);
  const url = String(args.url ?? "").slice(0, 70);
  // pair: [present-continuous, completed]
  const P = (ing: string, done: string) => (active ? ing : done);
  switch (n) {
    case "chrome_click":
      return sel
        ? (en ? P(`clicking “${sel}”`, `clicked “${sel}”`) : P(`“${sel}” öğesine tıklıyorum`, `“${sel}” öğesine tıkladım`))
        : (en ? P("clicking", "clicked") : P("tıklıyorum", "tıkladım"));
    case "chrome_type":
      return txt
        ? (en ? P(`typing “${txt}”`, `typed “${txt}”`) : P(`“${txt}” yazıyorum`, `“${txt}” yazdım`))
        : (en ? P("typing", "typed") : P("yazıyorum", "yazdım"));
    case "chrome_fill_form": {
      const count = args.fields && typeof args.fields === "object" ? Object.keys(args.fields).length : 0;
      return en ? P(`filling the form (${count})`, `filled the form (${count})`) : P(`formu dolduruyorum (${count} alan)`, `formu doldurdum (${count} alan)`);
    }
    case "chrome_scroll":
      return en ? P("scrolling the page", "scrolled the page") : P("sayfayı kaydırıyorum", "sayfayı kaydırdım");
    case "chrome_navigate":
      return url ? (en ? P(`opening ${url}`, `opened ${url}`) : P(`${url} açıyorum`, `${url} açtım`)) : (en ? P("navigating", "navigated") : P("sayfaya gidiyorum", "sayfaya gittim"));
    case "chrome_open_tab":
      return url ? (en ? P(`opening ${url}`, `opened ${url}`) : P(`${url} açıyorum`, `${url} açtım`)) : (en ? P("opening a tab", "opened a tab") : P("sekme açıyorum", "sekme açtım"));
    case "chrome_run_js":
      return en ? P("running a page script", "ran a page script") : P("sayfada script çalıştırıyorum", "sayfada script çalıştırdım");
    case "chrome_get_page_content":
      return en ? P("reading the page", "read the page") : P("sayfayı okuyorum", "sayfayı okudum");
    case "chrome_screenshot":
      return en ? P("taking a screenshot", "took a screenshot") : P("ekran görüntüsü alıyorum", "ekran görüntüsü aldım");
    case "chrome_list_tabs":
      return en ? P("listing tabs", "listed tabs") : P("sekme listesindeyim", "sekmeleri listeledim");
    case "chrome_list_groups":
      return en ? P("listing groups", "listed groups") : P("grupları listeliyorum", "grupları listeledim");
    case "chrome_create_group": {
      const title = String(args.title ?? "").slice(0, 40);
      const suffix = title ? `: “${title}”` : "";
      return en ? P(`grouping tabs${suffix}`, `grouped tabs${suffix}`) : P(`sekmeleri grupluyorum${suffix}`, `sekmeleri grupladım${suffix}`);
    }
    case "chrome_close_my_groups":
      return en ? P("cleaning up my groups", "cleaned up my groups") : P("grubu temizliyorum", "grubu temizledim");
    case "chrome_ungroup":
      return en ? P("ungrouping", "ungrouped") : P("grubu çözüyorum", "grubu çözdüm");
    case "chrome_activate_tab":
      return en ? P("switching tab", "switched tab") : P("sekmeye geçiyorum", "sekmeye geçtim");
    case "chrome_close_tab":
      return en ? P("closing tab", "closed tab") : P("sekmeyi kapatıyorum", "sekmeyi kapattım");
    case "chrome_reload_tab":
      return en ? P("reloading tab", "reloaded tab") : P("sekmeyi yeniliyorum", "sekmeyi yeniledim");
    case "chrome_set_group_color":
      return en ? P("setting group color", "set group color") : P("grup rengini ayarlıyorum", "grup rengini ayarladım");
    case "chrome_set_group_title":
      return en ? P("setting group title", "set group title") : P("grup başlığını ayarlıyorum", "grup başlığını ayarladım");
    case "chrome_add_tabs_to_group":
      return en ? P("adding tabs to group", "added tabs to group") : P("sekmeleri gruba ekliyorum", "sekmeleri gruba ekledim");
    case "chrome_bridge_status":
      return en ? P("checking bridge status", "checked bridge status") : P("köprü durumuna bakıyorum", "köprü durumuna baktım");
    case "chrome_my_color":
      return en ? P("checking my color", "checked my color") : P("rengime bakıyorum", "rengime baktım");
    default:
      return truncateOneLine(toolDisplayName(tool.toolName, locale), 60);
  }
}

export function toolRunSubject(tool: ToolCardState, locale: ToolActivityLocale = "tr"): string {
  if (isSubagentTool(tool.toolName)) return locale === "en" ? "an agent" : "bir ajan";
  // Quake Chrome Bridge tools: first-person narration ("sekme listesindeyim"),
  // tense-aware, and never let the generic file-path scanner mistake output
  // words (e.g. "by") for a path.
  if (tool.toolName.toLowerCase().startsWith("chrome_")) {
    return truncateOneLine(chromeFirstPersonPhrase(tool, locale), 122);
  }
  // Plan / user-input tools: clean first-person narration instead of raw args.
  if (tool.toolName === "update_plan") {
    const active = isActiveTool(tool);
    const planArgs = asToolArgsRecord(tool.args);
    const steps = Array.isArray(planArgs.plan) ? planArgs.plan.length : 0;
    const done = Array.isArray(planArgs.plan)
      ? (planArgs.plan as Array<{ status?: string }>).filter((s) => s && s.status === "completed").length
      : 0;
    const suffix = steps ? ` (${done}/${steps})` : "";
    return locale === "en" ? (active ? `updating the plan${suffix}` : `updated the plan${suffix}`) : (active ? `planı güncelliyorum${suffix}` : `planı güncelledim${suffix}`);
  }
  if (tool.toolName === "request_user_input") {
    const active = isActiveTool(tool);
    return locale === "en" ? (active ? "asking you" : "asked you") : (active ? "sana soruyorum" : "sana sordum");
  }
  const args = asToolArgsRecord(tool.args);
  const cmd = args.command ?? args.CommandLine;
  if (isCommandTool(tool.toolName) && cmd) return truncateOneLine(String(cmd), 122);

  const path = resolveToolFilePath(tool);
  if (path) return truncateOneLine(path, 122);

  const kind = toolMutationKind(tool);
  if (kind === "create" || kind === "modify" || isReadTool(tool.toolName)) {
    // Gerçek ad yoksa generic "yeni dosya" gösterme — araç adını tercih et.
    return truncateOneLine(toolDisplayName(tool.toolName, locale), 122);
  }

  const summary = summarizeToolArgs(tool.toolName, tool.args, {}, locale);
  return truncateOneLine(summary || tool.toolName, 122);
}

export function toolPanelSubject(tool: ToolCardState, locale: ToolActivityLocale = "tr"): string | undefined {
  if (isSubagentTool(tool.toolName)) {
    const details = tool.details && typeof tool.details === "object" ? tool.details as Record<string, any> : {};
    return truncateOneLine(String(details.nickname || details.agent_id || details.agentId || "").trim(), 96) || undefined;
  }
  const path = resolveToolFilePath(tool);
  if (path) return shortPath(path);

  const args = asToolArgsRecord(tool.args);
  const cmd = args.command ?? args.CommandLine;
  if (isCommandTool(tool.toolName) && cmd) return truncateOneLine(String(cmd), 96);
  return undefined;
}

/** Dosya yolu: args / output / details / diff — ilk geçerli aday. */
export function resolveToolFilePath(tool: ToolCardState): string | undefined {
  const args = asToolArgsRecord(tool.args);
  const fromArgs = toolArgPath(args);
  if (fromArgs) return fromArgs;

  const fromOutput = extractWrittenPath(tool.output);
  if (fromOutput) return fromOutput;

  const detailsText = toolDetailsText(tool);
  const fromDetails = extractWrittenPath(detailsText);
  if (fromDetails) return fromDetails;

  const fromDiff = extractPathFromDiff(toolDiffText(tool));
  if (fromDiff) return fromDiff;

  // Args JSON string veya dağınık metin içinde path ara
  const scanned = extractPathFromLooseText([
    typeof tool.args === "string" ? tool.args : safeToolScanJson(args),
    tool.output,
    detailsText,
  ].filter(Boolean).join("\n"));
  return scanned;
}

export function toolPanelTitle(tool: ToolCardState, locale: ToolActivityLocale = "tr"): string {
  if (isSubagentTool(tool.toolName)) return "Subagent";
  if (isCommandTool(tool.toolName)) return locale === "en" ? "Command" : "Komut";
  if (isReadTool(tool.toolName)) return locale === "en" ? "File" : "Dosya";

  const kind = toolMutationKind(tool);
  if (kind === "create") return locale === "en" ? "New file" : "Yeni dosya";
  if (kind === "delete") return locale === "en" ? "Delete" : "Silme";
  if (kind === "modify") return locale === "en" ? "File change" : "Dosya değişikliği";
  if (isBrowserTool(tool.toolName)) return locale === "en" ? "Browser" : "Tarayıcı";
  if (isSearchTool(tool.toolName)) return locale === "en" ? "Search" : "Arama";
  return locale === "en" ? "Tool" : "Araç";
}

export function toolExecutionPreview(tool: ToolCardState, locale: ToolActivityLocale = "tr"): string {
  const cachedByLocale = toolExecutionPreviewCache.get(tool);
  const cached = cachedByLocale?.get(locale);
  if (cached !== undefined) return cached;

  const args = (tool.args || {}) as Record<string, any>;
  const previewLines: string[] = [];
  const argPath = toolArgPath(args);
  const outputPath = extractWrittenPath(tool.output);
  const previewPath = argPath || outputPath;
  const cmd = args.command ?? args.CommandLine;
  const commandPreview = isCommandTool(tool.toolName) && cmd ? `$ ${String(cmd)}` : undefined;
  const duplicatePreviewLead = commandPreview || previewPath;

  // Kimlik (komut/dosya yolu) kart başlığında zaten var. Gövde: okunan/yazılan/diff
  // mümkün olduğunca tam; UI max-height + scroll ile sınırlanır.
  const outputPreview = boundedToolOutputPreview(stripLeadingDuplicatePreviewLead(String(tool.output || ""), duplicatePreviewLead), locale);
  if (outputPreview) appendPreviewBlock(previewLines, outputPreview, TOOL_BODY_MAX_LINES, TOOL_BODY_LINE_WIDTH);

  const patchPreview = toolPatchPreview(tool, locale);
  if (patchPreview) appendPreviewBlock(previewLines, patchPreview, TOOL_BODY_MAX_LINES, TOOL_BODY_LINE_WIDTH);

  const editPreview = toolEditArgumentPreview(tool, locale);
  if (editPreview) appendPreviewBlock(previewLines, editPreview, TOOL_BODY_MAX_LINES, TOOL_BODY_LINE_WIDTH);

  const contentPreview = toolWrittenContentPreview(tool, locale);
  if (contentPreview) appendPreviewBlock(previewLines, contentPreview, TOOL_BODY_MAX_LINES, TOOL_BODY_LINE_WIDTH);

  const intentPreview = toolIntentPreview(tool, locale);
  if (!outputPreview && !patchPreview && !editPreview && !contentPreview && intentPreview) {
    appendPreviewBlock(previewLines, intentPreview, TOOL_BODY_MAX_LINES, TOOL_BODY_LINE_WIDTH);
  }

  const hasInlinePreview = Boolean(outputPreview || patchPreview || editPreview || contentPreview || intentPreview);
  if (!previewLines.length && tool.args) appendPreviewBlock(previewLines, toolArgumentsPreview(tool, locale), TOOL_BODY_MAX_LINES, TOOL_BODY_LINE_WIDTH);
  else if (!hasInlinePreview && isActiveTool(tool)) appendPreviewBlock(previewLines, toolActivePlaceholder(tool, locale), 24, TOOL_PREVIEW_ARG_WIDTH);
  else if (toolMutationKind(tool) === "create") appendPreviewBlock(previewLines, locale === "en" ? "File created." : "Dosya oluşturuldu.", 4, TOOL_PREVIEW_ARG_WIDTH);
  else if (toolMutationKind(tool) === "modify") appendPreviewBlock(previewLines, locale === "en" ? "File change completed." : "Dosya değişikliği tamamlandı.", 4, TOOL_PREVIEW_ARG_WIDTH);
  else if (isReadTool(tool.toolName)) appendPreviewBlock(previewLines, locale === "en" ? "File read." : "Dosya okundu.", 4, TOOL_PREVIEW_ARG_WIDTH);

  const preview = previewLines.join("\n") || (isActiveTool(tool) && isCommandTool(tool.toolName) ? "" : locale === "en" ? "No output" : "Çıktı yok");
  if (cachedByLocale) cachedByLocale.set(locale, preview);
  else toolExecutionPreviewCache.set(tool, new Map([[locale, preview]]));
  return preview;
}

export function inferToolPreviewLanguage(tool: ToolCardState, preview?: string, locale: ToolActivityLocale = "tr"): string {
  const resolvedPreview = preview ?? toolExecutionPreview(tool, locale);
  const cached = toolPreviewLanguageCache.get(tool);
  if (cached?.preview === resolvedPreview) return cached.language;

  let language = "typescript";
  const args = (tool.args || {}) as Record<string, any>;
  if (isCommandTool(tool.toolName)) language = "shell";
  else if (isBrowserTool(tool.toolName) && /Tarayıcı kodu|Browser code|function|await|document\.|locator|page\./.test(resolvedPreview)) language = "typescript";
  else {
    const path = String(toolArgPath(args) || extractWrittenPath(tool.output) || "");
    const extension = path.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
    const languageByExtension: Record<string, string> = {
      css: "css",
      htm: "html",
      html: "html",
      js: "typescript",
      json: "json",
      jsx: "jsx",
      mjs: "typescript",
      py: "python",
      sh: "shell",
      ts: "typescript",
      tsx: "tsx",
      xml: "html",
    };
    language = normalizeCodeLanguage(languageByExtension[extension || ""] || "", resolvedPreview);
  }

  toolPreviewLanguageCache.set(tool, { preview: resolvedPreview, language });
  return language;
}

export function toolPreviewText(tool: ToolCardState, locale: ToolActivityLocale = "tr"): string {
  const cachedByLocale = toolPreviewTextCache.get(tool);
  const cached = cachedByLocale?.get(locale);
  if (cached !== undefined) return cached;

  const args = (tool.args || {}) as Record<string, any>;
  const cmd = args.command ?? args.CommandLine;
  const duplicatePreviewLead = isCommandTool(tool.toolName) && cmd
    ? `$ ${String(cmd)}`
    : toolArgPath(args) || extractWrittenPath(tool.output);
  const output = stripLeadingDuplicatePreviewLead(String(tool.output || ""), duplicatePreviewLead).trim();
  if (output) {
    const preview = formatToolOutputPreview(output, locale);
    if (cachedByLocale) cachedByLocale.set(locale, preview); else toolPreviewTextCache.set(tool, new Map([[locale, preview]]));
    return preview;
  }

  const diff = toolDiffText(tool).trim();
  if (diff) {
    if (cachedByLocale) cachedByLocale.set(locale, diff); else toolPreviewTextCache.set(tool, new Map([[locale, diff]]));
    return diff;
  }

  const editPreview = toolEditArgumentPreview(tool, locale);
  if (editPreview) {
    if (cachedByLocale) cachedByLocale.set(locale, editPreview); else toolPreviewTextCache.set(tool, new Map([[locale, editPreview]]));
    return editPreview;
  }

  const contentPreview = toolWrittenContentPreview(tool, locale);
  if (contentPreview) {
    if (cachedByLocale) cachedByLocale.set(locale, contentPreview); else toolPreviewTextCache.set(tool, new Map([[locale, contentPreview]]));
    return contentPreview;
  }

  const intentPreview = toolIntentPreview(tool, locale);
  if (intentPreview) {
    if (cachedByLocale) cachedByLocale.set(locale, intentPreview); else toolPreviewTextCache.set(tool, new Map([[locale, intentPreview]]));
    return intentPreview;
  }

  const argsPreview = safeToolJson(tool.args);
  if (argsPreview) {
    const preview = `${locale === "en" ? "Tool input" : "Araç girdisi"}\n${argsPreview}`;
    if (cachedByLocale) cachedByLocale.set(locale, preview); else toolPreviewTextCache.set(tool, new Map([[locale, preview]]));
    return preview;
  }

  const preview = toolActivePlaceholder(tool, locale) || "";
  if (cachedByLocale) cachedByLocale.set(locale, preview); else toolPreviewTextCache.set(tool, new Map([[locale, preview]]));
  return preview;
}

export function toolResultLabel(tool: ToolCardState, locale: ToolActivityLocale = "tr"): string {
  const labels = locale === "en"
    ? { noResult: "No results", failed: "× Failed", running: "Running", success: "✓ Succeeded" }
    : { noResult: "Sonuç bulunamadı", failed: "× Başarısız", running: "Çalışıyor", success: "✓ Başarılı" };
  if (tool.status === "error") {
    if (isNoResultCommand(tool)) return labels.noResult;
    return labels.failed;
  }
  if (isActiveTool(tool)) return labels.running;
  return labels.success;
}

export function toolDiffText(tool: ToolCardState): string {
  const details = tool.details as Record<string, any> | undefined;
  return typeof details?.diff === "string" ? details.diff : "";
}

export function toolDetailsText(tool: ToolCardState): string {
  if (tool.details === undefined) return "";
  if (typeof tool.details === "string") return tool.details;
  return safeToolJson(tool.details);
}

export function toolContextText(tool: ToolCardState): string {
  return tool.output || toolDetailsText(tool) || (tool.args === undefined ? "" : safeToolJson(tool.args));
}

export function normalizeToolArgs(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function toolSortTime(tool: ToolCardState): number {
  return tool.updatedAt || tool.endedAt || tool.startedAt || 0;
}

export function isActiveTool(tool: Pick<ToolCardState, "status">): boolean {
  return tool.status === "queued" || tool.status === "running" || tool.status === "streaming";
}

export function isReadTool(name: string): boolean {
  const n = name.toLowerCase();
  return n === "read" || n === "read_file" || n === "view_file";
}

export function isWriteTool(name: string): boolean {
  const n = name.toLowerCase();
  return n === "write" || n === "write_to_file" || n === "write_file" || n === "create_file";
}

export function isEditTool(name: string): boolean {
  const n = name.toLowerCase();
  return n === "edit" || n === "apply_patch" || n === "replace_file_content" || n === "multi_replace_file_content";
}

export function isCommandTool(name: string): boolean {
  const n = name.toLowerCase();
  return n === "bash" || n.includes("shell") || n.includes("command") || n.includes("terminal") || n === "run_command";
}

export function isBrowserTool(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith("browser_") || n.includes("playwright");
}

export function isSearchTool(name: string): boolean {
  const n = name.toLowerCase();
  return ["grep", "find", "ls", "list_dir", "ls_dir", "list_directory", "grep_search"].includes(n) || n.includes("search") || n.includes("glob");
}

export function toolArgPath(args: Record<string, any>): string | undefined {
  if (!args || typeof args !== "object") return undefined;

  const directKeys = [
    "path", "Path", "filePath", "file_path", "FilePath",
    "targetFile", "target_file", "TargetFile",
    "absolutePath", "AbsolutePath", "absolute_path",
    "relativePath", "relative_path", "RelativePath",
    "sourcePath", "source_path", "destPath", "destinationPath",
    "filename", "fileName", "FileName", "file", "File", "name",
  ];
  for (const key of directKeys) {
    const value = args[key];
    if (typeof value === "string" && value.trim() && !isGenericFileLabel(value)) {
      // "file" / "name" bazen içerik veya tool adı olabilir — path benzeri olmalı
      if ((key === "file" || key === "File" || key === "name") && !looksLikeFilePath(value)) continue;
      return value.trim();
    }
    // Nested: { file: { path: "..." } }
    if (value && typeof value === "object" && typeof (value as any).path === "string") {
      const nested = String((value as any).path).trim();
      if (nested) return nested;
    }
  }

  // Yaygın sarmalayıcılar
  for (const nestKey of ["file", "target", "input", "params", "arguments"]) {
    const nested = args[nestKey];
    if (nested && typeof nested === "object") {
      const inner = toolArgPath(nested as Record<string, any>);
      if (inner) return inner;
    }
  }

  return undefined;
}

function asToolArgsRecord(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed as Record<string, any> : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? raw as Record<string, any> : {};
}

function isGenericFileLabel(value: string): boolean {
  return /^(yeni\s*dosya|new\s*file|dosya|file|unnamed|untitled)$/i.test(value.trim());
}

function looksLikeFilePath(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 480) return false;
  if (/\s{2,}|\n/.test(text)) return false;
  // uzantı veya path ayırıcı
  return /[\\/]/.test(text) || /\.[A-Za-z0-9]{1,12}$/.test(text);
}

function collectToolBatchSummary(tools: ToolCardState[], fallbackNames: string[]): ToolBatchSummary {
  const summary: ToolBatchSummary = {
    total: tools.length || fallbackNames.length,
    commands: 0,
    reads: 0,
    creates: 0,
    edits: 0,
    deletes: 0,
    searches: 0,
    browsers: 0,
    createActive: false,
    modifyActive: false,
    deleteActive: false,
  };

  if (tools.length) {
    for (const tool of tools) {
      collectToolCategory(summary, tool.toolName);
      const kind = toolMutationKind(tool);
      if (kind === "create") {
        summary.creates += 1;
        if (isActiveTool(tool)) summary.createActive = true;
      } else if (kind === "modify") {
        summary.edits += 1;
        if (isActiveTool(tool)) summary.modifyActive = true;
      } else if (kind === "delete") {
        summary.deletes += 1;
        if (isActiveTool(tool)) summary.deleteActive = true;
      }
    }
    return summary;
  }

  for (const name of fallbackNames) collectFallbackToolCategory(summary, name);
  return summary;
}

function collectToolCategory(summary: ToolBatchSummary, name: string): void {
  if (isCommandTool(name)) summary.commands += 1;
  if (isReadTool(name)) summary.reads += 1;
  if (isSearchTool(name)) summary.searches += 1;
  if (isBrowserTool(name)) summary.browsers += 1;
}

function collectFallbackToolCategory(summary: ToolBatchSummary, name: string): void {
  collectToolCategory(summary, name);
  if (name === "write") summary.creates += 1;
  if (name === "edit" || name === "apply_patch") summary.edits += 1;
  if (/delete|remove|rm/.test(name)) summary.deletes += 1;
}

function formatToolOutputPreview(output: string, locale: ToolActivityLocale = "tr"): string {
  if (output.trim() === "(no output)") return locale === "en" ? "No output produced." : "Çıktı üretilmedi.";
  const writeMatch = output.match(/^Successfully wrote (\d+) bytes to .+$/m);
  if (writeMatch) return locale === "en" ? `Written: ${writeMatch[1]} bytes` : `Yazıldı: ${writeMatch[1]} bayt`;
  // Keep lightweight for list rows — full body uses toolExecutionPreview when expanded.
  if (output.length > 2_400) return `${output.slice(0, 2_400)}\n…`;
  return output;
}

function isNoResultCommand(tool: ToolCardState): boolean {
  if (!isCommandTool(tool.toolName)) return false;
  const output = String(tool.output || "");
  const args = asToolArgsRecord(tool.args);
  const command = String(args.command ?? args.CommandLine ?? "");
  const searchCommand = /(?:^|\s)(?:rg|grep|findstr)(?:\s|$)/i.test(command);
  const noMatchOutput = /no matches?|eşleşme bulunamadı|0 matches?/i.test(output);
  return searchCommand && (noMatchOutput || !output.trim());
}

function pastStatus(tool: ToolCardState, active: string, done: string, failed = "Başarısız"): string {
  if (isActiveTool(tool)) return active;
  if (tool.status === "error") return failed;
  return done;
}

function boundedToolOutputPreview(output: string, locale: ToolActivityLocale = "tr"): string | undefined {
  const firstLine = firstVisibleOutputLine(output, 220);
  if (!firstLine) return undefined;
  if (firstLine === "(no output)") return locale === "en" ? "No output produced." : "Çıktı üretilmedi.";
  const writeMatch = firstLine.match(/^Successfully wrote (\d+) bytes to .+$/);
  if (writeMatch) return locale === "en" ? `Written: ${writeMatch[1]} bytes` : `Yazıldı: ${writeMatch[1]} bayt`;
  if (/^Successfully replaced \d+ block\(s\) in /i.test(firstLine)) return undefined;
  if (/^(Dosya değişikliği tamamlandı|Dosya oluşturuldu|Dosya okundu|File change completed|File created|File read)\.?$/i.test(firstLine)) return undefined;
  return output;
}

function stripLeadingDuplicatePreviewLead(output: string, lead: string | undefined): string {
  if (!lead) return output;
  const normalizedOutput = output.replace(/\r\n/g, "\n");
  const match = normalizedOutput.match(/^([^\n]+)\n+([\s\S]+)$/);
  if (!match) return output;
  if (normalizePreviewLead(match[1]) !== normalizePreviewLead(lead)) return output;
  return hasNonWhitespaceText(match[2]) ? match[2] : output;
}

function firstVisibleOutputLine(output: string, width: number): string | undefined {
  let firstLine: string | undefined;
  scanTextLines(output, (start, end) => {
    const line = stripAnsi(output.slice(start, Math.min(end, start + width + 24))).trim();
    if (!line) return;
    firstLine = truncateOneLine(line, width);
    return false;
  });
  return firstLine;
}

function toolPatchPreview(tool: ToolCardState, locale: ToolActivityLocale = "tr"): string | undefined {
  const diff = toolDiffText(tool);
  if (!hasNonWhitespaceText(diff)) return undefined;

  let created = false;
  const preview: string[] = [];
  let truncated = false;

  scanTextLines(diff, (start, end) => {
    if (lineStartsWithText(diff, start, end, "+  1 ") || lineStartsWithText(diff, start, end, "+1 ") || lineStartsWithText(diff, start, end, "+<!DOCTYPE") || lineStartsWithText(diff, start, end, "+<")) created = true;
    if (!lineStartsWithText(diff, start, end, "+") && !lineStartsWithText(diff, start, end, "-") && !lineStartsWithText(diff, start, end, "@@")) return;
    if (preview.length >= TOOL_BODY_MAX_LINES) {
      truncated = true;
      return false;
    }
    preview.push(truncatePreviewLine(diff, start, end, TOOL_BODY_LINE_WIDTH));
  });

  const title = created ? (locale === "en" ? "New file content" : "Yeni dosya içeriği") : (locale === "en" ? "Change" : "Değişiklik");
  if (truncated) preview.push("…");
  return preview.length ? `${title}\n${preview.join("\n")}` : undefined;
}

function toolEditArgumentPreview(tool: ToolCardState, locale: ToolActivityLocale = "tr"): string | undefined {
  if (hasPatchDetails(tool) || toolMutationKind(tool) !== "modify") return undefined;
  const args = (tool.args || {}) as Record<string, any>;
  const edits = collectEditReplacements(args);
  if (!edits.length) return undefined;

  const preview: string[] = [locale === "en" ? "Edit" : "Düzenleme"];
  edits.forEach((edit, index) => {
    if (edits.length > 1) preview.push(`@@ ${locale === "en" ? "change" : "değişim"} ${index + 1}`);
    preview.push(...formatReplacementPreview(edit));
  });
  return preview.join("\n");
}

function toolWrittenContentPreview(tool: ToolCardState, locale: ToolActivityLocale = "tr"): string | undefined {
  if (hasPatchDetails(tool)) return undefined;
  const args = (tool.args || {}) as Record<string, any>;
  const raw = args.content ?? args.text ?? args.newText ?? args.new_text ?? args.replacement ?? args.patch;
  if (typeof raw !== "string" || !hasNonWhitespaceText(raw)) return undefined;

  const title = toolMutationKind(tool) === "create" ? (locale === "en" ? "Written content" : "Yazılan içerik") : (locale === "en" ? "Changed content" : "Değişen içerik");
  const preview = collectNumberedPreviewLines(raw, TOOL_BODY_MAX_LINES, TOOL_BODY_LINE_WIDTH);
  return `${title}\n${preview.lines.join("\n")}${preview.truncated ? "\n…" : ""}`;
}

function toolIntentPreview(tool: ToolCardState, locale: ToolActivityLocale = "tr"): string | undefined {
  const args = (tool.args || {}) as Record<string, any>;
  if (isBrowserTool(tool.toolName)) return toolBrowserIntentPreview(args, locale);
  if (isSearchTool(tool.toolName)) return toolSearchIntentPreview(tool.toolName, args, locale);
  if (isReadTool(tool.toolName)) {
    const path = toolArgPath(args);
    return path ? `${locale === "en" ? "Read request" : "Okuma isteği"}\n${path}` : undefined;
  }
  const cmd = args.command ?? args.CommandLine;
  if (isCommandTool(tool.toolName) && typeof cmd === "string") return `$ ${cmd}`;
  return undefined;
}

function toolBrowserIntentPreview(args: Record<string, any>, locale: ToolActivityLocale = "tr"): string | undefined {
  const code = firstStringArg(args, ["code", "script", "function", "fn", "expression"]);
  if (code) return `${locale === "en" ? "Browser code" : "Tarayıcı kodu"}\n${previewCodeFragment(code, 12)}`;

  const lines: string[] = [];
  const url = firstStringArg(args, ["url", "href"]);
  const target = firstStringArg(args, ["target", "selector", "element", "text"]);
  const action = firstStringArg(args, ["action", "method", "name"]);
  const file = firstStringArg(args, ["path", "filePath", "file_path", "filename"]);
  if (url) lines.push(`url: ${url}`);
  if (target) lines.push(`${locale === "en" ? "target" : "hedef"}: ${target}`);
  if (action) lines.push(`${locale === "en" ? "action" : "işlem"}: ${action}`);
  if (file) lines.push(`${locale === "en" ? "file" : "dosya"}: ${file}`);
  return lines.length ? `${locale === "en" ? "Browser action" : "Tarayıcı işlemi"}\n${lines.map((line) => truncateLine(line, TOOL_PREVIEW_ARG_WIDTH)).join("\n")}` : undefined;
}

function toolSearchIntentPreview(name: string, args: Record<string, any>, locale: ToolActivityLocale = "tr"): string | undefined {
  const lines: string[] = [];
  const query = firstStringArg(args, ["pattern", "query", "q", "glob", "needle", "search"]);
  const path = toolArgPath(args);
  const include = firstStringArg(args, ["include", "type", "extension"]);
  const depth = args.maxDepth ?? args.max_depth ?? args.depth;
  if (query) lines.push(`${locale === "en" ? "query" : "aranan"}: ${query}`);
  if (path) lines.push(`${locale === "en" ? "location" : "konum"}: ${path}`);
  if (include) lines.push(`${locale === "en" ? "filter" : "filtre"}: ${include}`);
  if (depth !== undefined) lines.push(`${locale === "en" ? "depth" : "derinlik"}: ${depth}`);
  if (!lines.length && name === "ls" && path) lines.push(`${locale === "en" ? "location" : "konum"}: ${path}`);
  return lines.length ? `${locale === "en" ? "Search request" : "Arama isteği"}\n${lines.map((line) => truncateLine(line, TOOL_PREVIEW_ARG_WIDTH)).join("\n")}` : undefined;
}

function toolArgumentsPreview(tool: ToolCardState, locale: ToolActivityLocale = "tr"): string | undefined {
  const raw = safeToolJson(tool.args);
  return raw ? `${locale === "en" ? "Tool input" : "Araç girdisi"}\n${raw}` : toolActivePlaceholder(tool, locale);
}

function toolActivePlaceholder(tool: ToolCardState, locale: ToolActivityLocale = "tr"): string | undefined {
  if (isCommandTool(tool.toolName)) return undefined;
  if (isBrowserTool(tool.toolName)) return locale === "en" ? "Browser action is running." : "Tarayıcı işlemi çalışıyor.";
  if (isSearchTool(tool.toolName)) return locale === "en" ? "Search is running." : "Arama çalışıyor.";
  if (isReadTool(tool.toolName)) return locale === "en" ? "Reading file." : "Dosya okunuyor.";
  const kind = toolMutationKind(tool);
  if (kind === "create") return locale === "en" ? "Creating file." : "Dosya oluşturuluyor.";
  if (kind === "modify") return locale === "en" ? "Editing file." : "Dosya düzenleniyor.";
  if (kind === "delete") return locale === "en" ? "Deleting file." : "Dosya siliniyor.";
  return locale === "en" ? "Tool is running." : "Araç çalışıyor.";
}

function hasPatchDetails(tool: ToolCardState): boolean {
  return toolDiffText(tool).trim().length > 0;
}

function diffLineStats(diff: string): { added: number; removed: number } {
  if (!hasNonWhitespaceText(diff)) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  scanTextLines(diff, (start, end) => {
    const first = diff.charCodeAt(start);
    if (first === 43) {
      if (!lineStartsWithTriple(diff, start, end, 43)) added += 1;
      return;
    }
    if (first === 45 && !lineStartsWithTriple(diff, start, end, 45)) removed += 1;
  });
  return { added, removed };
}

function mutationPatchCandidates(tool: ToolCardState): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const text = value.trim();
    if (!text || seen.has(text) || !looksLikeMutationPatch(text)) return;
    seen.add(text);
    candidates.push(text);
  };

  const rawArgs = tool.args;
  if (typeof rawArgs === "string") {
    push(rawArgs);
  } else if (rawArgs && typeof rawArgs === "object") {
    const args = rawArgs as Record<string, unknown>;
    for (const key of ["patch", "Patch", "input", "Input", "content", "text", "diff", "changes", "body"]) {
      push(args[key]);
    }
  }

  const details = tool.details;
  if (typeof details === "string") {
    push(details);
  } else if (details && typeof details === "object") {
    const value = details as Record<string, unknown>;
    push(value.diff);
    push(value.patch);
    push(value.input);
  }

  push(toolDiffText(tool));
  push(tool.output);
  return candidates;
}

function looksLikeMutationPatch(text: string): boolean {
  return /(?:^|\n)\*\*\*\s+(?:Begin Patch|Add File:|Update File:|Delete File:)/i.test(text)
    || /(?:^|\n)diff --git\s+/i.test(text)
    || /(?:^|\n)---\s+[^\n]+\n\+\+\+\s+[^\n]+/i.test(text);
}

function parseApplyPatchMutations(text: string): ToolFileMutation[] {
  if (!/(?:^|\n)\*\*\*\s+(?:Add|Update|Delete)\s+File:/i.test(text)) return [];

  const mutations: ToolFileMutation[] = [];
  let current: ToolFileMutation | undefined;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const fileMarker = line.match(/^\*\*\*\s+(Add|Update|Delete)\s+File:\s*(.+?)\s*$/i);
    if (fileMarker) {
      const operation = fileMarker[1].toLowerCase();
      const path = normalizeMutationPath(fileMarker[2]);
      if (!path) {
        current = undefined;
        continue;
      }
      current = {
        path,
        kind: operation === "add" ? "create" : operation === "delete" ? "delete" : "modify",
        added: 0,
        removed: 0,
      };
      mutations.push(current);
      continue;
    }

    const moveMarker = line.match(/^\*\*\*\s+Move to:\s*(.+?)\s*$/i);
    if (moveMarker && current) {
      const nextPath = normalizeMutationPath(moveMarker[1]);
      if (nextPath) {
        current.previousPath = current.path;
        current.path = nextPath;
        current.kind = "modify";
      }
      continue;
    }

    if (!current || line.startsWith("***") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) current.added += 1;
    else if (line.startsWith("-")) current.removed += 1;
  }
  return mutations;
}

function parseUnifiedDiffMutations(text: string): ToolFileMutation[] {
  if (!/(?:^|\n)(?:diff --git\s+|---\s+)/.test(text)) return [];

  const mutations: ToolFileMutation[] = [];
  let current: ToolFileMutation | undefined;
  let oldPath = "";
  let headersComplete = false;
  let usesDiffHeaders = false;

  const finish = () => {
    if (current?.path) mutations.push(current);
    current = undefined;
    oldPath = "";
    headersComplete = false;
  };

  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const diffHeader = line.match(/^diff --git\s+"?a\/(.+?)"?\s+"?b\/(.+?)"?$/);
    if (diffHeader) {
      finish();
      usesDiffHeaders = true;
      oldPath = normalizeMutationPath(diffHeader[1]);
      const path = normalizeMutationPath(diffHeader[2]);
      current = { path: path || oldPath, previousPath: oldPath && oldPath !== path ? oldPath : undefined, kind: "modify", added: 0, removed: 0 };
      continue;
    }

    if (/^new file mode\s+/.test(line) && current) {
      current.kind = "create";
      continue;
    }
    if (/^deleted file mode\s+/.test(line) && current) {
      current.kind = "delete";
      continue;
    }

    const oldHeader = line.match(/^---\s+(.+?)\s*$/);
    if (oldHeader) {
      if (!usesDiffHeaders && current && headersComplete) finish();
      oldPath = normalizeMutationPath(oldHeader[1]);
      if (!current) current = { path: oldPath, kind: oldPath ? "modify" : "create", added: 0, removed: 0 };
      if (!oldPath) current.kind = "create";
      headersComplete = false;
      continue;
    }

    const newHeader = line.match(/^\+\+\+\s+(.+?)\s*$/);
    if (newHeader) {
      const newPath = normalizeMutationPath(newHeader[1]);
      if (!current) current = { path: newPath || oldPath, kind: "modify", added: 0, removed: 0 };
      if (!newPath) {
        current.path = oldPath;
        current.kind = "delete";
      } else {
        current.path = newPath;
        if (!oldPath) current.kind = "create";
        else if (oldPath !== newPath) current.previousPath = oldPath;
      }
      headersComplete = true;
      continue;
    }

    if (!current || (!headersComplete && !usesDiffHeaders)) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) current.added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) current.removed += 1;
  }

  finish();
  return mutations;
}

function parseMutationResultLines(text: string): ToolFileMutation[] {
  if (!text.trim()) return [];
  const mutations: ToolFileMutation[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const match = line.trim().match(/^([AMD])\s+(.+?)\s*$/);
    if (!match || !looksLikeFilePath(match[2])) continue;
    const path = normalizeMutationPath(match[2]);
    if (!path) continue;
    mutations.push({
      path,
      kind: match[1] === "A" ? "create" : match[1] === "D" ? "delete" : "modify",
      added: 0,
      removed: 0,
    });
  }
  return mutations;
}

function mergeFileMutations(mutations: ToolFileMutation[]): ToolFileMutation[] {
  const merged = new Map<string, ToolFileMutation>();
  for (const mutation of mutations) {
    const path = normalizeMutationPath(mutation.path);
    if (!path) continue;
    const existing = merged.get(path);
    if (!existing) {
      merged.set(path, { ...mutation, path });
      continue;
    }
    existing.kind = mutation.kind;
    existing.added += mutation.added;
    existing.removed += mutation.removed;
    existing.previousPath = mutation.previousPath || existing.previousPath;
  }
  return [...merged.values()];
}

function normalizeMutationPath(value: unknown): string {
  let path = String(value || "").trim().replace(/^["']|["']$/g, "");
  const tabIndex = path.indexOf("\t");
  if (tabIndex >= 0) path = path.slice(0, tabIndex).trim();
  if (!path || path === "/dev/null") return "";
  path = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (/^[ab]\//.test(path)) path = path.slice(2);
  return path;
}

function writtenContentLineCount(args: Record<string, any>): number {
  const raw = args.CodeContent ?? args.codeContent ?? args.content ?? args.text ?? args.newText ?? args.new_text ?? args.replacement;
  return typeof raw === "string" ? countTextLines(raw) : 0;
}

function replacementLineCount(args: Record<string, any>): number {
  const raw = args.ReplacementContent ?? args.replacementContent ?? args.replacement ?? args.newText ?? args.new_text ?? args.newString ?? args.new_string ?? args.content ?? args.text;
  return typeof raw === "string" ? countTextLines(raw) : 0;
}

function editArgumentLineStats(args: Record<string, any>): { added: number; removed: number } {
  const edits = collectEditReplacements(args);
  if (!edits.length) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    added += countTextLines(edit.newText);
    removed += countTextLines(edit.oldText);
  }
  return { added, removed };
}

function collectEditReplacements(args: Record<string, any>): Array<{ oldText: string; newText: string }> {
  const edits: Array<{ oldText: string; newText: string }> = [];

  const chunks = args.replacementChunks ?? args.ReplacementChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) {
      if (!chunk || typeof chunk !== "object") continue;
      const value = chunk as Record<string, any>;
      const oldText = textArg(value.TargetContent ?? value.targetContent ?? value.oldText ?? value.old_text ?? value.oldString ?? value.old_string);
      const newText = textArg(value.ReplacementContent ?? value.replacementContent ?? value.newText ?? value.new_text ?? value.newString ?? value.new_string ?? value.replacement);
      if (oldText !== undefined || newText !== undefined) edits.push({ oldText: oldText || "", newText: newText || "" });
    }
  }

  if (Array.isArray(args.edits)) {
    for (const edit of args.edits) {
      if (!edit || typeof edit !== "object") continue;
      const value = edit as Record<string, any>;
      const oldText = textArg(value.oldText ?? value.old_text ?? value.oldString ?? value.old_string);
      const newText = textArg(value.newText ?? value.new_text ?? value.newString ?? value.new_string ?? value.replacement);
      if (oldText !== undefined || newText !== undefined) edits.push({ oldText: oldText || "", newText: newText || "" });
    }
  }

  const singleOldText = textArg(args.TargetContent ?? args.targetContent ?? args.oldText ?? args.old_text ?? args.oldString ?? args.old_string);
  const singleNewText = textArg(args.ReplacementContent ?? args.replacementContent ?? args.newText ?? args.new_text ?? args.newString ?? args.new_string ?? args.replacement);
  if (singleOldText !== undefined || singleNewText !== undefined) {
    edits.push({ oldText: singleOldText || "", newText: singleNewText || "" });
  }

  const oldText = textArg(args.oldText ?? args.old_text ?? args.oldString ?? args.old_string);
  const newText = textArg(args.newText ?? args.new_text ?? args.newString ?? args.new_string ?? args.replacement);
  if (oldText !== undefined || newText !== undefined) {
    if (!edits.some(e => e.oldText === (oldText || "") && e.newText === (newText || ""))) {
      edits.push({ oldText: oldText || "", newText: newText || "" });
    }
  }
  return edits;
}

function formatReplacementPreview(edit: { oldText: string; newText: string }): string[] {
  const oldLines = previewTextLines(edit.oldText);
  const newLines = previewTextLines(edit.newText);
  const lines: string[] = [];
  if (oldLines.length) lines.push(...oldLines.map((line) => `- ${line}`));
  if (newLines.length) lines.push(...newLines.map((line) => `+ ${line}`));
  if (!lines.length) lines.push("+ boş değişiklik");
  return lines;
}

function previewTextLines(value: string): string[] {
  const preview = collectPreviewLines(value, TOOL_BODY_MAX_LINES, TOOL_BODY_LINE_WIDTH);
  return preview.truncated ? [...preview.lines, "…"] : preview.lines;
}

function previewCodeFragment(code: string, limit: number): string {
  const preview = collectPreviewLines(code, limit, TOOL_PREVIEW_ARG_WIDTH);
  return [...preview.lines, ...(preview.truncated ? ["…"] : [])].join("\n");
}

function appendPreviewBlock(target: string[], value: string | undefined, maxLines: number, width: number): void {
  if (!value || target.length > maxLines) return;
  if (target.length && target[target.length - 1] !== "" && target.length < maxLines) target.push("");
  const preview = collectPreviewLines(value, Math.max(0, maxLines - target.length), width);
  target.push(...preview.lines);
  if (preview.truncated) target.push("…");
}

function collectPreviewLines(value: string, limit: number, width: number): { lines: string[]; truncated: boolean } {
  if (limit <= 0) return { lines: [], truncated: hasNonWhitespaceText(value) };
  const lines: string[] = [];
  let truncated = false;
  let start = 0;

  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length && value.charCodeAt(index) !== 10) continue;
    if (lines.length >= limit) {
      truncated = index < value.length || start < value.length;
      break;
    }
    let end = index;
    if (end > start && value.charCodeAt(end - 1) === 13) end -= 1;
    lines.push(truncatePreviewLine(value, start, end, width));
    start = index + 1;
    if (lines.length >= limit && start < value.length) {
      truncated = true;
      break;
    }
  }

  return { lines, truncated };
}

function collectNumberedPreviewLines(value: string, limit: number, width: number): { lines: string[]; truncated: boolean } {
  const preview = collectPreviewLines(value, limit, width);
  return {
    lines: preview.lines.map((line, index) => `${String(index + 1).padStart(2, " ")} | ${line}`),
    truncated: preview.truncated,
  };
}

function truncatePreviewLine(value: string, start: number, end: number, width: number): string {
  const sliceEnd = Math.min(end, start + width + 24);
  const line = stripAnsi(value.slice(start, sliceEnd));
  return sliceEnd < end ? `${truncateOneLine(line, width - 1)}…` : truncateOneLine(line, width);
}

function compactToolText(value: unknown, limit: number): string {
  const text = String(value || "");
  if (text.length <= limit) return text;
  const edge = Math.max(400, Math.floor(limit / 2));
  return `${text.slice(0, edge)}\n…\n${text.slice(-edge)}`;
}

function safeToolJson(value: unknown): string {
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
    return text.length > TOOL_PREVIEW_JSON_LIMIT ? `${text.slice(0, TOOL_PREVIEW_JSON_LIMIT - 1)}…` : text;
  } catch {
    return String(value || "");
  }
}

function safeToolScanJson(value: unknown): string {
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

function textArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function firstStringArg(args: Record<string, any>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function normalizeCodeLanguage(language: string, text: string): string {
  const value = String(language || "").toLowerCase().replace(/^language-/, "");
  if (value) {
    if (["htm", "html", "xml", "svg"].includes(value)) return "html";
    if (["js", "javascript", "jsx", "ts", "typescript", "tsx"].includes(value)) return value === "jsx" || value === "tsx" ? value : "typescript";
    if (["py", "python"].includes(value)) return "python";
    if (["bash", "shell", "sh", "powershell", "ps1"].includes(value)) return "shell";
    if (["json", "css"].includes(value)) return value;
  }
  if (/<!DOCTYPE|<\/?[A-Za-z][\w:-]*(?:\s|>)/.test(text)) return "html";
  if (/^\s*[{[]/.test(text) && /["'][\w-]+["']\s*:/.test(text)) return "json";
  if (/\b(from|import|def|class)\s+[A-Za-z_]|print\(/.test(text)) return "python";
  if (/\$ [A-Za-z]|--[A-Za-z-]+/.test(text)) return "shell";
  if (/[.#][\w-]+\s*\{|[\w-]+\s*:\s*[^;]+;/.test(text)) return "css";
  return "typescript";
}

function countTextLines(value: string): number {
  if (!value.length) return 0;
  let lines = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

function scanTextLines(value: string, visit: (start: number, end: number) => boolean | void): void {
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length && value.charCodeAt(index) !== 10) continue;
    let end = index;
    if (end > start && value.charCodeAt(end - 1) === 13) end -= 1;
    if (visit(start, end) === false) return;
    start = index + 1;
  }
}

function hasNonWhitespaceText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 32) return true;
  }
  return false;
}

function lineStartsWithTriple(value: string, start: number, end: number, code: number): boolean {
  return end - start >= 3 && value.charCodeAt(start) === code && value.charCodeAt(start + 1) === code && value.charCodeAt(start + 2) === code;
}

function lineStartsWithText(value: string, start: number, end: number, prefix: string): boolean {
  if (end - start < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (value.charCodeAt(start + index) !== prefix.charCodeAt(index)) return false;
  }
  return true;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function truncateOneLine(value: string, limit: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function truncateLine(value: string, limit: number): string {
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function normalizePreviewLead(value: string | undefined): string {
  return String(value || "").replaceAll("\\", "/").trim().toLowerCase();
}

function shortPath(value: unknown): string {
  const text = String(value);
  return text.length > 96 ? `…${text.slice(-93)}` : text;
}

function extractWrittenPath(output?: string): string | undefined {
  const text = String(output || "");
  if (!text.trim()) return undefined;

  const patterns = [
    /Successfully wrote \d+ bytes to (.+)$/im,
    /(?:Wrote|Written|Created|Updated|Modified|Saved|Edited)\s+(?:file\s+)?[`'"]?([^\s`'"\n]+)[`'"]?/i,
    /(?:dosya\s+)?(?:oluşturuldu|yazıldı|kaydedildi|güncellendi)[:\s]+[`'"]?([^\s`'"\n]+)[`'"]?/i,
    /(?:path|file|file_path|filePath|targetFile)\s*[:=]\s*[`'"]?([^\s`'",\n]+)[`'"]?/i,
    /(?:---|\+\+\+)\s+(?:a\/|b\/)?(?!\/dev\/null)([^\n\r\t]+)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = match?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (candidate && !isGenericFileLabel(candidate) && candidate !== "/dev/null") {
      return candidate.replace(/^[ab]\//, "").replace(/^\.\//, "");
    }
  }
  return undefined;
}

function extractPathFromDiff(diff?: string): string | undefined {
  const text = String(diff || "");
  if (!text.trim()) return undefined;
  // +++ b/path/to/file.md  /  --- a/path
  for (const match of text.matchAll(/(?:^|\n)(?:---|\+\+\+)\s+(?:a\/|b\/)?(?!\/dev\/null)([^\n\r]+)/g)) {
    const candidate = match[1].trim().replace(/^["']|["']$/g, "");
    if (candidate && candidate !== "/dev/null" && !isGenericFileLabel(candidate)) {
      return candidate.replace(/^[ab]\//, "").replace(/^\.\//, "");
    }
  }
  return undefined;
}

function extractPathFromLooseText(text: string): string | undefined {
  if (!text.trim()) return undefined;
  // JSON-ish "path":"foo/bar.md"
  const jsonPath = text.match(/"(?:path|file_path|filePath|targetFile|target_file|filename|FilePath)"\s*:\s*"([^"\n]+)"/i);
  if (jsonPath?.[1] && looksLikeFilePath(jsonPath[1])) return jsonPath[1];

  // Markdown / prose paths with common extensions
  const extPath = text.match(/(?:^|[\s`"'(=])((?:[\w.-]+[\\/])*[\w.-]+\.(?:md|tsx?|jsx?|css|json|html?|py|rs|go|java|kt|swift|yml|yaml|toml|sh|bash|sql|txt|svg|xml))(?:$|[\s`"'),;])/i);
  if (extPath?.[1]) return extPath[1];

  return undefined;
}
