import React, { useEffect, useMemo, useRef } from "react";
import { CheckCircle2, Circle, CircleStop, Clipboard, Copy, Lock, LockOpen, TriangleAlert, XCircle } from "lucide-react";
import { useAppStore } from "../../state/app-store";
import styles from "./TerminalPanel.module.css";
import { type TerminalTabState, ensureTerminalTab } from "./terminal-utils";

export type { TerminalTabState };
export { ensureTerminalTab };

export function TerminalPanel({ tabs, activeId, onActive, onNew, onClose, terminalText, setTerminalText, terminalHistory, runTerminal, stopTerminal, onAsk, onAddContext }: { tabs: TerminalTabState[]; activeId: string; onActive: (id: string) => void; onNew: () => void; onClose: (id: string) => void; terminalText: string; setTerminalText: (value: string) => void; terminalHistory: string[]; runTerminal: (command?: string, tabId?: string) => void; stopTerminal: (tabId?: string) => void; onAsk: (text: string) => void; onAddContext: (tab: TerminalTabState) => void }) {
  const active = tabs.find((tab) => tab.id === activeId) || tabs[0];
  const showToast = useAppStore((state) => state.showToast);
  const copy = (text: string, options?: { stripAnsi?: boolean }) => {
    if (!text) {
      showToast("Kopyalanacak terminal çıktısı yok", "warning");
      return;
    }
    if (!navigator.clipboard?.writeText) {
      showToast("Kopyalama desteklenmiyor", "error");
      return;
    }
    const textToCopy = options?.stripAnsi ? text.replace(/\x1b\[[0-9;]*m/g, "") : text;
    void navigator.clipboard.writeText(textToCopy)
      .then(() => showToast(options?.stripAnsi ? "Terminal çıktısı (temiz) kopyalandı" : "Terminal çıktısı kopyalandı", "success"))
      .catch((error: any) => showToast(`Kopyalama başarısız: ${error?.message || "bilinmeyen hata"}`, "error"));
  };
  const outputRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (!active?.scrollLock) outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [active?.output, active?.scrollLock]);
  const toggleScrollLock = () => {
    const newLock = !(active?.scrollLock || false);
    const event = new CustomEvent("terminal-scroll-lock", { detail: { tabId: active?.id, scrollLock: newLock } });
    window.dispatchEvent(event);
  };
  const risk = terminalCommandRisk(terminalText);
  const statusText = active?.status || "idle";
  return <section className={styles.panel}>
    <header className={styles.head}>
      <div><span className={`${styles.led} ${styles[statusText] || ""}`} />Terminal</div>
      <small>{terminalStatusLabel(statusText)}{active?.durationMs ? ` · ${formatDuration(active.durationMs)}` : ""}</small>
    </header>
    <div className={styles.tabs} role="tablist" aria-label="Terminal oturumları">
      {tabs.map((tab) => <div key={tab.id} role="tab" tabIndex={0} aria-selected={tab.id === activeId} className={`${styles.tabButton} ${tab.id === activeId ? styles.active : ""} ${styles[tab.status] || ""}`} onClick={() => onActive(tab.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActive(tab.id); } }}><span className={styles.tabName}>{terminalStatusIcon(tab.status)} {tab.name}</span><small>{terminalStatusLabel(tab.status)}</small><button type="button" className={styles.tabClose} aria-label={`${tab.name} terminalini kapat`} onClick={(event) => { event.stopPropagation(); onClose(tab.id); }}>×</button></div>)}
      <button type="button" className={styles.newTerminal} onClick={onNew} aria-label="Yeni terminal">+</button>
    </div>
    <div className={styles.commandLine}>
      <span className={styles.prompt}>$</span>
      <input className="terminal-input" data-testid="terminal-input" list="terminalHistoryOptions" value={terminalText} onChange={(e) => setTerminalText(e.target.value)} onKeyDown={(e) => {
        if (e.key === "Enter") void runTerminal(undefined, active?.id);
        if (e.key === "ArrowUp" && terminalHistory.length > 0) {
          e.preventDefault();
          const currentIndex = terminalHistory.length - 1;
          const prevIndex = (currentIndex <= 0 ? terminalHistory.length - 1 : currentIndex - 1);
          setTerminalText(terminalHistory[prevIndex] || "");
        }
        if (e.key === "ArrowDown" && terminalHistory.length > 0) {
          e.preventDefault();
          const currentIndex = terminalHistory.length - 1;
          const nextIndex = (currentIndex >= terminalHistory.length - 1 ? 0 : currentIndex + 1);
          setTerminalText(terminalHistory[nextIndex] || "");
        }
      }} placeholder="npm test, ls…" />
      <datalist id="terminalHistoryOptions">{terminalHistory.map((entry) => <option value={entry} key={entry} />)}</datalist>
      <button className={`${styles.run} terminal-run`} data-testid="terminal-run" type="button" onClick={() => runTerminal(undefined, active?.id)}>Çalıştır</button>
      <button className={styles.stop} type="button" disabled={active?.status !== "running"} onClick={() => stopTerminal(active?.id)}>Durdur</button>
    </div>
    {risk && <div className={`${styles.warning} ${risk.level === "error" ? styles.error : ""}`}>{risk.text}</div>}
    <div className={styles.actions} aria-label="Terminal aksiyonları">
      <button type="button" onClick={() => active && runTerminal(active.command, active.id)} disabled={!active?.command}>Yeniden çalıştır</button>
      <button type="button" onClick={() => copy(active?.output || "")} title="ANSI kodlarıyla kopyala"><Clipboard size={14} aria-hidden="true" /> Kopyala</button>
      <button type="button" onClick={() => copy(active?.output || "", { stripAnsi: true })} title="ANSI kodlarını temizleyerek kopyala"><Copy size={14} aria-hidden="true" /> Temiz kopyala</button>
      <button type="button" onClick={toggleScrollLock} title={active?.scrollLock ? "Otomatik scroll'u aç" : "Otomatik scroll'u kilitle"}>{active?.scrollLock ? <LockOpen size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />} {active?.scrollLock ? "Kaydırmayı aç" : "Kaydırmayı kilitle"}</button>
      <button type="button" onClick={() => active && onAddContext(active)}>Bağlama ekle</button>
      <button type="button" onClick={() => onAsk(`Bu terminal çıktısını analiz et, hata varsa kök nedeni ve düzeltme planını yaz:\n\n${(active?.output || "").slice(0, 6000)}`)}>Analiz et</button>
    </div>
    {active?.status === "running" && <div className={styles.runningBar}>Komut çalışıyor…</div>}
    <pre ref={outputRef} className={`${styles.output} muted terminal-output`} data-testid="terminal-output">{active?.output && active.output !== "Komut çıktısı burada görünecek" ? <AnsiRenderer text={active.output} /> : "# çıktı burada görünecek"}</pre>
  </section>;
}

