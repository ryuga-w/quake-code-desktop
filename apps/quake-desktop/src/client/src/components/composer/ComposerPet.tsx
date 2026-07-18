import React from "react";
import { resolveComposerPetState } from "./composer-pet-state";
import type {
  ComposerPetContextLoad,
  ComposerPetFileKind,
  ComposerPetNetworkSignal,
  ComposerPetSubagentSignal,
  ComposerPetToolKind,
  ComposerPetToolOutcome,
} from "./composer-pet-signals";
import styles from "./ComposerPet.module.css";

export type ComposerPetProps = {
  prompt: string;
  canSubmit: boolean;
  busy: boolean;
  compact?: boolean;
  sendImpact?: number;
  stopSignal?: number;
  fileDragActive?: boolean;
  attachmentCount?: number;
  approval?: boolean;
  activeToolKind?: ComposerPetToolKind;
  toolOutcome?: ComposerPetToolOutcome;
  subagentSignal?: ComposerPetSubagentSignal;
  subagentActive?: boolean;
  fileKind?: ComposerPetFileKind;
  planActive?: boolean;
  planCompletedCount?: number;
  contextPercent?: number;
  contextLoad?: ComposerPetContextLoad;
  networkSignal?: ComposerPetNetworkSignal;
  sessionKey?: string;
  freshSession?: boolean;
  approvalOutcome?: "approved" | "denied";
};

const TYPING_SETTLE_MS = 680;
const RESULT_CELEBRATION_MS = 1_600;
const SEND_IMPACT_MS = 720;
const STOP_BRAKE_MS = 820;
const FILE_CAUGHT_MS = 880;
const TOOL_ERROR_MS = 1_420;
const TOOL_RECOVERY_MS = 1_080;
const SUBAGENT_LAUNCH_MS = 1_180;
const SUBAGENT_RETURN_MS = 1_280;
const PLAN_TICK_MS = 820;
const CONTEXT_RELEASE_MS = 1_050;
const NETWORK_MOTION_MS = 1_180;
const SURFACE_MOTION_MS = 920;
const WAKE_MOTION_MS = 620;

type SubagentMotion = "launch" | "return" | "failed";
type IdleMotion = "doze" | "look" | "tap";

