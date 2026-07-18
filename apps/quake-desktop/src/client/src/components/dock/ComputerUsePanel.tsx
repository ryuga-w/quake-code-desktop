import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MonitorSmartphone, RefreshCw, Settings2, Square } from "lucide-react";
import { apiGet, apiPost } from "../../lib/api";
import { desktop, isDesktop } from "../../lib/desktop";
import styles from "./ComputerUsePanel.module.css";

type TrajectoryStep = {
  at: string;
  kind: string;
  tool?: string;
  action?: string;
  ok: boolean;
  error?: string;
  detail?: Record<string, unknown>;
};

type CursorState = {
  x: number;
  y: number;
  kind: "move" | "click" | "type" | "scroll" | "drag" | "default";
  label?: string;
  at: number;
};

type ClickRipple = { id: number; x: number; y: number };

type ComputerUseStatus = {
  bridge: {
    available: boolean;
    embedded: boolean;
    targetWidth?: number;
    targetHeight?: number;
    sessionActive?: boolean;
    lastCursor?: CursorState | null;
  };
  policy: { actuateEnabled: boolean; stepLimit: number; toolMode?: string };
  trajectory: TrajectoryStep[];
};

const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 800;
const BRIDGE_PORT = "9224";
/** Aggressive preview refresh while agent is active (~1.2s, without hammering). */
const ACTIVE_PREVIEW_MS = 1200;
const IDLE_STATUS_MS = 5000;
const ACTIVE_STATUS_MS = 450;

function cursorFromTrajectoryStep(step: TrajectoryStep): CursorState | null {
  const detail = step.detail;
  if (!detail) return null;
  const coordinate = Array.isArray(detail.coordinate) ? (detail.coordinate as [number, number]) : null;
  if (!coordinate) return null;
  const action = step.action || "";
  const kind: CursorState["kind"] = action.includes("click")
    ? "click"
    : action === "type" || action === "key"
      ? "type"
      : action === "scroll"
        ? "scroll"
        : action === "drag"
          ? "drag"
          : action === "mouse_move"
            ? "move"
            : "default";
  return {
    x: coordinate[0],
    y: coordinate[1],
    kind,
    label: action ? action.replace(/_/g, " ") : undefined,
    at: new Date(step.at).getTime(),
  };
}

function isAgentActive(status: ComputerUseStatus | null): boolean {
  if (!status) return false;
  if (status.bridge.sessionActive) return true;
  const steps = status.trajectory;
  if (steps.length === 0) return false;
  const latest = steps[0];
  if (!latest) return false;
  if (latest.kind === "session_end") return false;
  const ageMs = Date.now() - new Date(latest.at).getTime();
  return ageMs < 45_000 && (latest.kind === "actuate" || latest.kind === "screenshot" || latest.kind === "session_start");
}

function formatLiveActivity(cursor: CursorState | null, trajectory: TrajectoryStep[]): string | null {
  if (cursor?.label) {
    const coords = Number.isFinite(cursor.x) && Number.isFinite(cursor.y) ? ` (${Math.round(cursor.x)},${Math.round(cursor.y)})` : "";
    return `${cursor.label}${coords}`;
  }
  if (cursor && (cursor.kind === "click" || cursor.kind === "move" || cursor.kind === "drag" || cursor.kind === "scroll" || cursor.kind === "type")) {
    const kindLabel =
      cursor.kind === "click"
        ? "click"
        : cursor.kind === "move"
          ? "move"
          : cursor.kind === "drag"
            ? "drag"
            : cursor.kind === "scroll"
              ? "scroll"
              : cursor.kind === "type"
                ? "type"
                : cursor.kind;
    return `${kindLabel} (${Math.round(cursor.x)},${Math.round(cursor.y)})`;
  }
  const latest = trajectory.find((s) => s.kind === "actuate" || s.action);
  if (!latest) return null;
  const action = (latest.action || latest.tool || latest.kind || "").replace(/_/g, " ");
  const detail = latest.detail;
  const coordinate = detail && Array.isArray(detail.coordinate) ? (detail.coordinate as [number, number]) : null;
  if (coordinate) {
    return `${action} (${Math.round(coordinate[0])},${Math.round(coordinate[1])})`;
  }
  return action || null;
}

