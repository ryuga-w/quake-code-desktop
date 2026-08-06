import React, { useEffect, useMemo, useState } from "react";
import { useAppStore, type ToolCardState } from "../../state/app-store";
import { useI18n } from "../../i18n";
import { isDiff } from "../../lib/render";
import { formatDuration, statusFilterLabel, statusLabel } from "../../lib/format-utils";
import {
  isPlanProtocolToolName,
  pushRecentToolBounded,
  summarizeToolArgs,
  toolDiffText,
  toolDisplayName,
  toolPreviewText,
  toolSearchText,
  toolSortTime,
} from "../../lib/tool-helpers";
import { ToolRenderer } from "./ToolRenderer";
import {
  TOOL_PANEL_INITIAL_WINDOW,
  TOOL_PANEL_WINDOW_STEP,
} from "../../constants";

export function ToolsPanel({ onOpenDiff, onInspect, onOpenFile }: { onOpenDiff: (card: ToolCardState) => void; onInspect: (card: ToolCardState) => void; onOpenFile?: (path: string) => void }) {
  const { t, locale } = useI18n();
  const toolMap = useAppStore((s) => s.tools);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [toolWindowSize, setToolWindowSize] = useState(TOOL_PANEL_INITIAL_WINDOW);
  const needle = query.trim().toLowerCase();
  const view = useMemo(() => selectToolsPanelView(toolMap, needle, status, toolWindowSize), [needle, status, toolMap, toolWindowSize]);
  useEffect(() => setToolWindowSize(TOOL_PANEL_INITIAL_WINDOW), [needle, status]);
  const visibleTools = view.tools;
  const hiddenToolCount = Math.max(0, view.filtered - visibleTools.length);
  const groups = useMemo(() => groupToolsByTurn(visibleTools, locale), [locale, visibleTools]);
  const nextToolCount = Math.min(hiddenToolCount, TOOL_PANEL_WINDOW_STEP);
  return <div className="panel"><div className="panel-title-row"><div className="panel-title">{t("tools.title")}</div><span>{view.filtered}/{view.total}</span></div><input className="panel-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("tools.searchPlaceholder")} aria-label={t("tools.searchPlaceholder")} /><div className="segmented">{["all", "running", "streaming", "done", "error"].map((item) => <button key={item} type="button" className={status === item ? "active" : ""} onClick={() => setStatus(item)}>{statusFilterLabel(item, locale)}</button>)}</div><div id="tools" className={`tool-list ${view.filtered ? "" : "muted"}`}>{view.filtered ? <>{groups.map((group) => <ToolTurnGroup group={group} key={group.turnId} onOpenDiff={onOpenDiff} onInspect={onInspect} onOpenFile={onOpenFile} />)}{hiddenToolCount > 0 && <button type="button" className="tree-load-more" onClick={() => setToolWindowSize((value) => value + TOOL_PANEL_WINDOW_STEP)}>{t("tools.loadOlder", { count: nextToolCount })} <span>{t("tools.hidden", { count: hiddenToolCount })}</span></button>}</> : t("tools.empty")}</div></div>;
}

export function ToolTurnGroup({ group, onOpenDiff, onInspect, onOpenFile }: { group: ToolTurnSummary; onOpenDiff: (card: ToolCardState) => void; onInspect: (card: ToolCardState) => void; onOpenFile?: (path: string) => void }) {
  const { t } = useI18n();
  return <section className="tool-turn-group"><div className="tool-turn-head"><div><strong>{t("tools.turn", { id: group.turnId })}</strong><span>{group.summary}</span></div><em>{group.durationMs !== undefined ? formatDuration(group.durationMs) : t("tools.working")}</em></div>{group.tools.map((card) => <ToolCard card={card} key={card.id} onOpenDiff={onOpenDiff} onInspect={onInspect} onOpenFile={onOpenFile} />)}</section>;
}

export type ToolTurnSummary = { turnId: number | string; tools: ToolCardState[]; summary: string; durationMs?: number };

export function groupToolsByTurn(tools: ToolCardState[], locale: "tr" | "en" = "tr"): ToolTurnSummary[] {
  const map = new Map<number | string, ToolCardState[]>();
  for (const tool of tools) {
    const key = tool.turnId || "?";
    const group = map.get(key);
    if (group) group.push(tool);
    else map.set(key, [tool]);
  }
  const summaries: ToolTurnSummary[] = [];
  for (const [turnId, turnTools] of map) summaries.push(createToolTurnSummary(turnId, turnTools, locale));
  return summaries;
}