/** Decorative Quakelet whose state mirrors the real composer lifecycle. */
export function ComposerPet({
  prompt,
  canSubmit,
  busy,
  compact = false,
  sendImpact = 0,
  stopSignal = 0,
  fileDragActive = false,
  attachmentCount = 0,
  approval = false,
  activeToolKind,
  toolOutcome,
  subagentSignal,
  subagentActive = false,
  fileKind = "text",
  planActive = false,
  planCompletedCount = 0,
  contextPercent,
  contextLoad,
  networkSignal,
  sessionKey,
  freshSession = false,
  approvalOutcome,
}: ComposerPetProps) {
  const previousPromptRef = React.useRef(prompt);
  const previousBusyRef = React.useRef(busy);
  const previousAttachmentCountRef = React.useRef(attachmentCount);
  const suppressNextResultRef = React.useRef(false);
  const previousToolOutcomeKeyRef = React.useRef(toolOutcome?.key);
  const previousSubagentKeyRef = React.useRef(subagentSignal?.key);
  const previousPlanCompletedRef = React.useRef(planCompletedCount);
  const previousContextPercentRef = React.useRef(contextPercent);
  const previousNetworkKeyRef = React.useRef(networkSignal?.key);
  const previousSessionKeyRef = React.useRef(sessionKey);
  const previousSendImpactRef = React.useRef(sendImpact);
  const lastSendImpactAtRef = React.useRef(0);
  const idleSequenceRef = React.useRef(0);
  const idleMotionRef = React.useRef<IdleMotion | undefined>(undefined);
  const surfaceTimerRef = React.useRef<number | undefined>(undefined);
  const toolErrorLatchedRef = React.useRef(false);
  const [recentlyTyping, setRecentlyTyping] = React.useState(false);
  const [resultVisible, setResultVisible] = React.useState(false);
  const [impactActive, setImpactActive] = React.useState(false);
  const [stopActive, setStopActive] = React.useState(false);
  const [fileCaughtActive, setFileCaughtActive] = React.useState(false);
  const [toolErrorActive, setToolErrorActive] = React.useState(false);
  const [toolRecoveryActive, setToolRecoveryActive] = React.useState(false);
  const [subagentMotion, setSubagentMotion] = React.useState<SubagentMotion>();
  const [planTickActive, setPlanTickActive] = React.useState(false);
  const [contextReleaseActive, setContextReleaseActive] = React.useState(false);
  const [networkOffline, setNetworkOffline] = React.useState(false);
  const [networkMotion, setNetworkMotion] = React.useState<"offline" | "online" | "error">();
  const [surfaceMotion, setSurfaceMotion] = React.useState<"clear" | "new-chat">();
  const [idleMotion, setIdleMotion] = React.useState<IdleMotion>();
  const [wakeSequence, setWakeSequence] = React.useState(0);
  const [wakeActive, setWakeActive] = React.useState(false);

  const showSurfaceMotion = React.useCallback((motion: "clear" | "new-chat") => {
    if (surfaceTimerRef.current !== undefined) window.clearTimeout(surfaceTimerRef.current);
    setSurfaceMotion(motion);
    surfaceTimerRef.current = window.setTimeout(() => {
      setSurfaceMotion(undefined);
      surfaceTimerRef.current = undefined;
    }, SURFACE_MOTION_MS);
  }, []);

  React.useEffect(() => () => {
    if (surfaceTimerRef.current !== undefined) window.clearTimeout(surfaceTimerRef.current);
  }, []);

  React.useEffect(() => {
    const impactChanged = previousSendImpactRef.current !== sendImpact;
    previousSendImpactRef.current = sendImpact;
    if (impactChanged) lastSendImpactAtRef.current = Date.now();
    if (previousPromptRef.current === prompt) return;
    const previousPrompt = previousPromptRef.current;
    previousPromptRef.current = prompt;
    setResultVisible(false);
    if (!prompt.trim()) {
      setRecentlyTyping(false);
      const sentRecently = Date.now() - lastSendImpactAtRef.current < SEND_IMPACT_MS + 180;
      if (previousPrompt.trim() && !busy && !sentRecently) {
        showSurfaceMotion("clear");
      }
      return;
    }
    if (idleMotionRef.current === "doze") setWakeSequence((current) => current + 1);
    idleMotionRef.current = undefined;
    setIdleMotion(undefined);
    setRecentlyTyping(true);
    const timer = window.setTimeout(() => setRecentlyTyping(false), TYPING_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [busy, prompt, sendImpact, showSurfaceMotion]);

  React.useEffect(() => {
    const wasBusy = previousBusyRef.current;
    previousBusyRef.current = busy;
    if (busy) {
      setResultVisible(false);
      return;
    }
    if (!wasBusy) return;
    if (suppressNextResultRef.current) {
      suppressNextResultRef.current = false;
      setResultVisible(false);
      return;
    }
    setResultVisible(true);
    const timer = window.setTimeout(() => setResultVisible(false), RESULT_CELEBRATION_MS);
    return () => window.clearTimeout(timer);
  }, [busy]);

  React.useEffect(() => {
    if (sendImpact <= 0) return;
    setImpactActive(true);
    const timer = window.setTimeout(() => setImpactActive(false), SEND_IMPACT_MS);
    return () => window.clearTimeout(timer);
  }, [sendImpact]);

  React.useLayoutEffect(() => {
    if (stopSignal <= 0) return;
    suppressNextResultRef.current = true;
    setResultVisible(false);
    setStopActive(true);
    const timer = window.setTimeout(() => setStopActive(false), STOP_BRAKE_MS);
    return () => window.clearTimeout(timer);
  }, [stopSignal]);

  React.useEffect(() => {
    const previousCount = previousAttachmentCountRef.current;
    previousAttachmentCountRef.current = attachmentCount;
    if (attachmentCount <= previousCount) return;
    setFileCaughtActive(true);
    const timer = window.setTimeout(() => setFileCaughtActive(false), FILE_CAUGHT_MS);
    return () => window.clearTimeout(timer);
  }, [attachmentCount]);

  React.useLayoutEffect(() => {
    if (!toolOutcome) {
      previousToolOutcomeKeyRef.current = undefined;
      toolErrorLatchedRef.current = false;
      setToolErrorActive(false);
      setToolRecoveryActive(false);
      return;
    }
    if (previousToolOutcomeKeyRef.current === toolOutcome.key) return;
    previousToolOutcomeKeyRef.current = toolOutcome.key;
    if (toolOutcome.status === "error") {
      toolErrorLatchedRef.current = true;
      suppressNextResultRef.current = true;
      setResultVisible(false);
      setToolRecoveryActive(false);
      setToolErrorActive(true);
      const timer = window.setTimeout(() => setToolErrorActive(false), TOOL_ERROR_MS);
      return () => window.clearTimeout(timer);
    }
    if (!toolErrorLatchedRef.current) return;
    toolErrorLatchedRef.current = false;
    setToolErrorActive(false);
    setToolRecoveryActive(true);
    const timer = window.setTimeout(() => setToolRecoveryActive(false), TOOL_RECOVERY_MS);
    return () => window.clearTimeout(timer);
  }, [toolOutcome?.key, toolOutcome?.status]);

  React.useLayoutEffect(() => {
    if (!subagentSignal) {
      previousSubagentKeyRef.current = undefined;
      setSubagentMotion(undefined);
      return;
    }
    if (previousSubagentKeyRef.current === subagentSignal.key) return;
    previousSubagentKeyRef.current = subagentSignal.key;

    if (subagentSignal.phase === "active") {
      setToolErrorActive(false);
      setSubagentMotion("launch");
      const timer = window.setTimeout(() => setSubagentMotion(undefined), SUBAGENT_LAUNCH_MS);
      return () => window.clearTimeout(timer);
    }

    if (subagentSignal.phase === "failed") {
      toolErrorLatchedRef.current = true;
      suppressNextResultRef.current = true;
      setResultVisible(false);
      setToolRecoveryActive(false);
      setToolErrorActive(true);
      setSubagentMotion("failed");
      const timer = window.setTimeout(() => {
        setToolErrorActive(false);
        setSubagentMotion(undefined);
      }, TOOL_ERROR_MS);
      return () => window.clearTimeout(timer);
    }

    if (toolErrorLatchedRef.current) {
      toolErrorLatchedRef.current = false;
      setToolErrorActive(false);
      setToolRecoveryActive(true);
    }
    setSubagentMotion("return");
    const timer = window.setTimeout(() => {
      setToolRecoveryActive(false);
      setSubagentMotion(undefined);
    }, SUBAGENT_RETURN_MS);
    return () => window.clearTimeout(timer);
  }, [subagentSignal?.key, subagentSignal?.phase]);

  React.useEffect(() => {
    const previous = previousPlanCompletedRef.current;
    previousPlanCompletedRef.current = planCompletedCount;
    setPlanTickActive(false);
    if (!planActive || planCompletedCount <= previous) return;
    setPlanTickActive(true);
    const timer = window.setTimeout(() => setPlanTickActive(false), PLAN_TICK_MS);
    return () => window.clearTimeout(timer);
  }, [planActive, planCompletedCount]);

  React.useEffect(() => {
    if (contextPercent === undefined) {
      setContextReleaseActive(false);
      return;
    }
    const previous = previousContextPercentRef.current;
    previousContextPercentRef.current = contextPercent;
    setContextReleaseActive(false);
    if (previous === undefined || previous < 50 || previous - contextPercent < 18) return;
    setContextReleaseActive(true);
    const timer = window.setTimeout(() => setContextReleaseActive(false), CONTEXT_RELEASE_MS);
    return () => window.clearTimeout(timer);
  }, [contextPercent]);

  React.useEffect(() => {
    if (!networkSignal) {
      setNetworkMotion(undefined);
      return;
    }
    if (previousNetworkKeyRef.current === networkSignal.key) return;
    previousNetworkKeyRef.current = networkSignal.key;
    if (networkSignal.status === "offline") setNetworkOffline(true);
    if (networkSignal.status === "online") setNetworkOffline(false);
    setNetworkMotion(networkSignal.status);
    const timer = window.setTimeout(() => setNetworkMotion(undefined), NETWORK_MOTION_MS);
    return () => window.clearTimeout(timer);
  }, [networkSignal?.key, networkSignal?.status]);

  React.useEffect(() => {
    if (!sessionKey) return;
    const previous = previousSessionKeyRef.current;
    previousSessionKeyRef.current = sessionKey;
    if (!previous || previous === sessionKey || !freshSession) return;
    showSurfaceMotion("new-chat");
  }, [freshSession, sessionKey, showSurfaceMotion]);

  const state = resolveComposerPetState({ busy, resultVisible, recentlyTyping, canSubmit });
  const idleEligible = state === "idle"
    && !approval
    && !impactActive
    && !stopActive
    && !fileDragActive
    && !fileCaughtActive
    && !activeToolKind
    && !toolErrorActive
    && !toolRecoveryActive
    && !subagentActive
    && !subagentMotion
    && !planActive
    && !contextLoad
    && !networkOffline
    && !networkMotion
    && !surfaceMotion;

  React.useEffect(() => {
    if (!idleEligible) {
      idleMotionRef.current = undefined;
      setIdleMotion(undefined);
      return;
    }
    let showTimer: number | undefined;
    let hideTimer: number | undefined;
    let cancelled = false;
    const motions: IdleMotion[] = ["look", "tap", "doze"];
    const schedule = () => {
      const delay = 14_000 + (idleSequenceRef.current % 3) * 2_700;
      showTimer = window.setTimeout(() => {
        if (cancelled) return;
        const motion = motions[idleSequenceRef.current % motions.length];
        idleSequenceRef.current += 1;
        idleMotionRef.current = motion;
        setIdleMotion(motion);
        const duration = motion === "doze" ? 2_600 : motion === "look" ? 1_800 : 1_420;
        hideTimer = window.setTimeout(() => {
          if (cancelled) return;
          idleMotionRef.current = undefined;
          setIdleMotion(undefined);
          schedule();
        }, duration);
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      if (showTimer !== undefined) window.clearTimeout(showTimer);
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    };
  }, [idleEligible]);

  React.useEffect(() => {
    if (wakeSequence <= 0) return;
    setWakeActive(true);
    const timer = window.setTimeout(() => setWakeActive(false), WAKE_MOTION_MS);
    return () => window.clearTimeout(timer);
  }, [wakeSequence]);

  return (
    <span
      className={styles.pet}
      data-state={state}
      data-compact={compact ? "true" : undefined}
      data-composer-pet-impact={impactActive ? "true" : undefined}
      data-composer-pet-stop={stopActive ? "true" : undefined}
      data-file-catching={fileDragActive ? "true" : undefined}
      data-file-caught={fileCaughtActive ? "true" : undefined}
      data-approval={approval ? "true" : undefined}
      data-tool={activeToolKind}
      data-tool-error={toolErrorActive ? "true" : undefined}
      data-tool-recovery={toolRecoveryActive ? "true" : undefined}
      data-subagent-active={subagentActive ? "true" : undefined}
      data-subagent-motion={subagentMotion}
      data-file-kind={fileKind}
      data-plan-active={planActive ? "true" : undefined}
      data-plan-tick={planTickActive ? "true" : undefined}
      data-context-load={contextLoad}
      data-context-release={contextReleaseActive ? "true" : undefined}
      data-network-offline={networkOffline ? "true" : undefined}
      data-network-motion={networkMotion}
      data-surface-motion={surfaceMotion}
      data-approval-outcome={approvalOutcome}
      data-idle-motion={idleMotion}
      data-wake={wakeActive ? "true" : undefined}
      aria-hidden="true"
      data-testid="composer-pet"
    >
      <svg viewBox="0 0 64 48" focusable="false">
        <g className={styles.aura}>
          <ellipse cx="32" cy="22" rx="23" ry="17.5" />
          <ellipse cx="32" cy="22" rx="27" ry="20.5" />
        </g>

        <g className={styles.contextStones}>
          <path className={styles.contextStoneOne} d="m17.2 8.1 5.6-3.1 5.1 3.4-1.7 5.8-6.4.5Z" />
          <path className={styles.contextStoneTwo} d="m25.1 5.2 5.2-3.4 5.5 2.6-.7 5.8-6.3 1.2Z" />
          <path className={styles.contextStoneThree} d="m33.4 5.2 5.1-2.7 4.7 3.2-1.4 5.4-5.7.4Z" />
        </g>

        <g className={styles.head}>
          <path className={styles.body} d="M15.7 30.6c-4.1-5.5-3.6-14.2.8-20.1C20.2 5.6 26.1 3 32.4 3c7.7 0 14.8 3.8 17.5 10.6 2.2 5.6 1.1 13-3.2 17.5-4 4.2-10.6 5.4-16.8 5-5.6-.3-11-1.6-14.2-5.5Z" />
          <path className={styles.facet} d="M16.5 18.2c4.9-3.2 9.5-5.3 15.7-5.4m14.2 3.3c-2.8-2-5.7-3-9.1-3.3" />
          <path className={styles.crack} d="m34.8 4.5-4.2 7 4.2 2.8-5.3 6.3 3.5 3.3-2.2 7" />
          <g className={styles.eyes}>
            <ellipse cx="24.1" cy="23.1" rx="2.65" ry="3.25" />
            <ellipse cx="40.1" cy="22.6" rx="2.65" ry="3.25" />
            <circle className={styles.eyeGlint} cx="23.4" cy="22" r=".72" />
            <circle className={styles.eyeGlint} cx="39.4" cy="21.5" r=".72" />
          </g>
          <path className={styles.mouth} d="M27.9 29.4c2.6 1.65 5.7 1.65 8.3-.1" />
        </g>

        <g className={styles.arms}>
          <path className={styles.armLeft} d="M20.1 27.1c-3.9 1.7-6.6 5.1-7.5 9.3l5.9 1.2c.5-3.1 2.1-5.3 5-7.2Z" />
          <path className={styles.armRight} d="M44.3 27c4 1.6 6.8 5 7.8 9.2l-5.9 1.3c-.6-3.1-2.3-5.3-5.2-7.1Z" />
        </g>

        <path className={styles.ledgeMask} d="M1.5 37.1h61" />
        <path className={styles.ledgeLine} d="M1.5 37.1h61" />
        <path className={styles.signalLine} d="M1.5 37.1h7.8l2.1-2.3 2.4 5.1 3.1-8.2 3.1 10.2 2.7-4.7h18.1l2.1-2.3 2.4 5.1 3.1-8.2 3.1 10.2 2.7-4.7h8.2" />
        <path className={styles.brakeLine} d="M2 37.1h60" />
        <g className={styles.networkCable}>
          <path className={styles.cableLead} d="M1.2 42.2c6.8 0 8.2-1.7 11.6-5" />
          <path className={styles.cablePlug} d="m11.1 33.9 5.2 3.8-3 4.1-5.2-3.8Z" />
          <path className={styles.cablePins} d="m15.2 35.1 1.8-2.4m.1 4.4 1.8-2.4" />
          <path className={styles.cableSocket} d="m18.2 37.1 2.7-3.7" />
        </g>
        <g className={styles.surfaceBroom}>
          <path className={styles.broomHandle} d="m47.8 31.9 10-20" />
          <path className={styles.broomHead} d="m42.4 29.2 8.7 4.4-3 5.8-8.7-4.4Z" />
          <path className={styles.broomBristles} d="m41.2 33.1 7.1 3.6m-8.1-1.6 7 3.6" />
          <g className={styles.sweepDust}>
            <circle cx="34" cy="38.2" r=".8" />
            <circle cx="27.8" cy="39.8" r=".55" />
            <path d="m22.5 37.8-2.1-1.2m10.7-.2-1.3-2" />
          </g>
        </g>
        <g className={styles.impactWaves}>
          <path d="m8.2 32-4.1-3.4M7 37.2H1.8m6.6 4.7-4.2 3.2" />
          <path d="m55.8 32 4.1-3.4m-2.9 8.6h5.2m-6.6 4.7 4.2 3.2" />
          <circle cx="14.5" cy="37.2" r="7.8" />
          <circle cx="49.9" cy="37.2" r="7.8" />
        </g>

        <g className={styles.handLeft}>
          <path d="M9.7 33.8c2-1.3 7.2-1.2 9.4.1 1.6 1 1.7 3.9.1 5.2-1.9 1.5-7.2 1.4-9.2-.1-1.5-1.2-1.5-4 .3-5.2Z" />
          <path className={styles.fingers} d="M13.1 35.1v3.4m3.1-3.4v3.4" />
        </g>
        <g className={styles.handRight}>
          <path d="M45 33.8c2-1.3 7.2-1.2 9.4.1 1.6 1 1.7 3.9.1 5.2-1.9 1.5-7.2 1.4-9.2-.1-1.5-1.2-1.5-4 .3-5.2Z" />
          <path className={styles.fingers} d="M48.4 35.1v3.4m3.1-3.4v3.4" />
        </g>

        <g className={styles.incomingFile}>
          <path className={styles.fileSheet} d="M27.4 13.1h7.4l3.5 3.5v10.6H27.4Z" />
          <path className={styles.fileFold} d="M34.8 13.1v3.6h3.5" />
          <path className={styles.fileLines} d="M30.2 20.1h5.4m-5.4 3h4.1" />
          <path className={styles.fileImageGlyph} d="m29.5 24.4 2.2-2.8 1.7 1.8 1.1-1.1 1.6 2.1Z" />
          <circle className={styles.fileImageGlyph} cx="34.6" cy="19.5" r=".8" />
          <path className={styles.fileCodeGlyph} d="m31.6 19.1-2 2 2 2m2.5-4 2 2-2 2" />
          <text className={styles.filePdfGlyph} x="28.6" y="23.3">PDF</text>
          <path className={styles.fileMixedSheet} d="M24.8 15.2h2.6v12h8.1v2.1H24.8Z" />
        </g>

        <g className={styles.planSheet}>
          <path className={styles.planPaper} d="M3.1 9.8h17.2v19.8H3.1Z" />
          <path className={styles.planLines} d="M8.3 15.1h8.6m-8.6 5h8.6m-8.6 5h8.6" />
          <path className={styles.planBoxes} d="M4.9 13.6h2v2h-2Zm0 5h2v2h-2Zm0 5h2v2h-2Z" />
          <path className={styles.planCheck} d="m4.8 19.5.8.9 1.7-2" />
        </g>

        <g className={styles.toolPaper}>
          <path className={styles.toolPaperSheet} d="M3.8 11.2h9.7l3.3 3.3v14.2h-13Z" />
          <path className={styles.toolPaperInk} d="M13.5 11.2v3.4h3.3M6.7 19h7.2m-7.2 3.3h6.1m-6.1 3.2h4.5" />
        </g>

        <g className={styles.searchLens}>
          <circle cx="50.4" cy="15.4" r="6.2" />
          <path d="m54.9 19.8 5.3 5.4" />
          <path className={styles.lensGlint} d="M47.5 13.2c1-1.2 2.2-1.7 3.8-1.5" />
        </g>

        <g className={styles.shellHammer}>
          <path className={styles.hammerHandle} d="m49.1 29 7.1-15.2" />
          <path className={styles.hammerHead} d="m51.5 9.1 8 3.7-2.1 4.5-8-3.7Z" />
        </g>

        <g className={styles.writePencil}>
          <path className={styles.pencilBody} d="m45.1 28 10.8-13.2 3.6 3-10.8 13.1-4.5 1.5Z" />
          <path className={styles.pencilTip} d="m44.2 32.4 4.5-1.5-3.6-2.9Z" />
          <path className={styles.pencilMark} d="M42.6 34.5h12.8" />
        </g>

        <g className={styles.browserProp}>
          <rect x="2.7" y="11.1" width="16.7" height="13.7" rx="2.2" />
          <path d="M3.2 15.2h15.7M6 13.2h.1m2.1 0h.1" />
          <path className={styles.browserCursor} d="m10.1 17.1 4.5 3-2.1.7-.8 2Z" />
        </g>

        <path className={styles.subagentSocket} d="m39.2 10.4 7.4 1.5 1.6 6-5.1 3.8-6-3.2Z" />
        <g className={styles.subagentShard}>
          <path className={styles.shardBody} d="m39.2 10.4 7.4 1.5 1.6 6-5.1 3.8-6-3.2Z" />
          <circle className={styles.shardEye} cx="41.5" cy="15.4" r=".7" />
          <circle className={styles.shardEye} cx="45.2" cy="15.7" r=".7" />
          <path className={styles.resultPacket} d="M46.7 19.1h5.4v4.5h-5.4Z" />
        </g>

        <g className={styles.approvalHand}>
          <path className={styles.approvalArm} d="M44.3 28.5c4.6-1.5 7.8-5.8 8.5-11.1" />
          <path className={styles.approvalPalm} d="M49.5 10.1c1.6-1.1 5.7-.9 7.1.5 1.2 1.2.8 4.7-.5 6-1.5 1.4-5.2 1.4-6.6 0-1.4-1.4-1.5-5.2 0-6.5Z" />
          <path className={styles.approvalFingers} d="M51.4 10.8V7.4m2.2 3.1V6.6m2.1 4.6V8.1" />
          <path className={styles.approvalMark} d="M59.3 7.1V3.4m0 6.5v.1" />
        </g>

        <g className={styles.approvalThumb}>
          <path className={styles.approvalThumbArm} d="M44.3 28.5c4.2-1.4 7.4-5.1 8-9.5" />
          <path className={styles.approvalThumbPalm} d="M49.3 13.3c1.6-1 5.9-.5 7.1.9 1.2 1.4.5 4.8-1 5.8-1.7 1.1-5.4.5-6.5-1.1-1-1.5-1-4.7.4-5.6Z" />
          <path className={styles.approvalThumbDigit} d="M51.4 14.1c-.1-2.8.6-5 2.2-6.5 1.1 1.5 1.1 3.8.2 6" />
        </g>

        <g className={styles.sparkles}>
          <path d="M8.1 10.3v5.4M5.4 13h5.4" />
          <path d="M55.4 6.4v4.2m-2.1-2.1h4.2" />
        </g>

        <g className={styles.idleMarks}>
          <path d="m47.8 8.5 4-3.8h-4.1m5.5-1.8 3-2.8h-3.1" />
        </g>

        <g className={styles.errorMarks}>
          <path d="m8.5 7.2-3-3m1 7.7-4.2-.8m52.9-4 3-3m-1 7.7 4.2-.8" />
          <path className={styles.errorBang} d="M56.6 14.3v3.3m0 2.6v.1" />
        </g>
      </svg>
    </span>
  );
}
