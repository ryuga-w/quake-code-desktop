import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2, SquareTerminal, X } from "lucide-react";
import styles from "./BottomPanel.module.css";

const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 120;

export interface BottomPanelProps {
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
  height?: number;
  onHeightChange?: (height: number) => void;
}

function clampHeight(value: number): number {
  const viewportMaximum = typeof window === "undefined" ? 600 : Math.max(MIN_HEIGHT, window.innerHeight - 80);
  return Math.min(viewportMaximum, Math.max(MIN_HEIGHT, value));
}

export function BottomPanel({ open, onClose, children, height, onHeightChange }: BottomPanelProps) {
  const [innerHeight, setInnerHeight] = useState<number>(() => clampHeight(height ?? DEFAULT_HEIGHT));
  const [maximized, setMaximized] = useState(false);
  const previousHeightRef = useRef(innerHeight);
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);

  // Controlled-height sync: if parent passes a height, follow it.
  useEffect(() => {
    if (typeof height === "number") setInnerHeight(clampHeight(height));
  }, [height]);

  const pendingHeight = useRef<number | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const state = dragState.current;
    if (!state) return;
    pendingHeight.current = clampHeight(state.startHeight + state.startY - event.clientY);
    if (frame.current !== undefined) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = undefined;
      const next = pendingHeight.current;
      if (next === undefined) return;
      document.querySelector<HTMLElement>("#app")?.style.setProperty("--bottom-h", `${Math.round(next)}px`);
    });
  }, []);

  const onPointerUp = useCallback(() => {
    if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
    frame.current = undefined;
    const next = pendingHeight.current ?? innerHeight;
    pendingHeight.current = undefined;
    dragState.current = null;
    document.body.classList.remove("panel-resize-active", "panel-resize-vertical");
    setInnerHeight(next);
    onHeightChange?.(next);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  }, [innerHeight, onHeightChange, onPointerMove]);

  const onHandlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragState.current = { startY: event.clientY, startHeight: innerHeight };
      pendingHeight.current = innerHeight;
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.classList.add("panel-resize-active", "panel-resize-vertical");
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
      window.addEventListener("pointercancel", onPointerUp, { once: true });
    },
    [innerHeight, onPointerMove, onPointerUp],
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
    };
  }, [onPointerMove, onPointerUp]);

  const toggleMaximized = useCallback(() => {
    const next = !maximized;
    const nextHeight = next ? Math.max(MIN_HEIGHT, window.innerHeight - 80) : previousHeightRef.current;
    if (next) previousHeightRef.current = innerHeight;
    setMaximized(next);
    setInnerHeight(nextHeight);
    onHeightChange?.(nextHeight);
  }, [innerHeight, maximized, onHeightChange]);

  if (!open) return null;

  return (
    <section className={styles.panel} style={{ height: innerHeight, maxHeight: "calc(100vh - 80px)" }} aria-label="Alt panel">
      <div
        className={styles.resizeHandle}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Alt panel yüksekliğini ayarla"
        onPointerDown={onHandlePointerDown}
      />
      <header className={styles.header}>
        <div className={styles.left}>
          <span className={styles.terminalMark} aria-hidden="true"><SquareTerminal size={13} /></span>
          <div className={styles.identity}>
            <strong>Quake Terminal</strong>
            <span>Yerel etkileşimli PTY</span>
          </div>
        </div>
        <div className={styles.right}>
          <button type="button" className={styles.close} onClick={toggleMaximized} aria-label={maximized ? "Terminal panelini küçült" : "Terminal panelini büyüt"} title={maximized ? "Paneli önceki boyuta getir" : "Paneli büyüt"}>
            {maximized ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Alt paneli kapat"
            title="Alt paneli aç/kapat  Ctrl+J"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

export default BottomPanel;