// ÔöÇÔöÇ ANSI escape code parser & renderer ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

const ANSI_RE = /\x1b\[([0-9;]*)m/g;

interface AnsiStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fg?: string;
  bg?: string;
}

const ANSI_FG: Record<number, string> = {
  30: "ansiBlack", 31: "ansiRed", 32: "ansiGreen", 33: "ansiYellow",
  34: "ansiBlue", 35: "ansiMagenta", 36: "ansiCyan", 37: "ansiWhite",
  90: "ansiBrightBlack", 91: "ansiBrightRed", 92: "ansiBrightGreen",
  93: "ansiBrightYellow", 94: "ansiBrightBlue", 95: "ansiBrightMagenta",
  96: "ansiBrightCyan", 97: "ansiBrightWhite",
};

const ANSI_BG: Record<number, string> = {
  40: "ansiBgBlack", 41: "ansiBgRed", 42: "ansiBgGreen", 43: "ansiBgYellow",
  44: "ansiBgBlue", 45: "ansiBgMagenta", 46: "ansiBgCyan", 47: "ansiBgWhite",
  100: "ansiBgBrightBlack", 101: "ansiBgBrightRed", 102: "ansiBgBrightGreen",
  103: "ansiBgBrightYellow", 104: "ansiBgBrightBlue", 105: "ansiBgBrightMagenta",
  106: "ansiBgBrightCyan", 107: "ansiBgBrightWhite",
};

