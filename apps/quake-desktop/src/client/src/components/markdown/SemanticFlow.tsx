import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  getToolActivity,
  isSubagentTool,
  isActiveTool,
  isBrowserTool,
  isCommandTool,
  isReadTool,
  summarizeToolBatch,
} from "../../lib/tool-activity";
import type { ToolCardState } from "../../state/app-store";
import styles from "./MarkdownMessage.module.css";

export function SemanticFlowSummary({ headline }: { headline: ToolNoticeHeadline }) {
  // Text-only status line — no orb/status rings. Settled and live share one type size/color.
  return (
    <span className={styles.toolTitleRow} data-kind={headline.kind}>
      <SemanticHeadlineTransition headline={headline} />
    </span>
  );
}

export type ToolNoticeHeadline = {
  kind: "thinking" | "read" | "search" | "edit" | "command" | "browser" | "summary" | "error";
  verb: string;
  subject: string;
  meta?: string;
  live?: boolean;
};

const SEMANTIC_FLOW_MIN_HOLD_MS = 850;
const SEMANTIC_FLOW_COALESCE_MS = 140;
const SEMANTIC_FLOW_LIVE_MIN_HOLD_MS = 360;
const SEMANTIC_FLOW_LIVE_COALESCE_MS = 70;

function isGenericThinkingFallback(headline: ToolNoticeHeadline): boolean {
  return headline.kind === "thinking"
    && !headline.verb
    && (!headline.subject || headline.subject === "Düşünüyor");
}

export function useLastMeaningfulToolHeadline(headline: ToolNoticeHeadline, pending: boolean): ToolNoticeHeadline {
  const lastMeaningfulRef = useRef<ToolNoticeHeadline | undefined>(
    pending && !isGenericThinkingFallback(headline) ? headline : undefined,
  );

  // Final özet her zaman görünür; fakat aynı grup sonradan yeni bir araç alırsa
  // settled özeti canlı aktivite belleği olarak yeniden kullanma.
  if (!pending) return headline;
  if (!isGenericThinkingFallback(headline)) {
    lastMeaningfulRef.current = headline;
    return headline;
  }

  return lastMeaningfulRef.current || headline;
}

function headlineSignature(headline: ToolNoticeHeadline): string {
  return `${headline.kind}\u0001${headline.verb}\u0001${headline.subject}\u0001${headline.meta || ""}\u0001${headline.live ? "live" : ""}`;
}

/**
 * Tool events can arrive faster than a person can read them. Keep the stable
 * Semantic Flow surface alive, coalesce transient snapshots, and present only
 * the newest meaningful state after the current one has had time to breathe.
 */
export function useSemanticFlowHeadline(headline: ToolNoticeHeadline): ToolNoticeHeadline {
  const [presented, setPresented] = useState(headline);
  const presentedRef = useRef(headline);
  const pendingRef = useRef(headline);
  const shownAtRef = useRef(typeof performance === "undefined" ? 0 : performance.now());
  const timerRef = useRef<number | undefined>(undefined);
  const incomingSignature = headlineSignature(headline);
  pendingRef.current = headline;

  useEffect(() => {
    if (headlineSignature(presentedRef.current) === incomingSignature) return;
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);

    const now = performance.now();
    const heldFor = now - shownAtRef.current;
    const liveUpdate = Boolean(headline.live || presentedRef.current.live);
    const minHold = liveUpdate ? SEMANTIC_FLOW_LIVE_MIN_HOLD_MS : SEMANTIC_FLOW_MIN_HOLD_MS;
    const coalesce = liveUpdate ? SEMANTIC_FLOW_LIVE_COALESCE_MS : SEMANTIC_FLOW_COALESCE_MS;
    const remainingHold = Math.max(0, minHold - heldFor);
    const delay = Math.max(coalesce, remainingHold);
    timerRef.current = window.setTimeout(() => {
      const next = pendingRef.current;
      if (headlineSignature(presentedRef.current) !== headlineSignature(next)) {
        presentedRef.current = next;
        shownAtRef.current = performance.now();
        setPresented(next);
      }
      timerRef.current = undefined;
    }, delay);
  }, [incomingSignature]);

  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
  }, []);

  return presented;
}

const SEMANTIC_FLOW_LEAVE_MS = 240;
const SEMANTIC_FLOW_ENTER_MS = 480;
const SEMANTIC_FLOW_LIVE_LEAVE_MS = 110;
const SEMANTIC_FLOW_LIVE_ENTER_MS = 220;

type SemanticFlowPhase = "settled" | "leaving" | "entering";