export function ComputerUsePanel({
  onOpenSettings,
  onStartTask,
}: {
  onOpenSettings?: () => void;
  onStartTask?: (prompt: string) => void;
}) {
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [cursor, setCursor] = useState<CursorState | null>(null);
  const [clickRipples, setClickRipples] = useState<ClickRipple[]>([]);
  const [previewSize, setPreviewSize] = useState({ w: TARGET_WIDTH, h: TARGET_HEIGHT });
  const rippleIdRef = useRef(0);
  const previewRef = useRef<HTMLDivElement>(null);
  const lastTrajectoryRippleAtRef = useRef<string | null>(null);
  const capturingRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<ComputerUseStatus>("/api/computer-use/status");
      setStatus(data);
      if (data.bridge.targetWidth && data.bridge.targetHeight) {
        setPreviewSize({ w: data.bridge.targetWidth, h: data.bridge.targetHeight });
      }
      if (data.bridge.lastCursor) {
        setCursor((prev) => {
          const next = data.bridge.lastCursor!;
          if (!prev || next.at >= prev.at) return next as CursorState;
          return prev;
        });
      }
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const agentActive = isAgentActive(status);

  useEffect(() => {
    void refresh();
    const intervalMs = agentActive ? ACTIVE_STATUS_MS : IDLE_STATUS_MS;
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => window.clearInterval(timer);
  }, [refresh, agentActive]);

  useEffect(() => {
    if (!agentActive || !isDesktop || !desktop?.computerUse?.onCursor) return;
    const unsub = desktop.computerUse.onCursor((c) => {
      const next: CursorState = {
        x: c.x,
        y: c.y,
        kind: (c.kind as CursorState["kind"]) || "default",
        label: c.label,
        at: c.at || Date.now(),
      };
      setCursor(next);
      if (c.kind === "click") {
        const id = ++rippleIdRef.current;
        setClickRipples((prev) => [...prev, { id, x: c.x, y: c.y }]);
        window.setTimeout(() => {
          setClickRipples((prev) => prev.filter((r) => r.id !== id));
        }, 700);
      }
    });
    return unsub;
  }, [agentActive]);

  useEffect(() => {
    if (!agentActive) return;
    const latestActuate = status?.trajectory.find((step) => step.kind === "actuate" && step.ok);
    if (!latestActuate) return;
    const fromStep = cursorFromTrajectoryStep(latestActuate);
    if (!fromStep) return;
    setCursor((prev) => (!prev || fromStep.at >= prev.at ? fromStep : prev));
    if (fromStep.kind === "click" && latestActuate.at !== lastTrajectoryRippleAtRef.current) {
      lastTrajectoryRippleAtRef.current = latestActuate.at;
      const id = ++rippleIdRef.current;
      setClickRipples((prev) => [...prev, { id, x: fromStep.x, y: fromStep.y }]);
      window.setTimeout(() => {
        setClickRipples((prev) => prev.filter((r) => r.id !== id));
      }, 700);
    }
  }, [agentActive, status?.trajectory]);

  const capturePreview = useCallback(async () => {
    if (capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    try {
      const res = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/computer-use/screenshot`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; data?: string; mimeType?: string; width?: number; height?: number };
      if (data.ok && data.data) {
        setPreview(`data:${data.mimeType || "image/png"};base64,${data.data}`);
        if (data.width && data.height) setPreviewSize({ w: data.width, h: data.height });
      }
      if (agentActive) {
        await fetch(`http://127.0.0.1:${BRIDGE_PORT}/computer-use/cursor-position`, { method: "POST" }).catch(() => {});
      }
    } catch {
      setPreview(null);
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }, [agentActive]);

  // Auto-capture preview every ~1.2s while agent is active (skip if previous capture still in flight).
  useEffect(() => {
    if (!agentActive || !status?.bridge?.available) return;
    void capturePreview();
    const timer = window.setInterval(() => void capturePreview(), ACTIVE_PREVIEW_MS);
    return () => window.clearInterval(timer);
  }, [agentActive, status?.bridge?.available, capturePreview]);

  useEffect(() => {
    if (!agentActive || !status?.bridge?.available) return;
    let cancelled = false;
    const pollCursor = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/computer-use/cursor-position`, { method: "POST" });
        const data = (await res.json()) as { ok?: boolean; x?: number; y?: number };
        if (!cancelled && data.ok && typeof data.x === "number" && typeof data.y === "number") {
          setCursor((prev) => {
            const next = { x: data.x!, y: data.y!, kind: "move" as const, at: Date.now() };
            // Don't overwrite a richer labeled/action cursor with bare move polls
            if (prev && prev.at + 400 > next.at && prev.kind !== "move" && prev.kind !== "default") {
              return { ...prev, x: next.x, y: next.y, at: next.at };
            }
            return !prev || next.at >= prev.at ? next : prev;
          });
        }
      } catch {
        /* ignore */
      }
    };
    void pollCursor();
    const timer = window.setInterval(() => void pollCursor(), 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [agentActive, status?.bridge?.available]);

  async function stopAgent() {
    await apiPost("/api/command", { type: "abort" }).catch(() => {});
  }

  const bridgeOk = Boolean(status?.bridge?.available && status?.bridge?.embedded);
  const actuateOn = Boolean(status?.policy?.actuateEnabled);
  const showCursor = Boolean(preview && cursor && agentActive);
  const liveActivity = useMemo(
    () => (agentActive ? formatLiveActivity(cursor, status?.trajectory || []) : null),
    [agentActive, cursor, status?.trajectory],
  );

  return (
    <div className={styles.panel}>
      {agentActive && (
        <div className={styles.sessionBanner} role="status" aria-live="polite">
          <span className={styles.sessionPulse} aria-hidden="true" />
          <span className={styles.sessionBannerText}>Ajan masaüstünü kullanıyor</span>
        </div>
      )}

      <div className={styles.statusRow}>
        <span className={`${styles.pill} ${bridgeOk ? styles.pillOk : styles.pillWarn}`}>
          <MonitorSmartphone size={14} aria-hidden="true" />
          {bridgeOk ? "Köprü bağlı" : "Köprü yok"}
        </span>
        <span className={`${styles.pill} ${agentActive ? styles.pillActive : ""}`}>
          {agentActive ? "Ajan aktif" : actuateOn ? "Etkileşim açık" : "Salt okunur"}
        </span>
        <span
          className={`${styles.pill} ${actuateOn ? styles.pillOk : styles.pillWarn}`}
          title={actuateOn ? "Tıklama ve klavye etkileşimi açık" : "Salt ekran görüntüsü — tıklama kapalı"}
        >
          {actuateOn ? "Tıklama açık" : "Tıklama kapalı"}
        </span>
        <button type="button" className={styles.btn} onClick={() => void refresh()} aria-label="Yenile">
          <RefreshCw size={14} />
        </button>
        {onOpenSettings && (
          <button type="button" className={styles.btn} onClick={onOpenSettings} aria-label="Ayarlar">
            <Settings2 size={14} />
          </button>
        )}
      </div>

      {!actuateOn && (
        <div className={styles.policyWarn} role="alert">
          <span>Tıklama kapalı — Ayarlar&apos;dan etkinleştir</span>
          {onOpenSettings && (
            <button type="button" className={styles.policyWarnLink} onClick={onOpenSettings}>
              Ayarlar
            </button>
          )}
        </div>
      )}

      {agentActive && liveActivity && (
        <div className={styles.liveActivity} aria-live="polite">
          <span className={styles.liveActivityDot} aria-hidden="true" />
          <span className={styles.liveActivityLabel}>Son işlem</span>
          <code className={styles.liveActivityValue}>{liveActivity}</code>
        </div>
      )}

      {!agentActive && (
        <p className={styles.hint}>
          {isDesktop
            ? "Oturum aktifken gerçek masaüstünde tam ekran ajan imleci görünür (kenar ışıması + siyah işaretçi). Bu panelde önizleme ve sanal imleç gösterilir."
            : "Computer-Use yalnızca Quake Desktop (Electron) içinde tam çalışır."}
        </p>
      )}

      <div
        ref={previewRef}
        className={`${styles.preview} ${agentActive ? styles.previewAgentActive : ""}`}
      >
        {agentActive && (
          <>
            <div className={styles.edgePulseTop} aria-hidden="true" />
            <div className={styles.edgePulseBottom} aria-hidden="true" />
            <div className={styles.edgePulseLeft} aria-hidden="true" />
            <div className={styles.edgePulseRight} aria-hidden="true" />
          </>
        )}
        {preview ? (
          <div className={styles.previewViewport}>
            <img src={preview} alt="Son masaüstü ekran görüntüsü" />
            {showCursor && (
              <div
                className={`${styles.agentCursor} ${cursor!.kind === "click" ? styles.cursorClick : ""} ${cursor!.kind === "type" ? styles.cursorType : ""}`}
                style={{
                  left: `${(cursor!.x / previewSize.w) * 100}%`,
                  top: `${(cursor!.y / previewSize.h) * 100}%`,
                }}
              >
                <svg
                  className={styles.cursorPointer}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  {/* White stroke outline for contrast on dark/light screenshots */}
                  <path
                    className={styles.cursorStroke}
                    d="M5.65 5.65l3.57 14.3 2.86-5.72 5.72-2.86z"
                    fill="none"
                    strokeWidth="3.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <path d="M5.65 5.65l3.57 14.3 2.86-5.72 5.72-2.86z" stroke="none" />
                </svg>
                {cursor!.label && <span className={styles.cursorLabel}>{cursor!.label}</span>}
              </div>
            )}
            {showCursor &&
              clickRipples.map((ripple) => (
                <div
                  key={ripple.id}
                  className={styles.clickRipple}
                  style={{
                    left: `${(ripple.x / previewSize.w) * 100}%`,
                    top: `${(ripple.y / previewSize.h) * 100}%`,
                  }}
                />
              ))}
          </div>
        ) : (
          <div className={styles.previewEmpty}>
            {loading ? (
              "Durum yükleniyor…"
            ) : agentActive ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateTitle}>Önizleme alınıyor…</div>
                <div className={styles.emptyStateBody}>
                  Gerçek masaüstünde kenar ışıması ve siyah ajan imleci görünür.
                </div>
              </div>
            ) : (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateTitle}>Masaüstü önizlemesi yok</div>
                <div className={styles.emptyStateBody}>
                  Oturum başladığında gerçek ekranda tam ekran ajan imleci belirir (mor kenar ışıması + siyah işaretçi).
                  Bu panelde ekran görüntüsü ve sanal imleç gösterilir.
                </div>
                <div className={styles.emptyStateHint}>Önizleme için «Ekran görüntüsü al» veya bir görev başlatın.</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.btn} disabled={!bridgeOk || capturing} onClick={() => void capturePreview()}>
          {capturing ? "Alınıyor…" : "Ekran görüntüsü al"}
        </button>
        <button type="button" className={styles.btn} onClick={() => onStartTask?.("/desktop ")}>
          Görev başlat
        </button>
        <button type="button" className={styles.btn} onClick={() => void stopAgent()}>
          <Square size={12} aria-hidden="true" /> Durdur
        </button>
      </div>

      <div className={styles.sectionTitle}>Son adımlar</div>
      <div className={styles.steps}>
        {(status?.trajectory || []).length === 0 ? (
          <div className={styles.hint}>Henüz kayıtlı computer-use adımı yok.</div>
        ) : (
          status?.trajectory.map((step, index) => (
            <div
              key={`${step.at}-${index}`}
              className={`${styles.step} ${step.ok ? styles.stepOk : styles.stepErr}`}
            >
              <div>
                <strong>{step.tool || step.kind}</strong>
                {step.action ? ` · ${step.action}` : ""}
              </div>
              <div className={styles.hint}>{new Date(step.at).toLocaleTimeString("tr-TR")}</div>
              {step.error && <div>{step.error}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
