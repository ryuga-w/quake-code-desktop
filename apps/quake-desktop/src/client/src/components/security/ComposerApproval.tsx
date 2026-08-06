import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, FilePenLine, Globe, Layers, SquareTerminal } from "lucide-react";
import { useI18n } from "../../i18n";
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
  const { t } = useI18n();
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
    ? `MCP · ${mcp?.serverName || mcp?.serverId || t("runtime.approval.tool")}`
    : isFileChange
      ? t("runtime.approval.fileChange")
      : isNetwork
        ? t("runtime.approval.networkAccess")
        : t("runtime.approval.terminal");
  const kind = isMcp ? "mcp_tool" : isFileChange ? "file_change" : isNetwork ? "network" : "command";

  return (
    <section
      ref={rootRef}
      className={styles.root}
      role="alertdialog"
      aria-label={isMcp ? t("runtime.approval.mcpAria") : isFileChange ? t("runtime.approval.fileAria") : isNetwork ? t("runtime.approval.networkAria") : t("runtime.approval.commandAria")}
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
          {decisionOutcome === "approved" ? t("runtime.approval.approved") : t("runtime.approval.denied")}
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
          {t("runtime.approval.decline")}
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
              {t("runtime.approval.allowOnce")}
            </button>
            <button
              ref={menuTriggerRef}
              type="button"
              className={styles.allowMenuBtn}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("runtime.approval.otherOptions")}
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
              aria-label={t("runtime.approval.options")}
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
                <b>{t("runtime.approval.allowOnce")}</b>
                <span>{t("runtime.approval.onlyThisRequest")}</span>
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
                <b>{t("runtime.approval.allowSession")}</b>
                <span>
                  {isMcp
                    ? t("runtime.approval.mcpSession")
                    : isNetwork
                      ? t("runtime.approval.networkSession")
                      : t("runtime.approval.commandSession")}
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
                  <b>{t("runtime.approval.always")}</b>
                  <span>{t("runtime.approval.mcpAlways")}</span>
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
                  <b>{t("runtime.approval.always")}</b>
                  <span>
                    {t("runtime.approval.alwaysDescription")}
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
                    <b>{t("runtime.approval.allowPrefix", { prefix: prefixLabel })}</b>
                    <span>{t("runtime.approval.prefixSession")}</span>
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
                    <b>{t("runtime.approval.allowPrefixAlways", { prefix: prefixLabel })}</b>
                    <span>{t("runtime.approval.persistentDescription")}</span>
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
                    <b>{t("runtime.approval.allowHost", { host: hostLabel })}</b>
                    <span>{t("runtime.approval.hostSession")}</span>
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
                    <b>{t("runtime.approval.allowHostAlways", { host: hostLabel })}</b>
                    <span>{t("runtime.approval.persistentDescription")}</span>
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
                    <b>{t("runtime.approval.denyHost", { host: hostLabel })}</b>
                    <span>{t("runtime.approval.denyHostDescription")}</span>
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
                <b>{t("runtime.approval.cancelStop")}</b>
                <span>{t("runtime.approval.cancelStopDescription")}</span>
              </button>
            </div>
          )}
        </div>
      </footer>
    </section>
  );
}