function SemanticHeadlineTransition({ headline }: { headline: ToolNoticeHeadline }) {
  const [displayed, setDisplayed] = useState(headline);
  const [phase, setPhase] = useState<SemanticFlowPhase>("settled");
  const displayedRef = useRef(headline);
  const latestRef = useRef(headline);
  const phaseRef = useRef<SemanticFlowPhase>("settled");
  const timerRef = useRef<number | undefined>(undefined);
  const signature = headlineSignature(headline);
  latestRef.current = headline;

  const setFlowPhase = useCallback((next: SemanticFlowPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const beginLeave = useCallback(() => {
    if (phaseRef.current === "leaving") return;
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    setFlowPhase("leaving");
    const leaveMs = displayedRef.current.live || latestRef.current.live ? SEMANTIC_FLOW_LIVE_LEAVE_MS : SEMANTIC_FLOW_LEAVE_MS;
    timerRef.current = window.setTimeout(() => {
      const next = latestRef.current;
      displayedRef.current = next;
      setDisplayed(next);
      setFlowPhase("entering");
      const enterMs = next.live ? SEMANTIC_FLOW_LIVE_ENTER_MS : SEMANTIC_FLOW_ENTER_MS;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = undefined;
        setFlowPhase("settled");
        if (headlineSignature(displayedRef.current) !== headlineSignature(latestRef.current)) beginLeave();
      }, enterMs);
    }, leaveMs);
  }, [setFlowPhase]);

  React.useLayoutEffect(() => {
    if (headlineSignature(displayedRef.current) === signature) return;
    // Bir geçiş sürerken gelen snapshot'lar kuyruklanmaz. latestRef yalnızca en
    // güncel birleşik durumu tutar ve mevcut faz bitince doğrudan ona geçilir.
    if (phaseRef.current === "settled") beginLeave();
  }, [beginLeave, signature]);

  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
  }, []);

  const phaseClassName = phase === "leaving"
    ? styles.toolSemanticLeaving
    : phase === "entering"
      ? styles.toolSemanticEntering
      : "";

  const subject = displayed.subject
    || (displayed.kind === "thinking" ? "Düşünüyor" : "");
  const liveThought = Boolean(displayed.live || (displayed.kind === "thinking" && !displayed.verb));
  const shimmerSubject = liveThought && Boolean(subject);
  // Settled summary/error: one unified line (same size/color), no split "İşlem özeti" vs body.
  const settledOneLiner = (displayed.kind === "summary" || displayed.kind === "error")
    && !displayed.live;
  const settledText = settledOneLiner
    ? [displayed.verb, subject, displayed.meta].filter(Boolean).join(displayed.kind === "error" && displayed.verb && subject ? " · " : " ").trim()
    : "";

  if (settledOneLiner && settledText) {
    return <span className={`${styles.toolSemanticHeadline} ${styles.toolSemanticSettled} ${phaseClassName}`}>
      <span className={styles.toolSemanticLine}>{settledText}</span>
    </span>;
  }

  return <span className={`${styles.toolSemanticHeadline} ${liveThought ? styles.toolSemanticLiveThought : ""} ${styles.toolSemanticUnified} ${phaseClassName}`}>
    {displayed.verb && <span className={styles.toolSemanticVerb}>{displayed.verb}</span>}
    {subject && <span className={`${styles.toolSemanticSubject} ${shimmerSubject ? styles.toolSemanticThoughtShimmer : ""}`}>{subject}</span>}
    {displayed.meta && <span className={styles.toolSemanticMeta}>{displayed.meta}</span>}
  </span>;
}

