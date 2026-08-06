import React, { useCallback, useEffect, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { ChevronDown, Copy, Folder, Link2, Maximize2, MessageSquareText, PanelRight, Plus, Search, SquareTerminal, Trash2, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { type Translate, useI18n } from "../../i18n";
import { authToken } from "../../lib/api";
import { focusFirstMenuItem, handleMenuKeyDown, restoreMenuTriggerFocus } from "../../lib/menu-keyboard";
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

function profileLabel(profile: TerminalProfile, t: Translate): string {
  return profile === "default" ? t("runtime.terminal.defaultShell") : profile === "powershell" ? "PowerShell" : profile === "cmd" ? "Command Prompt" : profile === "bash" ? "Bash" : "Zsh";
}

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
    background: tok("--surface-terminal", "#fbfbfc"), foreground: tok("--text-terminal", "#24262a"), cursor: tok("--text-primary", "#111111"), cursorAccent: tok("--surface-terminal", "#fbfbfc"), selectionBackground: "rgba(20, 24, 30, 0.13)",
    black: "#35383d", red: "#b4474f", green: "#3b7f50", yellow: "#8a6e25", blue: "#356fa8", magenta: "#77589b", cyan: "#367982", white: "#c8cacf",
    brightBlack: "#6f7379", brightRed: "#c95760", brightGreen: "#4b9360", brightYellow: "#9d8134", brightBlue: "#467fb9", brightMagenta: "#8769aa", brightCyan: "#478a93", brightWhite: "#15171a",
  };
  return {
    background: tok("--surface-terminal", "#0d0e0f"), foreground: tok("--text-terminal", "#d8dade"), cursor: tok("--text-primary", "#f5f5f7"), cursorAccent: tok("--surface-terminal", "#0d0e0f"), selectionBackground: "rgba(216, 218, 222, 0.14)",
    black: "#303338", red: "#df7279", green: "#8fcf9d", yellow: "#d6b86a", blue: "#7fa8d8", magenta: "#b39ad2", cyan: "#79b8c7", white: "#d0d3d8",
    brightBlack: "#6f747b", brightRed: "#ed858c", brightGreen: "#a1dcad", brightYellow: "#e1c77d", brightBlue: "#91b7e2", brightMagenta: "#c2acdc", brightCyan: "#8bc7d2", brightWhite: "#f1f2f4",
  };
}
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

