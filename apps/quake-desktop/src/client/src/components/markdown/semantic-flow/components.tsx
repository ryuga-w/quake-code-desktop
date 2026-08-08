import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MousePointer2 } from "lucide-react";
import { formatBrowserAddress } from "../../../lib/tool-activity";
import styles from "../MarkdownMessage.module.css";
import type { SemanticFlowPhase, ToolNoticeHeadline } from "./types";
import { commonPrefixLength, headlineSignature } from "./builders";
import {
  SEMANTIC_FLOW_ENTER_MS,
  SEMANTIC_FLOW_LEAVE_MS,
  SEMANTIC_FLOW_LIVE_ENTER_MS,
  SEMANTIC_FLOW_LIVE_LEAVE_MS,
} from "./constants";

export function SemanticFlowSummary({ headline }: { headline: ToolNoticeHeadline }) {
  return (
    <span className={styles.toolTitleRow} data-kind={headline.kind}>
      <SemanticHeadlineTransition headline={headline} />
    </span>
  );
}

export function TypewriterThought({ text, shimmer }: { text: string; shimmer: boolean }) {
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

export function SemanticHeadlineTransition({ headline }: { headline: ToolNoticeHeadline }) {
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

  useLayoutEffect(() => {
    if (headlineSignature(displayedRef.current) === signature) return;
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
  const settledOneLiner = (displayed.kind === "summary" || displayed.kind === "error")
    && !displayed.live;
  const settledText = settledOneLiner
    ? [displayed.verb, subject, displayed.meta].filter(Boolean).join(displayed.kind === "error" && displayed.verb && subject ? " · " : " ").trim()
    : "";

  if (settledOneLiner && settledText) {
    return <span className={`${styles.toolSemanticHeadline} ${styles.toolSemanticSettled} ${phaseClassName}`} data-kind={displayed.kind}>
      <span className={styles.toolSemanticLine}>{settledText}</span>
    </span>;
  }

  if (displayed.kind === "browser" && subject) {
    const address = formatBrowserAddress(subject);
    return <span
      className={`${styles.toolSemanticHeadline} ${styles.toolSemanticUnified} ${styles.toolSemanticBrowser} ${phaseClassName}`}
      data-kind={displayed.kind}
      aria-label={displayed.verb ? `${displayed.verb} ${address}` : address}
    >
      <span className={styles.toolSemanticBrowserCursor} aria-hidden="true">
        <MousePointer2 size={13} strokeWidth={2} />
      </span>
      <span className={styles.toolSemanticBrowserUrl}>{address}</span>
    </span>;
  }

  return <span className={`${styles.toolSemanticHeadline} ${liveThought ? styles.toolSemanticLiveThought : ""} ${styles.toolSemanticUnified} ${phaseClassName}`} data-kind={displayed.kind}>
    {displayed.verb && <span className={styles.toolSemanticVerb}>{displayed.verb}</span>}
    {subject && (liveThought
      ? <TypewriterThought text={subject} shimmer={shimmerSubject} />
      : <span className={styles.toolSemanticSubject}>{subject}</span>)}
    {displayed.meta && <span className={styles.toolSemanticMeta}>{displayed.meta}</span>}
  </span>;
}
