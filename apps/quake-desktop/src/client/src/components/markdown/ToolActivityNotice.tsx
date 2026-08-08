import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, type ToolCardState } from "../../state/app-store";
import { useI18n } from "../../i18n";
import {
  isActiveTool as isActiveToolModel,
  toolFileMutations as toolFileMutationsModel,
  toolLineStats as toolLineStatsModel,
  toolSortTime as toolSortTimeModel,
  isCommandTool,
  type ToolFileMutation,
  type ToolLineStats,
} from "../../lib/tool-activity";
import styles from "./MarkdownMessage.module.css";
import {
  buildToolNoticeHeadline,
  SemanticFlowSummary,
  type ToolNoticeHeadline,
  useLastMeaningfulToolHeadline,
  useSemanticFlowHeadline,
} from "./SemanticFlow";
import { noticeOpenKey, useDetailsOpen } from "./tool-activity-open-state";
import { MutationPencilIcon, ToolRunDetails } from "./ToolRunDetails";
import {
  buildSingleFileReview,
  resolveRowDiff,
  type TurnDiffView,
} from "../tools/TurnFileChangesCard";

export { noticeOpenKey } from "./tool-activity-open-state";

const NOTICE_LIVE_TOOL_LIMIT = 120;

export type ToolActivityTraceEntry = { kind: "tool"; key: string; toolId: string };

type ToolNoticeRunItem = { kind: "tool"; key: string; tool: ToolCardState };

const EMPTY_TOOL_ACTIVITY_TRACE: ToolActivityTraceEntry[] = [];

function selectNoticeSnapshotLiveTools(toolMap: Record<string, ToolCardState>, toolIds: Set<string>): ToolCardState[] {
  const matching: ToolCardState[] = [];
  for (const id of toolIds) {
    const tool = toolMap[id];
    if (tool) pushBoundedLiveTool(matching, tool);
  }
  return matching;
}

const TOOL_RUN_SCROLL_FADE_PX = 36;

/** Premium edge fade for tool run lists (6+ rows scroll). Soft multi-stop mask tracks scroll. */
function updateToolRunScrollFade(body: HTMLElement | null) {
  if (!body) return;
  const max = Math.max(0, body.scrollHeight - body.clientHeight);
  const canScroll = max > 2;
  const atTop = body.scrollTop <= 2;
  const atBottom = body.scrollTop >= max - 2;
  body.classList.toggle(styles.toolRunScrollCanScroll, canScroll);
  body.classList.toggle(styles.toolRunScrollAtTop, !canScroll || atTop);
  body.classList.toggle(styles.toolRunScrollAtBottom, !canScroll || atBottom);
  body.style.setProperty("--tool-fade-top", canScroll && !atTop ? `${TOOL_RUN_SCROLL_FADE_PX}px` : "0px");
  body.style.setProperty("--tool-fade-bottom", canScroll && !atBottom ? `${TOOL_RUN_SCROLL_FADE_PX}px` : "0px");
}

function useToolRunScrollFade(deps: unknown) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const sync = () => updateToolRunScrollFade(body);
    body.addEventListener("scroll", sync, { passive: true });
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    const observeChildren = () => {
      resizeObserver?.observe(body);
      for (const child of Array.from(body.children)) {
        if (child instanceof HTMLElement) resizeObserver?.observe(child);
      }
    };
    observeChildren();
    const mutationObserver = typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => {
          observeChildren();
          sync();
        })
      : null;
    // Watch content changes and nested <details> toggles only. Observing every
    // attribute here creates a feedback loop because sync() updates this body's
    // class/style attributes, which would immediately trigger the observer again.
    mutationObserver?.observe(body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    const frame = requestAnimationFrame(sync);
    return () => {
      cancelAnimationFrame(frame);
      body.removeEventListener("scroll", sync);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [deps]);
  return bodyRef;
}

/** Immediate post-send waiting state — premium "Düşünüyor" with text shimmer. */
export function StreamingThinkingIndicator({ label }: { label?: string }) {
  const { locale } = useI18n();
  const resolvedLabel = label ?? (locale === "en" ? "Thinking" : "Düşünüyor");
  return (
    <div className={styles.streamingThink} role="status" aria-live="polite" aria-label={resolvedLabel}>
      <span className={styles.streamingThinkShimmer}>{resolvedLabel}</span>
    </div>
  );
}