export function XtermTerminal({ onAsk, onAddContext, panelControls }: { onAsk?: (text: string) => void; onAddContext?: (context: { label: string; text: string }) => void; panelControls?: React.ReactNode }) {
  const { t } = useI18n();
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [newTab(1, defaultTerminalProfile())]);
  const [activeId, setActiveId] = useState(() => "");
  const [splitId, setSplitId] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const handles = useRef(new Map<string, TerminalHandle>());
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
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
  const stateLabel = active?.metadata.state === "connected" ? t("runtime.terminal.connected") : active?.metadata.state === "connecting" ? t("runtime.terminal.connecting") : active?.metadata.state === "exited" ? t("runtime.terminal.processEnded") : active?.metadata.state === "error" ? t("runtime.terminal.error") : t("runtime.terminal.disconnected");

  const closeProfileMenu = useCallback((restoreFocus = false) => {
    setProfileMenuOpen(false);
    if (restoreFocus) restoreMenuTriggerFocus(profileTriggerRef.current);
  }, []);

  const onTabListKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="tab"]') : null;
    if (!target) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index = items.indexOf(target as HTMLButtonElement);
    if (index < 0 || items.length === 0) return;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowRight"
          ? (index + 1) % items.length
          : (index - 1 + items.length) % items.length;
    event.preventDefault();
    items[nextIndex]?.focus({ preventScroll: true });
    items[nextIndex]?.click();
  }, []);

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

  useEffect(() => {
    if (!profileMenuOpen) return;
    requestAnimationFrame(() => focusFirstMenuItem(profileMenuRef.current));
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || profileMenuRef.current?.contains(target) || profileTriggerRef.current?.contains(target)) return;
      closeProfileMenu();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [closeProfileMenu, profileMenuOpen]);

  return <section className={styles.workbench} aria-label={t("runtime.terminal.workbench")}>
    <div className={styles.toolbar}>
      <div className={styles.tabs} role="tablist" aria-label={t("runtime.terminal.sessions")} onKeyDown={onTabListKeyDown}>
        {tabs.map((tab) => <div className={styles.tabShell} data-active={tab.id === effectiveActiveId ? "true" : undefined} key={tab.id}>
          <button id={`terminal-tab-${tab.id}`} type="button" role="tab" tabIndex={tab.id === effectiveActiveId ? 0 : -1} aria-selected={tab.id === effectiveActiveId} aria-controls={`terminal-surface-${tab.id}`} className={styles.tab} onClick={() => focus(tab.id)} onDoubleClick={() => setSplitId(splitId === tab.id ? undefined : tab.id)}>
            <span className={styles.tabLabel}>{tab.name}</span>
          </button>
          <button type="button" className={styles.tabClose} aria-label={t("runtime.terminal.closeTab", { name: tab.name })} onClick={() => closeTab(tab.id)}><X size={12} aria-hidden="true" /></button>
        </div>)}
      </div>
      <div className={styles.toolbarActions} role="toolbar" aria-label={t("runtime.terminal.tools")}>
        <div className={styles.profileMenu}>
          <button ref={profileTriggerRef} type="button" className={styles.iconButton} title={t("runtime.terminal.newTerminal")} aria-label={t("runtime.terminal.newTerminal")} aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((value) => !value)}><Plus size={15} /><ChevronDown size={11} /></button>
          {profileMenuOpen && <div ref={profileMenuRef} className={styles.profilePopover} role="menu" onKeyDown={(event) => handleMenuKeyDown(event, { onEscape: () => closeProfileMenu(true) })}>
            {(["default", "powershell", "cmd", "bash", "zsh"] as TerminalProfile[]).filter((profile) => /win/i.test(navigator.platform) ? profile !== "zsh" : profile !== "powershell" && profile !== "cmd").map((profile) => <button key={profile} type="button" role="menuitem" onClick={() => addTab(profile)}>{profileLabel(profile, t)}</button>)}
          </div>}
        </div>
        <button type="button" className={styles.iconButton} title={t("runtime.terminal.split")} aria-label={t("runtime.terminal.split")} onClick={() => addTab(active?.profile || "default", true)}><PanelRight size={15} /></button>
        <span className={styles.toolbarDivider} aria-hidden="true" />
        <button type="button" className={styles.iconButton} title={t("runtime.terminal.search")} aria-label={t("runtime.terminal.search")} onClick={() => setSearchOpen((value) => !value)}><Search size={15} /></button>
        <button type="button" className={`${styles.iconButton} ${styles.secondaryTool}`} title={t("runtime.terminal.copySelection")} aria-label={t("runtime.terminal.copySelection")} onClick={() => void activeHandle?.copySelection()}><Copy size={15} /></button>
        <button type="button" className={`${styles.iconButton} ${styles.secondaryTool}`} title={t("runtime.terminal.clear")} aria-label={t("runtime.terminal.clear")} onClick={() => activeHandle?.clear()}><Trash2 size={15} /></button>
        {panelControls ? <><span className={styles.toolbarDivider} aria-hidden="true" />{panelControls}</> : null}
      </div>
    </div>
    {searchOpen && <div className={styles.searchbar} role="search">
      <Search size={14} aria-hidden="true" />
      <input autoFocus value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); activeHandle?.findNext(event.target.value); }} placeholder={t("runtime.terminal.search")} aria-label={t("runtime.terminal.search")} />
      <button type="button" onClick={() => activeHandle?.findPrevious(searchQuery)} aria-label={t("runtime.terminal.previousMatch")}>↑</button>
      <button type="button" onClick={() => activeHandle?.findNext(searchQuery)} aria-label={t("runtime.terminal.nextMatch")}>↓</button>
      <button type="button" onClick={() => { setSearchOpen(false); activeHandle?.clearSearch(); activeHandle?.focus(); }} aria-label={t("runtime.terminal.closeSearch")}><X size={14} /></button>
    </div>}
    <div className={`${styles.terminals} ${splitId ? styles.split : ""}`}>
      {tabs.map((tab) => {
        const visible = tab.id === effectiveActiveId || tab.id === splitId;
        return <TerminalSurface key={tab.id} tab={tab} visible={visible} active={tab.id === effectiveActiveId} onActivate={() => focus(tab.id)} onMetadata={updateMetadata} onRegister={register} />;
      })}
      {splitId && <button className={styles.unsplit} type="button" title={t("runtime.terminal.closeSplit")} aria-label={t("runtime.terminal.closeSplit")} onClick={() => setSplitId(undefined)}><Maximize2 size={14} /></button>}
    </div>
    <footer className={styles.statusbar} aria-label={t("runtime.terminal.status")}>
      <div className={styles.statusPrimary}>
        <span className={styles.statusState}><span className={`${styles.stateDot} ${active ? styles[active.metadata.state] : ""}`} aria-hidden="true" />{stateLabel}</span>
        <span className={styles.statusItem}><SquareTerminal size={11} aria-hidden="true" />{active?.metadata.shell || profileLabel(active?.profile || "default", t)}</span>
        <span className={`${styles.statusItem} ${styles.cwd}`} title={active?.metadata.cwd}><Folder size={11} aria-hidden="true" />{active?.metadata.cwd || t("runtime.terminal.workspace")}</span>
      </div>
      <div className={styles.contextActions}>
        {splitId && <span className={styles.splitBadge}>{t("runtime.terminal.twoPanes")}</span>}
        {onAddContext && <button type="button" aria-label={t("runtime.terminal.addOutputContext")} title={t("runtime.terminal.addContext")} onClick={() => active && onAddContext({ label: active.name, text: activeHandle?.snapshot(8000) || "" })}><Link2 size={12} aria-hidden="true" /><span className={styles.actionLabel}>{t("runtime.terminal.addContext")}</span></button>}
        {onAsk && <button type="button" className={styles.primaryAction} aria-label={t("runtime.terminal.analyzeOutput")} title={t("runtime.terminal.analyze")} onClick={() => onAsk(`${t("runtime.terminal.analyzePrompt")}\n\n${activeHandle?.snapshot(8000) || ""}`)}><MessageSquareText size={12} aria-hidden="true" /><span className={styles.actionLabel}>{t("runtime.terminal.analyze")}</span></button>}
      </div>
    </footer>
  </section>;
}

