import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import styles from "./BottomPanel.module.css";

const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 120;
const RESIZE_STEP = 24;

export interface BottomPanelProps {
  open: boolean;
  onClose: () => void;
  children?: ReactNode | ((panelControls: ReactNode) => ReactNode);
  height?: number;
  onHeightChange?: (height: number) => void;
}

function maximumHeight(): number {
  return typeof window === "undefined" ? 600 : Math.max(MIN_HEIGHT, window.innerHeight - 80);
}

function clampHeight(value: number): number {
  return Math.min(maximumHeight(), Math.max(MIN_HEIGHT, value));
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
    setMaximized(false);
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

  const onHandleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const maximum = maximumHeight();
    const next = event.key === "ArrowUp" || event.key === "PageUp"
      ? clampHeight(innerHeight + (event.key === "PageUp" ? RESIZE_STEP * 3 : RESIZE_STEP))
      : event.key === "ArrowDown" || event.key === "PageDown"
        ? clampHeight(innerHeight - (event.key === "PageDown" ? RESIZE_STEP * 3 : RESIZE_STEP))
        : event.key === "Home"
          ? MIN_HEIGHT
          : event.key === "End"
            ? maximum
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setMaximized(next >= maximum);
    setInnerHeight(next);
    onHeightChange?.(next);
  }, [innerHeight, onHeightChange]);

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

  const panelControls = (
    <div className={styles.panelControls}>
      <kbd className={styles.shortcut} aria-hidden="true">Ctrl J</kbd>
      <button type="button" className={styles.close} onClick={toggleMaximized} aria-label={maximized ? "Terminal panelini küçült" : "Terminal panelini büyüt"} title={maximized ? "Paneli önceki boyuta getir" : "Paneli büyüt"}>
        {maximized ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
      </button>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Alt paneli kapat" title="Alt paneli aç/kapat  Ctrl+J">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <section className={styles.panel} style={{ height: innerHeight, maxHeight: "calc(100vh - 80px)" }} aria-label="Terminal alt panel">
      <div
        className={styles.resizeHandle}
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label="Alt panel yüksekliğini ayarla"
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={maximumHeight()}
        aria-valuenow={Math.round(innerHeight)}
        onPointerDown={onHandlePointerDown}
        onKeyDown={onHandleKeyDown}
      />
      <div className={styles.body}>{typeof children === "function" ? children(panelControls) : children}</div>
    </section>
  );
}

export default BottomPanel;