function applyAnsiCode(style: AnsiStyle, code: number): void {
  if (code === 0) { style.bold = false; style.italic = false; style.underline = false; style.fg = undefined; style.bg = undefined; return; }
  if (code === 1) { style.bold = true; return; }
  if (code === 3) { style.italic = true; return; }
  if (code === 4) { style.underline = true; return; }
  if (code === 22) { style.bold = false; return; }
  if (code === 23) { style.italic = false; return; }
  if (code === 24) { style.underline = false; return; }
  if (code === 39) { style.fg = undefined; return; }
  if (code === 49) { style.bg = undefined; return; }
  if (ANSI_FG[code]) { style.fg = ANSI_FG[code]; return; }
  if (ANSI_BG[code]) { style.bg = ANSI_BG[code]; return; }
}

interface AnsiSegment {
  text: string;
  style: AnsiStyle;
}

function parseAnsi(text: string): AnsiSegment[] {
  if (!text) return [];
  const segments: AnsiSegment[] = [];
  const style: AnsiStyle = {};
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ANSI_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), style: { ...style } });
    }
    const raw = match[1];
    if (!raw) {
      style.fg = undefined; style.bg = undefined;
      style.bold = false; style.italic = false; style.underline = false;
    } else {
      for (const codeStr of raw.split(";")) {
        const code = parseInt(codeStr, 10);
        if (!isNaN(code)) applyAnsiCode(style, code);
      }
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), style: { ...style } });
  }

  return segments;
}

function AnsiRenderer({ text }: { text: string }) {
  const segments = useMemo(() => parseAnsi(text), [text]);

  if (segments.length === 0) return null;

  // Hızlı yol: ANSI kodu yoksa düz metin render et
  if (segments.length === 1) {
    const s = segments[0];
    if (!s.style.bold && !s.style.italic && !s.style.underline && !s.style.fg && !s.style.bg) {
      return <>{text}</>;
    }
  }

  return segments.map((seg, i) => {
    const classes: string[] = [];
    if (seg.style.bold) classes.push(styles.ansiBold);
    if (seg.style.italic) classes.push(styles.ansiItalic);
    if (seg.style.underline) classes.push(styles.ansiUnderline);
    if (seg.style.fg) classes.push(styles[seg.style.fg as keyof typeof styles] as string);
    if (seg.style.bg) classes.push(styles[seg.style.bg as keyof typeof styles] as string);
    const cls = classes.filter(Boolean).join(" ");
    return cls ? <span key={i} className={cls}>{seg.text}</span> : <React.Fragment key={i}>{seg.text}</React.Fragment>;
  });
}

function terminalCommandRisk(command: string): { level: "warning" | "error"; text: string } | undefined {
  const value = command.trim().toLowerCase();
  if (!value) return undefined;
  if (/\b(rm\s+-rf|del\s+\/|format\b|mkfs|shutdown|reboot|reg\s+delete)\b/.test(value)) return { level: "error", text: "Tehlikeli komut deseni algılandı. Sunucu politikası bunu engellemeli, yine de çalıştırmadan önce kontrol et." };
  if (/\b(sudo|chmod\s+777|chown|curl\b.*\|\s*(sh|bash)|wget\b.*\|\s*(sh|bash))\b/.test(value)) return { level: "warning", text: "Yetkili veya pipe-to-shell komut. Kaynağa güveniyorsan çalıştır." };
  return undefined;
}

function terminalStatusLabel(status: string): string {
  if (status === "idle") return "Hazır";
  if (status === "running") return "Çalışıyor";
  if (status === "done") return "Tamamlandı";
  if (status === "error") return "Hata";
  if (status === "stopped") return "Durduruldu";
  return status;
}

function formatDuration(value: number): string {
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function terminalStatusIcon(status: string): React.ReactNode {
  const iconProps = { size: 13, "aria-hidden": true } as const;
  if (status === "idle") return <Circle {...iconProps} />;
  if (status === "running") return <TriangleAlert {...iconProps} />;
  if (status === "done") return <CheckCircle2 {...iconProps} />;
  if (status === "error") return <XCircle {...iconProps} />;
  if (status === "stopped") return <CircleStop {...iconProps} />;
  return <Circle {...iconProps} />;
}