function TerminalSurface({ tab, visible, active, onActivate, onMetadata, onRegister }: { tab: TerminalTab; visible: boolean; active: boolean; onActivate: () => void; onMetadata: (id: string, metadata: Partial<TerminalMetadata>) => void; onRegister: (id: string, handle?: TerminalHandle) => void }) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const metadataRef = useRef(onMetadata);
  const tRef = useRef(t);
  metadataRef.current = onMetadata;
  tRef.current = t;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let intentionallyKilled = false;
    let reconnectTimer: number | undefined;
    let reconnectAttempts = 0;
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
        let message: { t: string; d?: string; code?: number; cwd?: string; shell?: string; message?: string };
        try { message = JSON.parse(typeof event.data === "string" ? event.data : ""); } catch { return; }
        if ((message.t === "o" || message.t === "replay") && typeof message.d === "string") term.write(message.d);
        else if (message.t === "ready") {
          metadataRef.current(tab.id, { state: "connected", cwd: message.cwd, shell: message.shell });
        }
        else if (message.t === "x") { metadataRef.current(tab.id, { state: "exited" }); term.write(`\r\n\x1b[90m[${tRef.current("runtime.terminal.processEnded")}: ${message.code}]\x1b[0m\r\n`); }
        else if (message.t === "e") { metadataRef.current(tab.id, { state: "error" }); term.write(`\r\n\x1b[31m[${message.message || tRef.current("runtime.terminal.error")}]\x1b[0m\r\n`); }
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

  return <div id={`terminal-surface-${tab.id}`} ref={hostRef} role="tabpanel" aria-labelledby={`terminal-tab-${tab.id}`} aria-hidden={!visible} className={`${styles.host} ${visible ? styles.visible : styles.hidden} ${active ? styles.activeSurface : ""}`} onMouseDown={onActivate} data-testid="terminal-surface" />;
}

export default XtermTerminal;