export function createToolTurnSummary(turnId: number | string, turnTools: ToolCardState[], locale: "tr" | "en" = "tr"): ToolTurnSummary {
  let errors = 0;
  let running = 0;
  let completed = 0;
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  const names: string[] = [];
  const seenNames = new Set<string>();
  for (const tool of turnTools) {
    if (tool.status === "error") errors += 1;
    if (tool.status === "running" || tool.status === "streaming") running += 1;
    if (tool.status === "done" || tool.status === "error") completed += 1;
    if (tool.startedAt) startedAt = startedAt === undefined ? tool.startedAt : Math.min(startedAt, tool.startedAt);
    const endTime = tool.endedAt || tool.updatedAt;
    if (endTime) endedAt = endedAt === undefined ? endTime : Math.max(endedAt, endTime);
    const displayName = toolDisplayName(tool.toolName, locale);
    if (names.length < 4 && !seenNames.has(displayName)) {
      seenNames.add(displayName);
      names.push(displayName);
    }
  }
  const durationMs = startedAt !== undefined && endedAt !== undefined ? endedAt - startedAt : undefined;
  const nameSummary = names.join(", ");
  const summary = locale === "en"
    ? `${turnTools.length} tools · ${completed} completed${running ? ` · ${running} running` : ""}${errors ? ` · ${errors} errors` : ""}${nameSummary ? ` · ${nameSummary}` : ""}`
    : `${turnTools.length} araç · ${completed} tamamlandı${running ? ` · ${running} çalışıyor` : ""}${errors ? ` · ${errors} hata` : ""}${nameSummary ? ` · ${nameSummary}` : ""}`;
  return { turnId, tools: turnTools, summary, durationMs };
}

const OPEN_SIDEBAR_TOOL_DETAILS = new Set<string>();

function useSidebarToolDetailsOpen(id: string): [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(() => OPEN_SIDEBAR_TOOL_DETAILS.has(id));
  const update = (next: boolean) => {
    if (next) OPEN_SIDEBAR_TOOL_DETAILS.add(id);
    else OPEN_SIDEBAR_TOOL_DETAILS.delete(id);
    setOpen(next);
  };
  return [open, update];
}

export function ToolCard({ card, onOpenDiff, onInspect, onOpenFile }: { card: ToolCardState; onOpenDiff: (card: ToolCardState) => void; onInspect: (card: ToolCardState) => void; onOpenFile?: (path: string) => void }) {
  const { t, locale } = useI18n();
  const preview = toolPreviewText(card, locale);
  const diff = isDiff(toolDiffText(card) || card.output);
  const [open, setOpen] = useSidebarToolDetailsOpen(card.id);
  return <div className={`tool-card ${card.status}`}><details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary><span>{toolDisplayName(card.toolName, locale)}</span><small>{summarizeToolArgs(card.toolName, card.args, locale) || statusLabel(card.status, locale)}</small></summary><div className="tool-actions"><button className="tool-action" type="button" onClick={() => onInspect(card)}>{t("tools.actions.inspect")}</button>{diff && <button className="tool-action" type="button" onClick={() => onOpenDiff(card)}>{t("tools.actions.openDiff")}</button>}</div><ToolRendererInline card={card} onOpenFile={onOpenFile} /></details></div>;
}

function ToolRendererInline({ card, onOpenFile }: { card: ToolCardState; onOpenFile?: (path: string) => void }) {
  return <ToolRenderer tool={card} onOpenFile={onOpenFile} />;
}

type ToolsPanelView = { tools: ToolCardState[]; total: number; filtered: number };

function selectToolsPanelView(toolMap: Record<string, ToolCardState>, needle: string, status: string, limit: number): ToolsPanelView {
  const tools: ToolCardState[] = [];
  let total = 0;
  let filtered = 0;
  for (const id in toolMap) {
    const tool = toolMap[id];
    if (isPlanProtocolToolName(tool.toolName)) continue;
    total += 1;
    if (status !== "all" && tool.status !== status) continue;
    if (needle && !toolSearchText(tool).includes(needle)) continue;
    filtered += 1;
    pushRecentToolBounded(tools, tool, limit);
  }
  tools.sort((a, b) => toolSortTime(b) - toolSortTime(a));
  return { tools, total, filtered };
}
