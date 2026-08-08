import { useEffect, useRef, useState } from "react";
import type { ToolNoticeHeadline } from "./types";
import { headlineSignature, isGenericThinkingFallback } from "./builders";
import {
  SEMANTIC_FLOW_COALESCE_MS,
  SEMANTIC_FLOW_LIVE_COALESCE_MS,
  SEMANTIC_FLOW_LIVE_MIN_HOLD_MS,
  SEMANTIC_FLOW_MIN_HOLD_MS,
} from "./constants";

export function useLastMeaningfulToolHeadline(headline: ToolNoticeHeadline, pending: boolean): ToolNoticeHeadline {
  const lastMeaningfulRef = useRef<ToolNoticeHeadline | undefined>(
    pending && !isGenericThinkingFallback(headline) ? headline : undefined,
  );

  if (!pending) return headline;
  if (!isGenericThinkingFallback(headline)) {
    lastMeaningfulRef.current = headline;
    return headline;
  }

  return lastMeaningfulRef.current || headline;
}

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