export function buildToolNoticeHeadline(tools: ToolCardState[], names: string[], pending: boolean): ToolNoticeHeadline {
  const activeTools = pending ? tools.filter(isActiveTool) : [];
  if (activeTools.length > 0 && activeTools.every((tool) => isSubagentTool(tool.toolName))) {
    return {
      kind: "thinking",
      verb: activeTools.length === 1 ? "Oluşturuluyor" : `${activeTools.length} ajan`,
      subject: activeTools.length === 1 ? "bir ajan" : "oluşturuluyor",
      meta: activeTools.length > 1 ? `${activeTools.length} aktif` : undefined,
    };
  }
  if (activeTools.length > 1) return buildConcurrentToolHeadline(activeTools);
  const activeTool = activeTools[0];
  if (activeTool) {
    const activity = getToolActivity(activeTool);
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
    if (isCommandTool(activeTool.toolName)) return { kind: "command", verb: activity.actionLabel, subject: toolNoticeCommandLabel(activity) };
    if (isReadTool(activeTool.toolName)) return { kind: "read", verb: activity.actionLabel, subject: toolNoticeMutationSubject(activity) };
    if (isWebSearchActivityTool(activeTool.toolName)) return { kind: "search", verb: "Web aranıyor", subject: activity.subject };
    if (isSearchActivityTool(activeTool.toolName)) return { kind: "search", verb: activity.actionLabel, subject: activity.subject };
    if (isBrowserTool(activeTool.toolName)) return { kind: "browser", verb: activity.actionLabel, subject: activity.subject };
    return { kind: "thinking", verb: activity.actionLabel, subject: activity.subject };
  }
  if (pending) return { kind: "thinking", verb: "", subject: "Düşünüyor", live: true };
  const hasError = tools.some((tool) => tool.status === "error");
  const batch = summarizeToolBatch(tools, names);
  return hasError
    ? { kind: "error", verb: "", subject: batch || "Araç hatası" }
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

function buildConcurrentToolHeadline(activeTools: ToolCardState[]): ToolNoticeHeadline {
  const counts: ConcurrentToolCounts = { reads: 0, searches: 0, creates: 0, edits: 0, deletes: 0, commands: 0, browsers: 0, other: 0 };
  for (const tool of activeTools) {
    const activity = getToolActivity(tool);
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
  let verb = "İşleniyor";
  if (categories === 1 && counts.reads) { kind = "read"; verb = "Reading"; }
  else if (categories === 1 && counts.searches) { kind = "search"; verb = "Aranıyor"; }
  else if (categories === 1 && mutations) { kind = "edit"; verb = "Düzenleniyor"; }
  else if (categories === 1 && counts.commands) { kind = "command"; verb = "Running commands"; }
  else if (categories === 1 && counts.browsers) { kind = "browser"; verb = "Geziniyor"; }
  else if (counts.reads && counts.searches && categories === 2) { kind = "search"; verb = "İnceleniyor"; }
  else if (mutations) kind = "edit";
  else if (counts.commands) kind = "command";
  else if (counts.browsers) kind = "browser";
  else if (counts.searches) kind = "search";
  else if (counts.reads) kind = "read";

  const parts = [
    counts.reads ? `${counts.reads} dosya` : "",
    counts.searches ? `${counts.searches} arama` : "",
    counts.creates ? `${counts.creates} oluşturma` : "",
    counts.edits ? `${counts.edits} düzenleme` : "",
    counts.deletes ? `${counts.deletes} silme` : "",
    counts.commands ? `${counts.commands} komut` : "",
    counts.browsers ? `${counts.browsers} tarayıcı` : "",
    counts.other ? `${counts.other} araç` : "",
  ].filter(Boolean);

  return {
    kind,
    verb,
    subject: parts.join(" · "),
    meta: `${activeTools.length} aktif`,
  };
}

function toolNoticeMutationSubject(activity: ReturnType<typeof getToolActivity>): string {
  const candidates = [activity.panelSubject, activity.subject, activity.argsSummary]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => String(value).replace(/^(reading|okunuyor|yazılıyor|oluşturuluyor|düzenleniyor|siliniyor)\s+/i, "").trim())
    .filter((value) => value && !/^(yeni\s*dosya|new\s*file|dosya|file|unnamed|untitled)$/i.test(value));

  const candidate = candidates[0];
  if (!candidate) return activity.displayName;

  const normalized = candidate.replace(/\\/g, "/");
  // "Oluşturuluyor apps/foo.md" gibi önek kalmışsa son path parçasını al
  const pathish = normalized.match(/((?:[\w.-]+[\\/])*[\w.-]+\.[A-Za-z0-9]{1,12})$/);
  const segment = (pathish?.[1] || normalized).split("/").filter(Boolean).pop() || normalized;
  return segment.length > 56 ? `${segment.slice(0, 55)}…` : segment;
}

function isWebSearchActivityTool(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "web_search" || normalized === "search_web";
}

function isSearchActivityTool(name: string): boolean {
  const normalized = name.toLowerCase();
  return ["grep", "find", "ls", "list_dir", "ls_dir", "grep_search"].includes(normalized) || normalized.includes("search") || normalized.includes("glob");
}

function toolNoticeCommandLabel(activity: ReturnType<typeof getToolActivity>): string {
  const candidate = [activity.subject, activity.argsSummary, activity.panelSubject, activity.displayName].find((value) => typeof value === "string" && value.trim());
  if (!candidate) return "Komut çalışıyor";
  return String(candidate).replace(/^\$\s*/, "");
}
