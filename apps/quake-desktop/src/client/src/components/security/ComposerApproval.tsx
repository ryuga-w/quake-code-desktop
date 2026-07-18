import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, FilePenLine, Globe, Layers, SquareTerminal } from "lucide-react";
import { focusFirstMenuItem, handleMenuKeyDown, restoreMenuTriggerFocus } from "../../lib/menu-keyboard";
import { ComposerPet } from "../composer/ComposerPet";
import { ToolCodeBlock } from "../tools/ToolCodeBlock";
import styles from "./ComposerApproval.module.css";

const APPROVAL_FEEDBACK_MS = 520;

export type ApprovalDecisionUi =
  | "accept"
  | "acceptForSession"
  | "acceptAlways"
  | "acceptWithExecpolicyAmendment"
  | "applyNetworkPolicyAmendment"
  | "decline"
  | "cancel";

export type ApprovalDecidePayload = {
  decision: ApprovalDecisionUi;
  execpolicyAmendment?: { command: string[] };
  networkPolicyAmendment?: {
    host: string;
    action: "allow" | "deny";
    protocol?: "http" | "https" | "socks5_tcp" | "socks5_udp";
  };
  /** session (default) or always — durable guardian-always.json for prefix/host amendments */
  scope?: "session" | "always";
};

export interface ComposerApprovalProps {
  id: string;
  tool: string;
  summary: string;
  command?: string;
  reason?: string;
  risk: "low" | "medium" | "high";
  presetLabel?: string;
  fileChange?: {
    files: Array<{ path: string; kind: string; added: number; removed: number }>;
    patchPreview?: string;
  };
  proposedExecpolicyAmendment?: { command: string[] };
  networkApprovalContext?: { host: string; protocol: "http" | "https" | "socks5_tcp" | "socks5_udp" };
  proposedNetworkPolicyAmendments?: Array<{
    host: string;
    action: "allow" | "deny";
    protocol?: "http" | "https" | "socks5_tcp" | "socks5_udp";
  }>;
  /** MCP tool approval */
  kind?: "exec" | "file_change" | "network" | "mcp_tool" | "generic" | "command";
  mcp?: { serverId: string; serverName?: string; toolName: string };
  onDecide: (payload: ApprovalDecidePayload) => void;
}

/**
 * Codex desktop-style approval: sits in the composer slot (not a centered modal).
 * Terminal / file / network card + Reddet / Bir kez izin ver ▾
 */