/** Past-task disclosure: "1m 51s boyunca çalıştı" — click to inspect work done in that turn. */
export function TurnWorkDisclosure({
  openKey,
  durationMs,
  children,
  defaultOpen = false,
}: {
  openKey: string;
  durationMs?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const { locale } = useI18n();
  const [open, setOpen] = useDetailsOpen(`turn-work:${openKey}`, defaultOpen);
  const label = formatTurnWorkDurationLabel(durationMs, locale);
  return (
    <details
      className={styles.turnWork}
      data-state="complete"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={styles.turnWorkSummary} aria-label={label}>
        <span className={styles.turnWorkLabel}>{label}</span>
      </summary>
      <div className={styles.turnWorkBody}>{children}</div>
    </details>
  );
}

/** Live companion to the settled turn disclosure. Keeps the elapsed counter
 * compact and stable while a turn is still producing commands and narration. */
export function LiveTurnWorkStatus({
  tools,
  fallbackStartedAt,
}: {
  tools: ToolCardState[];
  fallbackStartedAt?: number;
}) {
  const { locale } = useI18n();
  const fallbackRef = useRef(Date.now());
  const startedAt = useMemo(() => {
    let earliest = Number.POSITIVE_INFINITY;
    for (const tool of tools) {
      const timestamp = Number(tool.startedAt || 0);
      if (timestamp > 0) earliest = Math.min(earliest, timestamp);
    }
    if (Number.isFinite(earliest)) return earliest;
    const fallback = Number(fallbackStartedAt || 0);
    return fallback > 0 ? fallback : fallbackRef.current;
  }, [fallbackStartedAt, tools]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const elapsed = Math.max(0, now - startedAt);
  const label = formatLiveTurnWorkDurationLabel(elapsed, locale);
  return (
    <div className={styles.liveTurnWorkStatus} data-state="running" role="status" aria-live="polite" aria-label={label}>
      <span>{label}</span>
    </div>
  );
}

export function computeTurnDurationMs(tools: ToolCardState[]): number | undefined {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const tool of tools) {
    const started = Number(tool.startedAt || 0);
    const ended = Number(tool.endedAt || tool.updatedAt || 0);
    if (started > 0) {
      start = Math.min(start, started);
      if (tool.durationMs != null && tool.durationMs >= 0) {
        end = Math.max(end, started + tool.durationMs);
      }
    }
    if (ended > 0) end = Math.max(end, ended);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return Math.max(0, end - start);
}

export function formatTurnWorkDurationLabel(durationMs?: number, locale: "tr" | "en" = "tr"): string {
  if (durationMs == null || durationMs < 0) return locale === "en" ? "Work completed" : "Yapılan işlemler";
  if (durationMs < 1000) {
    const value = `${Math.max(1, Math.round(durationMs))}ms`;
    return locale === "en" ? `Worked for ${value}` : `${value} çalıştı`;
  }
  if (durationMs < 60_000) {
    const seconds = Math.max(1, Math.round(durationMs / 1000));
    return locale === "en" ? `Worked for ${seconds}s` : `${seconds}s çalıştı`;
  }
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  if (seconds === 0) return locale === "en" ? `Worked for ${minutes}m` : `${minutes}m çalıştı`;
  const value = `${minutes}m ${seconds}s`;
  return locale === "en" ? `Worked for ${value}` : `${value} çalıştı`;
}

export function formatLiveTurnWorkDurationLabel(durationMs: number, locale: "tr" | "en" = "tr"): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  if (totalSeconds < 60) return locale === "en" ? `Working for ${totalSeconds}s` : `${totalSeconds}s süredir çalışıyor`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const value = `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return locale === "en" ? `Working for ${value}` : `${value} süredir çalışıyor`;
}

export function TurnSemanticFlow({ hasThinking, isStreaming, names, thinkingPreview, turnId, toolSnapshots }: { hasThinking: boolean; isStreaming: boolean; names: string[]; thinkingPreview?: string; turnId?: number; toolSnapshots: ToolCardState[] }) {
  const { locale } = useI18n();
  const nameKey = names.join("\u0001");
  const nameSet = useMemo(() => new Set(names), [nameKey]);
  const historyTools = useMemo(() => selectNoticeHistoryTools(toolSnapshots, nameSet, true), [nameSet, toolSnapshots]);
  const liveTools = useAppStore(useShallow((state) => selectNoticeLiveTools(state.tools, nameSet, turnId, true)));
  const view = useMemo(() => selectToolNoticeView(liveTools, historyTools, nameSet, turnId, true), [historyTools, liveTools, nameSet, turnId]);
  const pending = isStreaming || view.active;
  const headline = useMemo<ToolNoticeHeadline>(() => {
    if (pending && thinkingPreview) {
      const activeCount = view.tools.filter(isActiveTool).length;
      return {
        kind: "thinking",
        verb: "",
        subject: thinkingPreview,
        meta: activeCount > 0 ? `${activeCount} aktif` : undefined,
        live: true,
      };
    }
    if (view.tools.length > 0) return buildToolNoticeHeadline(view.tools, names, pending, locale);
    if (pending && hasThinking) {
      const defaultThinkingHeadline = { kind: "thinking" as const, verb: "", subject: "Düşünüyor", live: true };
      return locale === "en" ? { ...defaultThinkingHeadline, subject: "Thinking" } : defaultThinkingHeadline;
    }
    // kind: "summary", verb: "", subject: "Yanıt hazır" is the Turkish fallback.
    return { kind: "summary", verb: "", subject: locale === "en" ? "Response ready" : "Yanıt hazır" };
  }, [hasThinking, locale, names, pending, thinkingPreview, view.tools]);
  const stickyHeadline = useLastMeaningfulToolHeadline(headline, pending);
  const presentedHeadline = useSemanticFlowHeadline(stickyHeadline);

  return <div className={styles.turnSemanticFlow} role="status" aria-live="polite">
    <SemanticFlowSummary headline={presentedHeadline} />
  </div>;
}

type ToolNoticeHistoryScope = "matching" | "all" | "snapshot";

type FileChangeInspectHandler = (review: TurnDiffView) => void;

type ToolCallNoticeProps = {
  names: string[];
  turnId?: number;
  toolSnapshots: ToolCardState[];
  pendingOverride?: boolean;
  historyScope?: ToolNoticeHistoryScope;
  showSemanticHeadline?: boolean;
  traceEntries?: ToolActivityTraceEntry[];
  thinkingPreview?: string;
  thinkingActive?: boolean;
  activityKey?: string;
  turnDiff?: TurnDiffView;
  onInspectFileChange?: FileChangeInspectHandler;
};

export function ToolCallNotice({ names, turnId, toolSnapshots, pendingOverride, historyScope = "matching", showSemanticHeadline = true, traceEntries = EMPTY_TOOL_ACTIVITY_TRACE, thinkingPreview, thinkingActive = false, activityKey, turnDiff, onInspectFileChange }: ToolCallNoticeProps) {
  const nameKey = names.join("\u0001");
  const nameSet = useMemo(() => new Set(names), [nameKey]);
  const includeAllHistory = historyScope !== "matching";
  const historyTools = useMemo(() => selectNoticeHistoryTools(toolSnapshots, nameSet, includeAllHistory), [includeAllHistory, nameSet, toolSnapshots]);
  // Live ve settled durumlar arasında farklı component tiplerine geçmek Semantic
  // Flow state'ini sıfırlıyordu. Aynı component ömrünü koru ki aktif eylem,
  // sonraki eylem ve final özet gerçekten birbirine morph olabilsin.
  return <LiveToolCallNotice names={names} nameSet={nameSet} turnId={turnId} historyTools={historyTools} pendingOverride={pendingOverride} historyScope={historyScope} showSemanticHeadline={showSemanticHeadline} traceEntries={traceEntries} thinkingPreview={thinkingPreview} thinkingActive={thinkingActive} activityKey={activityKey} turnDiff={turnDiff} onInspectFileChange={onInspectFileChange} />;
}

function LiveToolCallNotice({ names, nameSet, turnId, historyTools, pendingOverride, historyScope, showSemanticHeadline, traceEntries, thinkingPreview, thinkingActive, activityKey, turnDiff, onInspectFileChange }: { names: string[]; nameSet: Set<string>; turnId?: number; historyTools: ToolCardState[]; pendingOverride?: boolean; historyScope: ToolNoticeHistoryScope; showSemanticHeadline: boolean; traceEntries: ToolActivityTraceEntry[]; thinkingPreview?: string; thinkingActive: boolean; activityKey?: string; turnDiff?: TurnDiffView; onInspectFileChange?: FileChangeInspectHandler }) {
  const historyToolIds = useMemo(() => new Set(historyTools.map((tool) => tool.id)), [historyTools]);
  const liveTools = useAppStore(useShallow((s) => historyScope === "snapshot"
    ? selectNoticeSnapshotLiveTools(s.tools, historyToolIds)
    : selectNoticeLiveTools(s.tools, nameSet, turnId, historyScope === "all")));
  return <ToolCallNoticeView names={names} nameSet={nameSet} turnId={turnId} liveTools={liveTools} historyTools={historyTools} pendingOverride={pendingOverride} historyScope={historyScope} showSemanticHeadline={showSemanticHeadline} traceEntries={traceEntries} thinkingPreview={thinkingPreview} thinkingActive={thinkingActive} activityKey={activityKey} turnDiff={turnDiff} onInspectFileChange={onInspectFileChange} />;
}

function ToolCallNoticeView({ names, nameSet, turnId, liveTools, historyTools, pendingOverride, historyScope, showSemanticHeadline, traceEntries, thinkingPreview, thinkingActive, activityKey, turnDiff, onInspectFileChange }: { names: string[]; nameSet: Set<string>; turnId?: number; liveTools: ToolCardState[]; historyTools: ToolCardState[]; pendingOverride?: boolean; historyScope: ToolNoticeHistoryScope; showSemanticHeadline: boolean; traceEntries: ToolActivityTraceEntry[]; thinkingPreview?: string; thinkingActive: boolean; activityKey?: string; turnDiff?: TurnDiffView; onInspectFileChange?: FileChangeInspectHandler }) {
  const { locale, t } = useI18n();
  const view = useMemo(() => selectToolNoticeView(liveTools, historyTools, nameSet, turnId, historyScope !== "matching"), [historyScope, historyTools, liveTools, nameSet, turnId]);
  const streamingTurnId = useAppStore((s) => Number(s.streamingMessage?.turnId || 0));
  const pending = pendingOverride ?? (view.active || (streamingTurnId > 0 && streamingTurnId === turnId));
  const headline = useMemo(
    () => pending && thinkingActive
      ? { kind: "thinking" as const, verb: "", subject: thinkingPreview || (locale === "en" ? "Thinking" : "Düşünüyor"), live: true }
      : buildToolNoticeHeadline(view.tools, names, pending, locale),
    [locale, names, pending, thinkingActive, thinkingPreview, view.tools],
  );
  // Bir turn ilk aracına geçtiğinde araçlar arasındaki kısa boşluklar yeni bir
  // "thinking" fazı değildir. Son anlamlı semantik eylemi koru; sonraki araç
  // doğrudan ondan morph etsin. Turn gerçekten bitince final özet yine kazanır.
  const stickyHeadline = useLastMeaningfulToolHeadline(headline, pending);
  const presentedHeadline = useSemanticFlowHeadline(stickyHeadline);
  const summaryClassName = styles.toolNoticeSummarySemantic;
  const runTools = view.tools.length
    ? view.tools
    : names.map(
        (name) =>
          ({
            id: `pending:${turnId ?? "x"}:${name}`,
            toolName: name,
            status: "streaming",
            turnId,
          }) as ToolCardState,
      );
  const runItems = useMemo<ToolNoticeRunItem[]>(() => {
    const toolById = new Map(runTools.map((tool) => [tool.id, tool]));
    const seenToolIds = new Set<string>();
    const items: ToolNoticeRunItem[] = [];
    for (const entry of traceEntries) {
      const tool = toolById.get(entry.toolId);
      if (!tool || seenToolIds.has(tool.id)) continue;
      seenToolIds.add(tool.id);
      items.push({ kind: "tool", key: entry.key, tool });
    }
    // Live tool snapshots can arrive before their persisted assistant message.
    // Keep them visible, then adopt the persisted chronological position later.
    for (const tool of runTools) {
      if (seenToolIds.has(tool.id)) continue;
      items.push({ kind: "tool", key: `tool:${tool.id}`, tool });
    }
    return items;
  }, [runTools, traceEntries]);
  // Cheap mutation summary for the headline only (cached per tool).
  const mutationRows = useMemo(() => collectToolFileMutationRows(runTools), [runTools]);
  const inlineActivityBatch = mutationRows.length > 0
    && runTools.every((tool) => toolFileMutationsModel(tool).length > 0 || isCommandTool(tool.toolName));
  const inlineCommandTools = inlineActivityBatch
    ? runTools.filter((tool) => toolFileMutationsModel(tool).length === 0 && isCommandTool(tool.toolName))
    : [];
  // NEVER auto-open: even "1 işlem" with a huge payload freezes if we mount bodies on toggle.
  const [open, setOpen] = useDetailsOpen(activityKey ? `notice:${activityKey}` : noticeOpenKey(turnId, names), false);
  // Defer mounting rows one frame so the click paints and the UI stays responsive.
  const [bodyReady, setBodyReady] = useState(false);
  useEffect(() => {
    if (!open) {
      setBodyReady(false);
      return;
    }
    let cancelled = false;
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!cancelled) startTransition(() => setBodyReady(true));
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(id);
    };
  }, [open]);
  const showList = open && bodyReady;
  const listScrollRef = useToolRunScrollFade(`${runItems.length}:${showList ? 1 : 0}:${inlineActivityBatch ? "m" : "t"}`);
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const setScrollRefs = useCallback((node: HTMLDivElement | null) => {
    scrollParentRef.current = node;
    listScrollRef.current = node;
    if (node) updateToolRunScrollFade(node);
  }, [listScrollRef]);

  // TanStack Virtual — only actual tool execution rows belong to history.
  const rowVirtualizer = useVirtualizer({
    count: showList ? runItems.length : 0,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => inlineActivityBatch ? 40 : 30,
    overscan: 5,
    getItemKey: (index) => runItems[index]?.key || `activity:${index}`,
  });

  const renderToolRow = (tool: ToolCardState) => {
    const rows = collectToolFileMutationRows([tool]);
    if (rows.length) {
      return (
        <React.Fragment>
          {rows.map((row) => (
            <FileMutationRunRow row={row} key={row.key} turnDiff={turnDiff} turnId={turnId} locale={locale} onInspectFileChange={onInspectFileChange} />
          ))}
        </React.Fragment>
      );
    }
    // Always collapsible summary rows — never hideSummary (that mounted full
    // highlighted bodies on open and froze Electron for "1 işlem çalıştırıldı").
    return (
      <ToolRunDetails
        compactCommand={inlineActivityBatch || isCommandTool(tool.toolName)}
        tool={tool}
        hideSummary={false}
      />
    );
  };

  const virtualItems = showList ? rowVirtualizer.getVirtualItems() : [];
  const totalSize = showList ? rowVirtualizer.getTotalSize() : 0;

  return <details
    className={`${styles.toolNotice} ${showSemanticHeadline || inlineActivityBatch ? "" : styles.toolNoticeDetailsOnly} ${inlineActivityBatch ? styles.inlineActivityNotice : ""}`}
    open={open}
    onToggle={(event) => {
      const next = event.currentTarget.open;
      startTransition(() => setOpen(next));
    }}
  >
    {inlineActivityBatch ? (
      <summary className={styles.toolNoticeSummaryMutation}>
        <FileMutationBatchSummary rows={mutationRows} commands={inlineCommandTools} turnDiff={turnDiff} turnId={turnId} locale={locale} onInspectFileChange={onInspectFileChange} />
      </summary>
    ) : showSemanticHeadline ? (
      <summary className={summaryClassName}>
        <SemanticFlowSummary headline={presentedHeadline} />
      </summary>
    ) : (
      <summary className={styles.toolDetailsSummary}>{t("tools.activity.details")} <span>{runTools.length}</span></summary>
    )}
    {open && !bodyReady ? (
      <div className={styles.toolRunLoading} aria-live="polite">{t("tools.activity.loading")}</div>
    ) : null}
    {showList ? (
      <div
        ref={setScrollRefs}
        className={`${inlineActivityBatch ? styles.fileMutationRunList : styles.toolRunList} ${styles.toolRunScrollBody} ${styles.toolRunVirtual}`}
      >
        <div
          className={styles.toolRunVirtualInner}
          style={{ height: totalSize, width: "100%", position: "relative" }}
        >
          {virtualItems.map((item) => {
            const runItem = runItems[item.index];
            if (!runItem) return null;
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={rowVirtualizer.measureElement}
                className={styles.toolRunVirtualRow}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {renderToolRow(runItem.tool)}
              </div>
            );
          })}
        </div>
      </div>
    ) : null}
  </details>;
}

type ToolFileMutationRow = {
  key: string;
  mutation: ToolFileMutation;
  tool: ToolCardState;
  active: boolean;
};

function collectToolFileMutationRows(tools: ToolCardState[]): ToolFileMutationRow[] {
  const rows: ToolFileMutationRow[] = [];
  for (const tool of tools) {
    const mutations = toolFileMutationsModel(tool);
    mutations.forEach((mutation, index) => {
      rows.push({
        key: `${tool.id}:${mutation.path}:${mutation.kind}:${index}`,
        mutation,
        tool,
        active: isActiveToolModel(tool),
      });
    });
  }
  return rows;
}

function mutationLineStats(row: ToolFileMutationRow): ToolLineStats {
  const mutations = toolFileMutationsModel(row.tool);
  const liveStats = toolLineStatsModel(row.tool);
  const useToolTotals = mutations.length === 1;
  return {
    added: useToolTotals ? Math.max(row.mutation.added, liveStats.added) : row.mutation.added,
    removed: useToolTotals ? Math.max(row.mutation.removed, liveStats.removed) : row.mutation.removed,
    filesCreated: row.mutation.kind === "create" ? 1 : 0,
    filesDeleted: row.mutation.kind === "delete" ? 1 : 0,
    kind: row.mutation.kind,
  };
}

function buildMutationReview(row: ToolFileMutationRow, turnDiff?: TurnDiffView, turnId?: number, locale: "tr" | "en" = "tr"): TurnDiffView {
  const stats = mutationLineStats(row);
  const path = row.mutation.path;
  return buildSingleFileReview({
    path,
    kind: row.mutation.kind,
    diff: resolveRowDiff(row.tool, path, turnDiff, row.mutation.kind),
    added: stats.added,
    removed: stats.removed,
    previousPath: row.mutation.previousPath,
  }, {
    turnId: turnId ?? row.tool.turnId,
    label: `${compactMutationPath(path)} ${locale === "en" ? "change" : "değişikliği"}`,
    liveSource: {
      toolId: row.tool.id,
      path,
      kind: row.mutation.kind,
    },
  });
}

function LiveCommandTimer({ startedAt }: { startedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return null;
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const formatted = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return <span style={{ opacity: 0.85, fontFamily: "var(--font-mono)", fontSize: "11.5px", marginLeft: 4 }}>· {formatted}</span>;
}

function FileMutationBatchSummary({ rows, commands, turnDiff, turnId, locale, onInspectFileChange }: { rows: ToolFileMutationRow[]; commands: ToolCardState[]; turnDiff?: TurnDiffView; turnId?: number; locale: "tr" | "en"; onInspectFileChange?: FileChangeInspectHandler }) {
  const fileFailed = rows.some((row) => row.tool.status === "error");
  const fileActive = rows.some((row) => row.active);
  const uniqueFileCount = new Set(rows.map((row) => row.mutation.path.toLowerCase())).size;
  const singleRow = uniqueFileCount === 1 ? rows[0] : undefined;
  const singlePath = singleRow ? compactMutationPath(singleRow.mutation.path) : undefined;
  const singleKind = rows.some((row) => row.mutation.kind === "delete")
    ? "delete"
    : rows.some((row) => row.mutation.kind === "create")
      ? "create"
      : "modify";
  // Legacy source contract: mutationActionLabel(singleKind, fileActive, fileFailed)
  const fileLabel = singleRow && singlePath
    ? mutationActionLabel(singleKind, fileActive, fileFailed, locale)
    : fileFailed
      ? (locale === "en" ? "Some files could not be edited" : "Bazı dosyalar düzenlenemedi")
      : fileActive ? (locale === "en" ? "Files being edited" : "Dosyalar düzenleniyor") : (locale === "en" ? "Files edited" : "Dosyalar düzenlendi");
  const totals = rows.reduce((sum, row) => {
    const mutations = toolFileMutationsModel(row.tool);
    const liveStats = toolLineStatsModel(row.tool);
    sum.added += mutations.length === 1 ? Math.max(row.mutation.added, liveStats.added) : row.mutation.added;
    sum.removed += mutations.length === 1 ? Math.max(row.mutation.removed, liveStats.removed) : row.mutation.removed;
    return sum;
  }, { added: 0, removed: 0 });

  const commandFailed = commands.some((tool) => tool.status === "error");
  const commandActive = commands.some((tool) => isActiveToolModel(tool));
  const activeCommandTool = commands.find((tool) => isActiveToolModel(tool));
  const commandLabel = commands.length === 0
    ? ""
    : commandFailed
      ? commands.length === 1 ? (locale === "en" ? "one command failed" : "bir komut başarısız oldu") : (locale === "en" ? "some commands failed" : "bazı komutlar başarısız oldu")
      : commandActive
        ? locale === "en" ? (commands.length === 1 ? "Running command" : `Running ${commands.length} commands`) : (commands.length === 1 ? "Komut çalışıyor" : `${commands.length} komut çalışıyor`)
        : locale === "en" ? `Ran ${commands.length} ${commands.length === 1 ? "command" : "commands"}` : `${commands.length} komut çalıştırıldı`;
  const showPendingStats = fileActive && totals.added === 0 && totals.removed === 0;
  const inspectSingleFile = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!singleRow || !onInspectFileChange) return;
    event.preventDefault();
    event.stopPropagation();
    onInspectFileChange(buildMutationReview(singleRow, turnDiff, turnId, locale));
  };

  return <span className={styles.toolNoticeMutationSummary}>
    <MutationPencilIcon />
    <span className={fileActive && !fileFailed ? styles.toolNoticeMutationStateLive : styles.toolNoticeMutationState}>{fileLabel}</span>
    {singlePath && singleRow && onInspectFileChange ? (
      <button
        type="button"
        className={`${styles.toolNoticeMutationFile} ${styles.toolNoticeMutationFileButton}`}
        title={`${singleRow.mutation.path} · ${locale === "en" ? "Open in inspector" : "İnceleme panelinde aç"}`}
        aria-label={`${singleRow.mutation.path} · ${locale === "en" ? "inspect change" : "değişikliği incele"}`}
        onClick={inspectSingleFile}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {singlePath}
      </button>
    ) : singlePath ? (
      <span className={styles.toolNoticeMutationFile} title={singleRow?.mutation.path}>{singlePath}</span>
    ) : null}
    {(showPendingStats || totals.added > 0 || totals.removed > 0) && (
      <span className={styles.toolNoticeMutationDelta} aria-label={`+${totals.added} -${totals.removed}`}>
        <span className={`${styles.toolNoticeMutationAdded} ${totals.added === 0 ? styles.toolNoticeMutationZero : ""}`}>
          {showPendingStats ? "+" : `+${totals.added}`}
        </span>
        <span className={`${styles.toolNoticeMutationRemoved} ${totals.removed === 0 ? styles.toolNoticeMutationZero : ""}`}>
          {showPendingStats ? "−" : `−${totals.removed}`}
        </span>
      </span>
    )}
    {commandLabel && (
      <span className={commandActive && !commandFailed ? styles.toolNoticeMutationStateLive : styles.toolNoticeMutationState}>
        {commandLabel}
        {commandActive && activeCommandTool && (
          <LiveCommandTimer startedAt={activeCommandTool.startedAt} />
        )}
      </span>
    )}
  </span>;
}

function FileMutationRunRow({ row, turnDiff, turnId, locale, onInspectFileChange }: { row: ToolFileMutationRow; turnDiff?: TurnDiffView; turnId?: number; locale: "tr" | "en"; onInspectFileChange?: FileChangeInspectHandler }) {
  const { mutation, tool, active } = row;
  const failed = tool.status === "error";
  const displayPath = compactMutationPath(mutation.path);
  // Legacy source contract: const action = mutationActionLabel(mutation.kind, active, failed);
  // Legacy source contract: buildMutationReview(row, turnDiff, turnId)
  // Legacy source contract: değişikliğini İnceleme panelinde aç
  const action = mutationActionLabel(mutation.kind, active, failed, locale);
  const lineStats = mutationLineStats(row);
  const inspectChange = onInspectFileChange
    ? () => onInspectFileChange(buildMutationReview(row, turnDiff, turnId, locale))
    : undefined;

  // Same tool-row chrome: verb + path + +/-; filename opens this exact review.
  return (
    <ToolRunDetails
      tool={tool}
      compactCommand
      compactMutation
      showLineStats
      lineStatsOverride={lineStats}
      openFileOnSubjectClick
      openKeyOverride={`mutation:${row.key}`}
      actionOverride={action}
      subjectOverride={displayPath}
      filePathOverride={mutation.path}
      panelSubjectOverride={displayPath}
      panelTitleOverride={action}
      onFileChangeClick={inspectChange ? () => inspectChange() : undefined}
      fileChangeClickTitle={inspectChange ? `${mutation.path} · ${locale === "en" ? "Open in inspector" : "İnceleme panelinde aç"}` : undefined}
    />
  );
}

/** Live and settled mutations keep the same verb-based visual family. */
function mutationActionLabel(kind: ToolFileMutation["kind"], active: boolean, failed: boolean, locale: "tr" | "en" = "tr"): string {
  // Legacy Turkish contracts: return active ? "Düzenleniyor" : "Düzenlendi"; / return active ? "Oluşturuluyor" : "Oluşturuldu";
  if (failed) {
    if (kind === "create") return locale === "en" ? "Could not create" : "Oluşturulamadı";
    if (kind === "delete") return locale === "en" ? "Could not delete" : "Silinemedi";
    return locale === "en" ? "Could not edit" : "Düzenlenemedi";
  }
  if (kind === "create") return active ? (locale === "en" ? "Creating" : "Oluşturuluyor") : (locale === "en" ? "Created" : "Oluşturuldu");
  if (kind === "delete") return active ? (locale === "en" ? "Deleting" : "Siliniyor") : (locale === "en" ? "Deleted" : "Silindi");
  return active ? (locale === "en" ? "Editing" : "Düzenleniyor") : (locale === "en" ? "Edited" : "Düzenlendi");
}

function compactMutationPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) || path;
}

type ToolNoticeView = { tools: ToolCardState[]; active: boolean };

function selectNoticeHistoryTools(toolSnapshots: ToolCardState[], nameSet: Set<string>, includeAll = false): ToolCardState[] {
  const historyTools: ToolCardState[] = [];
  for (const tool of toolSnapshots) {
    if (includeAll || nameSet.has(tool.toolName)) pushBoundedLiveTool(historyTools, tool);
  }
  return historyTools;
}

function selectToolNoticeView(liveTools: ToolCardState[], historyTools: ToolCardState[], nameSet: Set<string>, turnId?: number, includeAll = false): ToolNoticeView {
  const merged = new Map<string, ToolCardState>();
  for (const tool of historyTools) mergeNoticeTool(merged, tool);
  for (const tool of liveTools) mergeNoticeTool(merged, tool);
  if (turnId && !includeAll) {
    const turnTools: ToolCardState[] = [];
    for (const tool of merged.values()) {
      if (tool.turnId !== turnId) continue;
      pushBoundedLiveTool(turnTools, tool);
    }
    if (turnTools.some((tool) => nameSet.has(tool.toolName))) return finalizeToolNoticeView(turnTools);
  }
  if (includeAll) {
    const allTools: ToolCardState[] = [];
    for (const tool of merged.values()) pushBoundedLiveTool(allTools, tool);
    return finalizeToolNoticeView(allTools);
  }
  const matching: ToolCardState[] = [];
  let latest: ToolCardState | undefined;
  for (const tool of merged.values()) {
    if (!nameSet.has(tool.toolName)) continue;
    pushBoundedLiveTool(matching, tool);
    if (!latest || noticeToolTime(tool) > noticeToolTime(latest)) latest = tool;
  }
  if (!latest?.turnId) return finalizeToolNoticeView(matching);
  const scoped: ToolCardState[] = [];
  for (const tool of merged.values()) {
    if (tool.turnId === latest.turnId) pushBoundedLiveTool(scoped, tool);
  }
  return finalizeToolNoticeView(scoped.length ? scoped : matching);
}

function mergeNoticeTool(target: Map<string, ToolCardState>, tool: ToolCardState) {
  const existing = target.get(tool.id);
  target.set(tool.id, existing ? { ...existing, ...tool, details: tool.details ?? existing.details, output: tool.output ?? existing.output, args: tool.args ?? existing.args, images: tool.images ?? existing.images } : tool);
}

function finalizeToolNoticeView(tools: ToolCardState[]): ToolNoticeView {
  const visible: ToolCardState[] = [];
  let active = false;
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index];
    visible.push(tool);
    if (isActiveTool(tool)) active = true;
  }
  return { tools: visible, active };
}

function selectNoticeLiveTools(toolMap: Record<string, ToolCardState>, nameSet: Set<string>, turnId?: number, includeAll = false): ToolCardState[] {
  if (turnId) {
    const turnTools: ToolCardState[] = [];
    for (const id in toolMap) {
      const tool = toolMap[id];
      if (tool.turnId !== turnId) continue;
      pushBoundedLiveTool(turnTools, tool);
    }
    if (includeAll ? turnTools.length > 0 : turnTools.some((tool) => nameSet.has(tool.toolName))) return turnTools;
  }
  const matching: ToolCardState[] = [];
  let latest: ToolCardState | undefined;
  for (const id in toolMap) {
    const tool = toolMap[id];
    if (!nameSet.has(tool.toolName)) continue;
    pushBoundedLiveTool(matching, tool);
    if (!latest || (tool.updatedAt || 0) > (latest.updatedAt || 0)) latest = tool;
  }
  if (!latest?.turnId) return matching;
  const scoped: ToolCardState[] = [];
  for (const id in toolMap) {
    const tool = toolMap[id];
    if (tool.turnId === latest.turnId) pushBoundedLiveTool(scoped, tool);
  }
  return scoped.length ? scoped : matching;
}

function pushBoundedLiveTool(target: ToolCardState[], tool: ToolCardState) {
  if (NOTICE_LIVE_TOOL_LIMIT <= 0) return;
  const time = noticeToolTime(tool);
  if (target.length < NOTICE_LIVE_TOOL_LIMIT) {
    const index = target.findIndex((entry) => time > noticeToolTime(entry));
    target.splice(index < 0 ? target.length : index, 0, tool);
    return;
  }
  if (time <= noticeToolTime(target[target.length - 1])) return;
  const index = target.findIndex((entry) => time > noticeToolTime(entry));
  target.splice(index < 0 ? target.length : index, 0, tool);
  target.length = NOTICE_LIVE_TOOL_LIMIT;
}

function noticeToolTime(tool: ToolCardState): number {
  return toolSortTimeModel(tool);
}

function isActiveTool(tool: ToolCardState): boolean {
  return isActiveToolModel(tool);
}
