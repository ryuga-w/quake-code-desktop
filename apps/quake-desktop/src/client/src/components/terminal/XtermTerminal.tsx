import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { ChevronDown, Copy, Folder, Maximize2, PanelRight, Plus, Search, SquareTerminal, Trash2, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { authToken } from "../../lib/api";
import { readStorageValue } from "../../lib/storage";
import styles from "./XtermTerminal.module.css";

type Mode = "dark" | "light";
type TerminalProfile = "default" | "powershell" | "cmd" | "bash" | "zsh";
type ConnectionState = "connecting" | "connected" | "disconnected" | "exited" | "error";
type TerminalMetadata = { cwd?: string; shell?: string; state: ConnectionState };
type TerminalHandle = {
  focus(): void;
  fit(): void;
  findNext(query: string): boolean;
  findPrevious(query: string): boolean;
  clearSearch(): void;
  copySelection(): Promise<boolean>;
  clear(): void;
  snapshot(maxChars?: number): string;
  kill(): void;
};
type TerminalTab = { id: string; name: string; profile: TerminalProfile; metadata: TerminalMetadata };

const PROFILE_LABELS: Record<TerminalProfile, string> = {
  default: "Varsayılan shell",
  powershell: "PowerShell",
  cmd: "Command Prompt",
  bash: "Bash",
  zsh: "Zsh",
};

function themeRoot(): Element {
  return document.querySelector("#app") || document.documentElement;
}
function currentMode(): Mode {
  return themeRoot().getAttribute("data-theme") === "light" ? "light" : "dark";
}
function tok(name: string, fallback: string): string {
  return getComputedStyle(themeRoot()).getPropertyValue(name).trim() || fallback;
}
function buildTheme(mode: Mode): ITheme {
  if (mode === "light") return {
    background: tok("--panel", "#ffffff"), foreground: tok("--text", "#1c1c1c"), cursor: tok("--accent", "#1c1c1c"), cursorAccent: tok("--panel", "#ffffff"), selectionBackground: "rgba(0,0,0,0.13)",
    black: "#3b3b3b", red: "#c0392b", green: "#1e8a4c", yellow: "#9a7d0a", blue: "#1f6fd6", magenta: "#8e44ad", cyan: "#0f8e91", white: "#cfcfcf",
    brightBlack: "#6a6a6a", brightRed: "#e74c3c", brightGreen: "#27ae60", brightYellow: "#b7950b", brightBlue: "#2e86de", brightMagenta: "#a569bd", brightCyan: "#17a2a6", brightWhite: "#111111",
  };
  return {
    background: tok("--panel", "#0f0f0f"), foreground: tok("--text", "#ececec"), cursor: tok("--accent", "#e6e6e6"), cursorAccent: tok("--bg", "#0a0a0a"), selectionBackground: "rgba(255,255,255,0.18)",
    black: "#3b3b3b", red: "#ff6b6b", green: "#6bdf8f", yellow: "#e8d36b", blue: "#6ba8ff", magenta: "#c78bff", cyan: "#6bdce8", white: "#d7d7d7",
    brightBlack: "#6f6f6f", brightRed: "#ff8585", brightGreen: "#8bedab", brightYellow: "#f1e08a", brightBlue: "#8bbcff", brightMagenta: "#d6a6ff", brightCyan: "#8be8f1", brightWhite: "#ffffff",
  };
}
/** S-OS.3: interactive PTY is host-only (not OsSandbox / worktree-scoped). */
const PTY_ISOLATION_NOTICE_TR =
  "Uyarı: Etkileşimli terminal OS sandboxed değildir; ajan worktree izolasyonunu atlayabilir.";

function newTab(index: number, profile: TerminalProfile = "default"): TerminalTab {
  return { id: `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: `Terminal ${index}`, profile, metadata: { state: "connecting" } };
}
function defaultTerminalProfile(): TerminalProfile {
  const value = readStorageValue("quake-web:terminalShell", "default");
  return value === "powershell" || value === "cmd" || value === "bash" || value === "zsh" ? value : "default";
}
function encodeProtocolToken(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function XtermTerminal({ onAsk, onAddContext }: { onAsk?: (text: string) => void; onAddContext?: (context: { label: string; text: string }) => void }) {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [newTab(1, defaultTerminalProfile())]);
  const [activeId, setActiveId] = useState(() => "");
  const [splitId, setSplitId] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const handles = useRef(new Map<string, TerminalHandle>());
  const effectiveActiveId = activeId || tabs[0]?.id || "";
  const active = tabs.find((tab) => tab.id === effectiveActiveId) || tabs[0];

  const updateMetadata = useCallback((id: string, metadata: Partial<TerminalMetadata>) => {
    setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, metadata: { ...tab.metadata, ...metadata } } : tab));
  }, []);
  const register = useCallback((id: string, handle?: TerminalHandle) => {
    if (handle) handles.current.set(id, handle);
    else handles.current.delete(id);
  }, []);
  const focus = useCallback((id: string) => {
    setActiveId(id);
    requestAnimationFrame(() => handles.current.get(id)?.focus());
  }, []);
  const addTab = useCallback((profile: TerminalProfile = "default", split = false) => {
    const tab = newTab(tabs.length + 1, profile);
    setTabs((current) => [...current, tab]);
    if (split) setSplitId(tab.id);
    else setActiveId(tab.id);
    setProfileMenuOpen(false);
  }, [tabs.length]);
  const closeTab = useCallback((id: string) => {
    handles.current.get(id)?.kill();
    handles.current.delete(id);
    setTabs((current) => {
      if (current.length === 1) return [newTab(1, defaultTerminalProfile())];
      const index = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      if (id === effectiveActiveId) setActiveId(next[Math.max(0, index - 1)]?.id || next[0]?.id || "");
      return next;
    });
    if (splitId === id) setSplitId(undefined);
  }, [effectiveActiveId, splitId]);
  const activeHandle = active ? handles.current.get(active.id) : undefined;
  const stateLabel = active?.metadata.state === "connected" ? "Bağlı" : active?.metadata.state === "connecting" ? "Bağlanıyor" : active?.metadata.state === "exited" ? "Süreç sonlandı" : active?.metadata.state === "error" ? "Hata" : "Bağlantı kesildi";

  useEffect(() => {
    if (!searchOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSearchOpen(false); activeHandle?.clearSearch(); activeHandle?.focus(); }
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) activeHandle?.findPrevious(searchQuery);
        else activeHandle?.findNext(searchQuery);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeHandle, searchOpen, searchQuery]);

  return <section className={styles.workbench} aria-label="Terminal çalışma alanı">
    <div className={styles.toolbar}>
      <div className={styles.tabs} role="tablist" aria-label="Terminal oturumları">
        {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={tab.id === effectiveActiveId} className={`${styles.tab} ${tab.id === effectiveActiveId ? styles.activeTab : ""}`} onClick={() => focus(tab.id)} onDoubleClick={() => setSplitId(splitId === tab.id ? undefined : tab.id)}>
          <span className={`${styles.stateDot} ${styles[tab.metadata.state]}`} aria-hidden="true" />
          <span>{tab.name}</span>
          <span className={styles.tabClose} role="button" aria-label={`${tab.name} terminalini kapat`} onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}><X size={12} /></span>
        </button>)}
      </div>
      <div className={styles.toolbarActions}>
        <span className={styles.toolbarLabel}>OTURUM</span>
        <div className={styles.profileMenu}>
          <button type="button" className={styles.iconButton} title="Yeni terminal" aria-label="Yeni terminal" onClick={() => setProfileMenuOpen((value) => !value)}><Plus size={15} /><ChevronDown size={11} /></button>
          {profileMenuOpen && <div className={styles.profilePopover} role="menu">
            {(Object.keys(PROFILE_LABELS) as TerminalProfile[]).filter((profile) => /win/i.test(navigator.platform) ? profile !== "zsh" : profile !== "powershell" && profile !== "cmd").map((profile) => <button key={profile} type="button" role="menuitem" onClick={() => addTab(profile)}>{PROFILE_LABELS[profile]}</button>)}
          </div>}
        </div>
        <button type="button" className={styles.iconButton} title="Terminali böl" aria-label="Terminali böl" onClick={() => addTab(active?.profile || "default", true)}><PanelRight size={15} /></button>
        <button type="button" className={styles.iconButton} title="Terminalde ara" aria-label="Terminalde ara" onClick={() => setSearchOpen((value) => !value)}><Search size={15} /></button>
        <button type="button" className={styles.iconButton} title="Seçimi kopyala" aria-label="Terminal seçimini kopyala" onClick={() => void activeHandle?.copySelection()}><Copy size={15} /></button>
        <button type="button" className={styles.iconButton} title="Terminali temizle" aria-label="Terminali temizle" onClick={() => activeHandle?.clear()}><Trash2 size={15} /></button>
      </div>
    </div>
    <div className={styles.isolationBanner} role="note" data-testid="pty-isolation-banner">
      {PTY_ISOLATION_NOTICE_TR}
    </div>
    {searchOpen && <div className={styles.searchbar} role="search">
      <Search size={14} aria-hidden="true" />
      <input autoFocus value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); activeHandle?.findNext(event.target.value); }} placeholder="Terminalde ara" aria-label="Terminalde ara" />
      <button type="button" onClick={() => activeHandle?.findPrevious(searchQuery)} aria-label="Önceki eşleşme">↑</button>
      <button type="button" onClick={() => activeHandle?.findNext(searchQuery)} aria-label="Sonraki eşleşme">↓</button>
      <button type="button" onClick={() => { setSearchOpen(false); activeHandle?.clearSearch(); activeHandle?.focus(); }} aria-label="Aramayı kapat"><X size={14} /></button>
    </div>}
    <div className={`${styles.terminals} ${splitId ? styles.split : ""}`}>
      {tabs.map((tab) => {
        const visible = tab.id === effectiveActiveId || tab.id === splitId;
        return <TerminalSurface key={tab.id} tab={tab} visible={visible} active={tab.id === effectiveActiveId} onActivate={() => focus(tab.id)} onMetadata={updateMetadata} onRegister={register} />;
      })}
      {splitId && <button className={styles.unsplit} type="button" title="Bölmeyi kapat" aria-label="Terminal bölmesini kapat" onClick={() => setSplitId(undefined)}><Maximize2 size={14} /></button>}
    </div>
    <footer className={styles.statusbar} aria-label="Terminal durumu">
      <div className={styles.statusPrimary}>
        <span className={styles.statusState}><span className={`${styles.stateDot} ${active ? styles[active.metadata.state] : ""}`} aria-hidden="true" />{stateLabel}</span>
        <span className={styles.statusItem}><SquareTerminal size={11} aria-hidden="true" />{active?.metadata.shell || PROFILE_LABELS[active?.profile || "default"]}</span>
        <span className={`${styles.statusItem} ${styles.cwd}`} title={active?.metadata.cwd}><Folder size={11} aria-hidden="true" />{active?.metadata.cwd || "Çalışma alanı"}</span>
        <span className={styles.isolationChip} title={PTY_ISOLATION_NOTICE_TR}>OS sandbox dışı</span>
      </div>
      <div className={styles.contextActions}>
        {splitId && <span className={styles.splitBadge}>2 BÖLME</span>}
        {onAddContext && <button type="button" onClick={() => active && onAddContext({ label: active.name, text: activeHandle?.snapshot(8000) || "" })}>Bağlama ekle</button>}
        {onAsk && <button type="button" className={styles.primaryAction} onClick={() => onAsk(`Bu terminal çıktısını analiz et, hata varsa kök nedeni ve düzeltme planını yaz:\n\n${activeHandle?.snapshot(8000) || ""}`)}>Quake ile analiz et</button>}
      </div>
    </footer>
  </section>;
}

function TerminalSurface({ tab, visible, active, onActivate, onMetadata, onRegister }: { tab: TerminalTab; visible: boolean; active: boolean; onActivate: () => void; onMetadata: (id: string, metadata: Partial<TerminalMetadata>) => void; onRegister: (id: string, handle?: TerminalHandle) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const metadataRef = useRef(onMetadata);
  metadataRef.current = onMetadata;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let intentionallyKilled = false;
    let reconnectTimer: number | undefined;
    let reconnectAttempts = 0;
    let isolationBannerPainted = false;
    let socket: WebSocket | undefined;
    const term = new Terminal({
      fontFamily: tok("--font-mono", 'ui-monospace, "SFMono-Regular", Menlo, monospace'), fontSize: 13, lineHeight: 1.25, cursorBlink: true, cursorStyle: "bar", scrollback: 10_000, theme: buildTheme(currentMode()),
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_event, uri) => {
      if (/^https?:\/\//i.test(uri)) window.open(uri, "_blank", "noopener,noreferrer");
    }));
    term.loadAddon(search);
    term.open(host);

    const paintIsolationBanner = (notice?: string) => {
      if (isolationBannerPainted) return;
      isolationBannerPainted = true;
      const text = (typeof notice === "string" && notice.trim()) || PTY_ISOLATION_NOTICE_TR;
      // Dim yellow client-side note — not sent to the shell process.
      term.writeln(`\x1b[33m${text}\x1b[0m`);
    };

    const fitAndResize = () => {
      if (disposed || !host.offsetParent) return;
      try { fit.fit(); } catch { return; }
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "r", c: term.cols, r: term.rows }));
    };
    const connect = () => {
      if (disposed || intentionallyKilled) return;
      metadataRef.current(tab.id, { state: reconnectAttempts ? "disconnected" : "connecting" });
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const params = new URLSearchParams({ session: tab.id, profile: tab.profile, cols: String(term.cols), rows: String(term.rows) });
      const protocols = authToken ? ["quake-terminal", `quake-auth.${encodeProtocolToken(authToken)}`] : ["quake-terminal"];
      socket = new WebSocket(`${proto}://${location.host}/api/terminal?${params}`, protocols);
      socket.onopen = () => { reconnectAttempts = 0; metadataRef.current(tab.id, { state: "connected" }); fitAndResize(); if (active) term.focus(); };
      socket.onmessage = (event) => {
        let message: { t: string; d?: string; code?: number; cwd?: string; shell?: string; message?: string; notice?: string; isolation?: string };
        try { message = JSON.parse(typeof event.data === "string" ? event.data : ""); } catch { return; }
        if ((message.t === "o" || message.t === "replay") && typeof message.d === "string") term.write(message.d);
        else if (message.t === "ready") {
          metadataRef.current(tab.id, { state: "connected", cwd: message.cwd, shell: message.shell });
          // S-OS.3: first connect / first paint honesty (once per tab surface).
          paintIsolationBanner(message.notice);
        }
        else if (message.t === "x") { metadataRef.current(tab.id, { state: "exited" }); term.write(`\r\n\x1b[90m[süreç sonlandı: ${message.code}]\x1b[0m\r\n`); }
        else if (message.t === "e") { metadataRef.current(tab.id, { state: "error" }); term.write(`\r\n\x1b[31m[${message.message || "terminal hatası"}]\x1b[0m\r\n`); }
      };
      socket.onclose = () => {
        if (disposed || intentionallyKilled) return;
        metadataRef.current(tab.id, { state: "disconnected" });
        reconnectAttempts += 1;
        const delay = Math.min(10_000, 500 * 2 ** Math.min(5, reconnectAttempts - 1));
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };
    const input = term.onData((data) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "i", d: data })); });
    const ro = new ResizeObserver(() => fitAndResize());
    ro.observe(host);
    const mo = new MutationObserver(() => { if (!disposed) term.options.theme = buildTheme(currentMode()); });
    mo.observe(themeRoot(), { attributes: true, attributeFilter: ["data-theme"] });
    requestAnimationFrame(fitAndResize);
    connect();

    onRegister(tab.id, {
      focus: () => term.focus(), fit: fitAndResize,
      findNext: (query) => Boolean(query && search.findNext(query, { incremental: true })),
      findPrevious: (query) => Boolean(query && search.findPrevious(query)),
      clearSearch: () => search.clearDecorations(),
      copySelection: async () => { const text = term.getSelection(); if (!text) return false; await navigator.clipboard.writeText(text); return true; },
      clear: () => { term.clear(); term.write("\x1b[2J\x1b[H"); },
      snapshot: (maxChars = 8000) => { const buffer = term.buffer.active; const lines: string[] = []; for (let index = 0; index < buffer.length; index += 1) lines.push(buffer.getLine(index)?.translateToString(true) || ""); return lines.join("\n").trim().slice(-maxChars); },
      kill: () => { intentionallyKilled = true; if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "kill" })); socket?.close(); },
    });

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      ro.disconnect(); mo.disconnect(); input.dispose(); onRegister(tab.id);
      try { socket?.close(); } catch { /* already closed */ }
      try { term.dispose(); } catch { /* xterm may be half-disposed */ }
    };
  }, [tab.id, tab.profile, onRegister]);

  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      const event = new Event("resize");
      window.dispatchEvent(event);
    });
  }, [visible]);

  return <div ref={hostRef} className={`${styles.host} ${visible ? styles.visible : styles.hidden} ${active ? styles.activeSurface : ""}`} onMouseDown={onActivate} data-testid="terminal-surface" />;
}

export default XtermTerminal;
