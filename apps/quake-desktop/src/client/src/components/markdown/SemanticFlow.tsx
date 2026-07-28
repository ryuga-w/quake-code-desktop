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
import type { ToolActivityLocale } from "../../lib/tool-activity";
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

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function TypewriterThought({ text, shimmer }: { text: string; shimmer: boolean }) {
  const [visibleText, setVisibleText] = useState("");
  const visibleRef = useRef("");
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (frameRef.current !== undefined) window.cancelAnimationFrame(frameRef.current);

    const reducedMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !text) {
      visibleRef.current = text;
      setVisibleText(text);
      frameRef.current = undefined;
      return undefined;
    }

    const prefixLength = commonPrefixLength(visibleRef.current, text);
    const prefix = text.slice(0, prefixLength);
    visibleRef.current = prefix;
    setVisibleText(prefix);

    const remaining = text.length - prefixLength;
    if (remaining <= 0) {
      frameRef.current = undefined;
      return undefined;
    }

    const duration = Math.min(520, Math.max(120, remaining * 6));
    const startedAt = performance.now();
    const writeFrame = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const nextLength = prefixLength + Math.max(1, Math.floor(remaining * progress));
      const nextText = text.slice(0, nextLength);
      if (nextText !== visibleRef.current) {
        visibleRef.current = nextText;
        setVisibleText(nextText);
      }
      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(writeFrame);
      } else {
        frameRef.current = undefined;
      }
    };

    frameRef.current = window.requestAnimationFrame(writeFrame);
    return () => {
      if (frameRef.current !== undefined) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    };
  }, [text]);

  const typing = visibleText.length < text.length;
  return (
    <span className={styles.toolSemanticSubject} aria-label={text}>
      <span className={styles.toolSemanticTypewriterVisual} aria-hidden="true">
        <span className={`${styles.toolSemanticTypewriterCopy} ${shimmer ? styles.toolSemanticThoughtShimmer : ""}`}>
          {visibleText}
        </span>
        {typing && <i className={styles.toolSemanticTypewriterCaret} />}
      </span>
    </span>
  );
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
    {subject && (liveThought
      ? <TypewriterThought text={subject} shimmer={shimmerSubject} />
      : <span className={styles.toolSemanticSubject}>{subject}</span>)}
    {displayed.meta && <span className={styles.toolSemanticMeta}>{displayed.meta}</span>}
  </span>;
}

export function buildToolNoticeHeadline(tools: ToolCardState[], names: string[], pending: boolean, locale: ToolActivityLocale = "tr"): ToolNoticeHeadline {
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

function buildConcurrentToolHeadline(activeTools: ToolCardState[], locale: ToolActivityLocale = "tr"): ToolNoticeHeadline {
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

function toolNoticeCommandLabel(activity: ReturnType<typeof getToolActivity>, locale: ToolActivityLocale = "tr"): string {
  const candidate = [activity.subject, activity.argsSummary, activity.panelSubject, activity.displayName].find((value) => typeof value === "string" && value.trim());
  if (!candidate) return locale === "en" ? "Running command" : "Komut çalışıyor";
  return String(candidate).replace(/^\$\s*/, "");
}