export function ComposerApproval({
  tool,
  summary,
  command,
  reason,
  risk,
  fileChange,
  proposedExecpolicyAmendment,
  networkApprovalContext,
  proposedNetworkPolicyAmendments,
  kind: kindProp,
  mcp,
  onDecide,
}: ComposerApprovalProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [decisionOutcome, setDecisionOutcome] = useState<"approved" | "denied">();
  const decisionPendingRef = useRef(false);
  const decisionTimerRef = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLElement | null>(null);
  const allowRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const isMcp = kindProp === "mcp_tool" || Boolean(mcp?.serverId);
  const isFileChange = !isMcp && (tool === "apply_patch" || Boolean(fileChange?.files?.length));
  const isNetwork = !isMcp && Boolean(networkApprovalContext?.host);
  const body = (command || summary || "").trim();
  const promptText = (reason || summary || "").trim();
  const showCommand = Boolean(command?.trim()) && command?.trim() !== promptText;
  const patchPreview = fileChange?.patchPreview || (isFileChange && !fileChange?.files?.length ? body : "");
  const prefixLabel = proposedExecpolicyAmendment?.command?.join(" ") || "";
  const hostLabel = networkApprovalContext?.host || "";

  const decide = React.useCallback((payload: ApprovalDecidePayload) => {
    if (decisionPendingRef.current) return;
    decisionPendingRef.current = true;
    setMenuOpen(false);
    const denied = payload.decision === "decline"
      || payload.decision === "cancel"
      || payload.networkPolicyAmendment?.action === "deny";
    setDecisionOutcome(denied ? "denied" : "approved");
    decisionTimerRef.current = window.setTimeout(() => onDecide(payload), APPROVAL_FEEDBACK_MS);
  }, [onDecide]);

  useEffect(() => () => {
    if (decisionTimerRef.current !== undefined) window.clearTimeout(decisionTimerRef.current);
  }, []);

  const closeMenuAndRestoreFocus = React.useCallback(() => {
    setMenuOpen(false);
    restoreMenuTriggerFocus(menuTriggerRef.current);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (menuOpen) {
          closeMenuAndRestoreFocus();
          return;
        }
        decide({ decision: "decline" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, decide, closeMenuAndRestoreFocus]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [menuOpen]);

  useEffect(() => {
    const t = window.setTimeout(() => allowRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (menuOpen) focusFirstMenuItem(menuRef.current);
  }, [menuOpen]);

  const title = isMcp
    ? `MCP · ${mcp?.serverName || mcp?.serverId || "araç"}`
    : isFileChange
      ? "Dosya değişikliği"
      : isNetwork
        ? "Ağ erişimi"
        : "Terminal";
  const kind = isMcp ? "mcp_tool" : isFileChange ? "file_change" : isNetwork ? "network" : "command";

  return (
    <section
      ref={rootRef}
      className={styles.root}
      role="alertdialog"
      aria-label={isMcp ? "MCP araç onayı" : isFileChange ? "Dosya değişikliği onayı" : isNetwork ? "Ağ onayı" : "Komut onayı"}
      aria-modal="true"
      data-approval-kind={kind}
      data-kind={kind}
      data-risk={risk}
      data-decision-outcome={decisionOutcome}
      aria-busy={decisionOutcome ? "true" : undefined}
    >
      <ComposerPet prompt="" canSubmit={false} busy={false} approval approvalOutcome={decisionOutcome} />
      {decisionOutcome ? (
        <span className={styles.decisionStatus} role="status">
          {decisionOutcome === "approved" ? "İzin verildi" : "İstek reddedildi"}
        </span>
      ) : null}
      <header className={styles.header}>
        <span className={styles.icon} aria-hidden="true">
          {isMcp ? (
            <Layers size={16} strokeWidth={1.9} />
          ) : isFileChange ? (
            <FilePenLine size={16} strokeWidth={1.9} />
          ) : isNetwork ? (
            <Globe size={16} strokeWidth={1.9} />
          ) : (
            <SquareTerminal size={16} strokeWidth={1.9} />
          )}
        </span>
        <h3 className={styles.title}>{title}</h3>
      </header>

      {promptText ? <p className={styles.reason}>{promptText}</p> : null}

      {isNetwork && hostLabel ? (
        <p className={styles.reason} style={{ opacity: 0.85 }}>
          Host: <code style={{ fontFamily: "var(--font-mono)" }}>{hostLabel}</code>
          {networkApprovalContext?.protocol ? ` · ${networkApprovalContext.protocol}` : ""}
        </p>
      ) : null}

      {fileChange?.files && fileChange.files.length > 0 ? (
        <ul className={styles.fileList} data-file-change-list="true">
          {fileChange.files.map((f) => (
            <li key={f.path}>
              <span className={styles.filePath}>
                <span className={styles.fileKind}>{f.kind}</span>
                {f.path}
              </span>
              <span className={styles.fileStats}>
                <span className={styles.add}>+{f.added}</span>{" "}
                <span className={styles.rem}>-{f.removed}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {isFileChange && patchPreview ? (
        <div className={styles.patch}>
          <ToolCodeBlock code={patchPreview} language="diff" maxChars={8_000} />
        </div>
      ) : showCommand ? (
        <pre className={styles.command}>{command}</pre>
      ) : !promptText && body ? (
        <pre className={styles.command}>{body}</pre>
      ) : null}

      <footer className={styles.footer}>
        <button type="button" className={styles.decline} disabled={Boolean(decisionOutcome)} onClick={() => decide({ decision: "decline" })}>
          Reddet
        </button>
        <div className={styles.allowWrap}>
          <div className={styles.allowGroup}>
            <button
              ref={allowRef}
              type="button"
              className={styles.allow}
              disabled={Boolean(decisionOutcome)}
              onClick={() => decide({ decision: "accept" })}
            >
              Bir kez izin ver
            </button>
            <button
              ref={menuTriggerRef}
              type="button"
              className={styles.allowMenuBtn}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Diğer izin seçenekleri"
              disabled={Boolean(decisionOutcome)}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          {menuOpen && (
            <div
              ref={menuRef}
              className={styles.menu}
              role="menu"
              aria-label="İzin seçenekleri"
              onKeyDown={(event) => handleMenuKeyDown(event, { onEscape: closeMenuAndRestoreFocus })}
            >
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  decide({ decision: "accept" });
                }}
              >
                <b>Bir kez izin ver</b>
                <span>Sadece bu isteği şimdi çalıştır</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  decide({ decision: "acceptForSession" });
                }}
              >
                <b>Oturum boyunca izin ver</b>
                <span>
                  {isMcp
                    ? "Bu MCP aracını bu oturumda sorma"
                    : isNetwork
                      ? "Bu host ve aynı istek için oturumda sorma"
                      : "Bu oturumda aynı komutu sorma"}
                </span>
              </button>
              {isMcp ? (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    decide({ decision: "acceptAlways" });
                  }}
                >
                  <b>Her zaman izin ver</b>
                  <span>Bu MCP aracını bir daha sorma (yeniden başlatmada da geçerli; Ayarlar → MCP bölümünden iptal)</span>
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    decide({ decision: "acceptAlways" });
                  }}
                >
                  <b>Her zaman izin ver</b>
                  <span>
                    Bu isteği bir daha sorma (yeniden başlatmada da geçerli; Ayarlar → İzinler → Kalıcı izinler)
                  </span>
                </button>
              )}
              {prefixLabel ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      decide({
                        decision: "acceptWithExecpolicyAmendment",
                        execpolicyAmendment: proposedExecpolicyAmendment,
                        scope: "session",
                      });
                    }}
                  >
                    <b>{`“${prefixLabel}” ile başlayanlara izin ver`}</b>
                    <span>Bu oturumda eşleşen komutları sorma</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      decide({
                        decision: "acceptWithExecpolicyAmendment",
                        execpolicyAmendment: proposedExecpolicyAmendment,
                        scope: "always",
                      });
                    }}
                  >
                    <b>{`“${prefixLabel}” ile başlayanlara her zaman izin ver`}</b>
                    <span>Yeniden başlatmada da geçerli; Ayarlar → İzinler → Kalıcı izinler</span>
                  </button>
                </>
              ) : null}
              {hostLabel ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      const allow =
                        proposedNetworkPolicyAmendments?.find((a) => a.action === "allow") || {
                          host: hostLabel,
                          action: "allow" as const,
                          protocol: networkApprovalContext?.protocol,
                        };
                      decide({
                        decision: "applyNetworkPolicyAmendment",
                        networkPolicyAmendment: allow,
                        scope: "session",
                      });
                    }}
                  >
                    <b>{`${hostLabel} host’una izin ver`}</b>
                    <span>Bu oturumda bu host’a ağ erişimi</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      const allow =
                        proposedNetworkPolicyAmendments?.find((a) => a.action === "allow") || {
                          host: hostLabel,
                          action: "allow" as const,
                          protocol: networkApprovalContext?.protocol,
                        };
                      decide({
                        decision: "applyNetworkPolicyAmendment",
                        networkPolicyAmendment: allow,
                        scope: "always",
                      });
                    }}
                  >
                    <b>{`${hostLabel} host’una her zaman izin ver`}</b>
                    <span>Yeniden başlatmada da geçerli; Ayarlar → İzinler → Kalıcı izinler</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      const deny =
                        proposedNetworkPolicyAmendments?.find((a) => a.action === "deny") || {
                          host: hostLabel,
                          action: "deny" as const,
                          protocol: networkApprovalContext?.protocol,
                        };
                      decide({
                        decision: "applyNetworkPolicyAmendment",
                        networkPolicyAmendment: deny,
                        scope: "session",
                      });
                    }}
                  >
                    <b>{`${hostLabel} host’unu engelle`}</b>
                    <span>Bu oturumda bu host’a erişimi reddet</span>
                  </button>
                </>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  decide({ decision: "cancel" });
                }}
              >
                <b>İptal et ve durdur</b>
                <span>Onayı kapat, ajanı kes</span>
              </button>
            </div>
          )}
        </div>
      </footer>
    </section>
  );
}
