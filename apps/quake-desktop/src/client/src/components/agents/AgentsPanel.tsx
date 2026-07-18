import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../state/app-store";
import { apiPost } from "../../lib/api";
import { desktop } from "../../lib/desktop";
import { useConfirmAction } from "../common/ConfirmContext";
import {
  collectAgentActivity,
  collectWorkspaceSubagents,
  interpretMergeResult,
  isAgentActiveStatus,
  mergeCommandForAgent,
  MERGE_CONFLICT_DIFF_CMD,
  mergeConflictOutputText,
  parseMergeConflictPaths,
  workspaceAgentStatusLabel,
  type AgentActivityLine,
  type AgentThreadRole,
  type WorkspaceSubagentSummary,
} from "./collect-subagents";
import styles from "./AgentsPanel.module.css";

type Filter = "all" | "active" | "done";

type MergeConflictState = {
  agentId: string;
  branch: string;
  paths: string[];
};

function statusPillClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "running" || s === "queued" || s === "pending_init" || s === "streaming") return styles.pillRun;
  if (s === "completed" || s === "done" || s === "steered") return styles.pillOk;
  if (s === "error" || s === "aborted" || s === "stopped" || s === "shutdown") return styles.pillErr;
  return styles.pillWarn;
}

function roleLabel(role: AgentThreadRole): string {
  if (role === "user") return "kullanıcı";
  if (role === "assistant") return "asistan";
  return "araç";
}

function roleClass(role: AgentThreadRole): string {
  if (role === "user") return styles.roleUser;
  if (role === "assistant") return styles.roleAssistant;
  return styles.roleTool;
}

function formatActivityTime(time: number): string {
  if (!time) return "";
  try {
    return new Date(time).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function openWorkspaceFile(path: string) {
  const cleaned = String(path || "").trim();
  if (!cleaned) return;
  window.dispatchEvent(new CustomEvent("quake:open-tool-file", { detail: { path: cleaned } }));
}

export function AgentsPanel() {
  const tools = useAppStore((s) => s.tools);
  const messages = useAppStore((s) => s.messages);
  const showToast = useAppStore((s) => s.showToast);
  const { confirm } = useConfirmAction();
  const [filter, setFilter] = useState<Filter>("all");
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [mergeConflict, setMergeConflict] = useState<MergeConflictState | null>(null);
  const activityEndRef = useRef<HTMLDivElement | null>(null);
  const activityListRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const agents = useMemo(() => collectWorkspaceSubagents(tools, messages, 40), [tools, messages]);
  const filtered = useMemo(() => {
    if (filter === "active") return agents.filter((a) => isAgentActiveStatus(a.status));
    if (filter === "done") return agents.filter((a) => !isAgentActiveStatus(a.status));
    return agents;
  }, [agents, filter]);

  // Drop selection if agent disappeared from the current list.
  useEffect(() => {
    if (!selectedAgentId) return;
    if (!agents.some((a) => a.id === selectedAgentId)) {
      setSelectedAgentId(null);
    }
  }, [agents, selectedAgentId]);

  // Drop conflict banner if its agent disappears.
  useEffect(() => {
    if (!mergeConflict) return;
    if (!agents.some((a) => a.id === mergeConflict.agentId)) {
      setMergeConflict(null);
    }
  }, [agents, mergeConflict]);

  const selectedAgent = useMemo(
    () => (selectedAgentId ? agents.find((a) => a.id === selectedAgentId) || null : null),
    [agents, selectedAgentId],
  );

  const activity = useMemo(() => {
    if (!selectedAgentId) return [] as AgentActivityLine[];
    return collectAgentActivity(tools, messages, selectedAgentId, 50);
  }, [tools, messages, selectedAgentId]);

  // Auto-scroll when new entries appear (only if user is near bottom).
  useEffect(() => {
    if (!selectedAgentId || !activity.length) return;
    if (!stickToBottomRef.current) return;
    const end = activityEndRef.current;
    if (end) {
      end.scrollIntoView({ block: "end" });
      return;
    }
    const list = activityListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [activity, selectedAgentId]);

  const activeCount = agents.filter((a) => isAgentActiveStatus(a.status)).length;
  const worktreeCount = agents.filter((a) => a.isolation === "worktree" || a.worktreePath || a.worktreeBranch).length;

  async function onCopy(text: string, okMsg: string) {
    const ok = await copyText(text);
    showToast(ok ? okMsg : "Kopyalanamadı", ok ? "success" : "error");
  }

  async function onMergeApply(agent: WorkspaceSubagentSummary) {
    const mergeCmd = mergeCommandForAgent(agent);
    const branch = agent.worktreeBranch?.trim();
    if (!mergeCmd || !branch) {
      showToast("Merge için geçerli branch yok", "error");
      return;
    }

    const accepted = await confirm({
      title: "Merge uygula",
      message: `git merge ${branch} çalıştırılsın mı?`,
      confirmLabel: "Merge uygula",
      variant: "warning",
    });
    if (!accepted) return;

    setMergingId(agent.id);
    try {
      // One-shot via existing terminal API — never force merge.
      const result = await apiPost<{
        exitCode?: number | null;
        stdout?: string;
        stderr?: string;
        timedOut?: boolean;
        error?: string;
        ok?: boolean;
      }>("/api/terminal/run", {
        id: `agents-merge-${agent.id}-${Date.now()}`,
        command: mergeCmd,
        timeoutMs: 60_000,
      });

      if (result?.error || result?.ok === false) {
        setMergeConflict(null);
        showToast(result?.error || "Merge komutu başlatılamadı", "error");
        return;
      }

      const outcome = interpretMergeResult(result);
      if (outcome === "success") {
        setMergeConflict(null);
        showToast(`Merge tamam: ${branch}`, "success");
        return;
      }
      if (outcome === "conflict") {
        const output = mergeConflictOutputText(result);
        const paths = parseMergeConflictPaths(output);
        setMergeConflict({ agentId: agent.id, branch, paths });
        const hint =
          paths[0] ||
          output
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => /conflict|unmerged|birleştirme/i.test(l)) ||
          "çatışma var";
        showToast(`Merge çatışması: ${String(hint).slice(0, 160)}`, "error");
        return;
      }
      setMergeConflict(null);
      const detail =
        (result.stderr || result.stdout || "bilinmeyen hata").trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" · ");
      showToast(`Merge başarısız: ${detail.slice(0, 180) || `exit ${result.exitCode}`}`, "error");
    } catch (error: any) {
      setMergeConflict(null);
      showToast(`Merge çalıştırılamadı: ${error?.message || "bilinmeyen hata"}`, "error");
    } finally {
      setMergingId(null);
    }
  }

  async function onOpenFolder(worktreePath: string) {
    const path = worktreePath.trim();
    if (!path) return;

    try {
      if (desktop?.openPath) {
        const res = await desktop.openPath(path);
        if (res?.ok) {
          showToast("Klasör açıldı", "success");
          return;
        }
      }
      if (desktop?.showItemInFolder) {
        const res = await desktop.showItemInFolder(path);
        if (res?.ok) {
          showToast("Klasörde gösterildi", "success");
          return;
        }
      }
    } catch {
      /* fall through to clipboard fallback */
    }

    const ok = await copyText(path);
    showToast(
      ok ? "yol kopyalandı (klasör açılamadı)" : "Klasör açılamadı ve yol kopyalanamadı",
      ok ? "info" : "error",
    );
  }

  function onSelectAgent(id: string) {
    setSelectedAgentId((prev) => (prev === id ? null : id));
    stickToBottomRef.current = true;
  }

  function onActivityScroll() {
    const el = activityListRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 48;
  }

  function onOpenConflictFile(path: string) {
    openWorkspaceFile(path);
    showToast(`Dosya açılıyor: ${path}`, "info");
  }

  function onOpenFirstConflict() {
    const first = mergeConflict?.paths?.[0];
    if (!first) {
      showToast("Açılacak çatışma dosyası yok", "warning");
      return;
    }
    onOpenConflictFile(first);
  }

  return (
    <div className={styles.panel} data-testid="agents-panel" aria-label="Paralel ajanlar">
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>Paralel ajanlar</h2>
          {agents.length > 0 ? <span className={styles.badge}>{activeCount} aktif · {agents.length} toplam</span> : null}
        </div>
        <p className={styles.desc}>
          Codex tarzı izole worktree ajanları. Bitince branch’i birleştir; ana klasör kirlenmez.
          {worktreeCount > 0 ? ` ${worktreeCount} worktree kaydı.` : ""}
          {" "}Kartı seçince konuşma (thread) paneli açılır.
        </p>
      </header>

      <div className={styles.filters} role="tablist" aria-label="Ajan filtresi">
        {(
          [
            ["all", "Tümü"],
            ["active", "Aktif"],
            ["done", "Biten"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={styles.filterBtn}
            data-active={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {mergeConflict ? (
        <section
          className={styles.conflictBanner}
          data-testid="agents-merge-conflict"
          aria-label="Merge çatışması"
        >
          <div className={styles.conflictHead}>
            <strong>Merge çatışması</strong>
            <span className={styles.mono}>{mergeConflict.branch}</span>
            <button
              type="button"
              className={styles.activityClose}
              data-testid="agents-merge-conflict-dismiss"
              onClick={() => setMergeConflict(null)}
              aria-label="Çatışma panelini kapat"
            >
              Kapat
            </button>
          </div>
          {mergeConflict.paths.length > 0 ? (
            <ul className={styles.conflictList} data-testid="agents-merge-conflict-list">
              {mergeConflict.paths.map((path) => (
                <li key={path} className={styles.conflictItem}>
                  <button
                    type="button"
                    className={styles.conflictPathBtn}
                    data-testid="agents-merge-conflict-path"
                    title={path}
                    onClick={() => onOpenConflictFile(path)}
                  >
                    <span className={styles.mono}>{path}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.conflictEmpty} data-testid="agents-merge-conflict-empty">
              Çatışma yolu çıktıda bulunamadı. Diff komutu ile unmerged dosyaları listeleyin.
            </p>
          )}
          <div className={styles.conflictActions}>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionPrimary}`}
              data-testid="agents-merge-open-files"
              disabled={mergeConflict.paths.length === 0}
              onClick={onOpenFirstConflict}
              title={mergeConflict.paths[0] || "Çatışma dosyası yok"}
            >
              Dosyalarda aç
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              data-testid="agents-merge-diff-copy"
              onClick={() => void onCopy(MERGE_CONFLICT_DIFF_CMD, "Diff komutu kopyalandı")}
              title={MERGE_CONFLICT_DIFF_CMD}
            >
              Diff komutu kopyala
            </button>
          </div>
        </section>
      ) : null}

      <div className={styles.body}>
        <div className={styles.list} data-testid="agents-list">
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              <strong>Henüz paralel ajan yok</strong>
              Sohbette “iki worker’ı worktree’de paralel çalıştır…” deyin.
              Bitince burada <em>Merge uygula</em> veya <em>Merge kopyala</em> ile branch’i birleştirin;
              worktree klasörünü <em>Klasörde aç</em> ile gösterebilirsiniz.
              Ayarlar → İzinler → worktree izolasyonu açık olmalı (varsayılan).
            </div>
          ) : (
            filtered.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                selected={selectedAgentId === agent.id}
                merging={mergingId === agent.id}
                hasConflict={mergeConflict?.agentId === agent.id}
                onSelect={() => onSelectAgent(agent.id)}
                onCopy={onCopy}
                onMergeApply={() => void onMergeApply(agent)}
                onOpenFolder={(p) => void onOpenFolder(p)}
              />
            ))
          )}
        </div>

        {selectedAgentId ? (
          <section
            className={styles.activityPane}
            data-testid="agents-activity-pane"
            data-thread="true"
            aria-label="Ajan konuşması"
          >
            <div className={styles.activityHead}>
              <div className={styles.activityTitleRow}>
                <h3 className={styles.activityTitle}>
                  <span className={styles.threadLabel} data-testid="agents-thread-label">
                    Konuşma
                  </span>
                  {selectedAgent ? (
                    <span className={styles.activityAgentName}>{selectedAgent.name}</span>
                  ) : null}
                </h3>
                <button
                  type="button"
                  className={styles.activityClose}
                  data-testid="agents-activity-close"
                  onClick={() => setSelectedAgentId(null)}
                  aria-label="Konuşma panelini kapat"
                >
                  Kapat
                </button>
              </div>
              <div className={styles.activityMeta}>
                <span className={styles.mono}>{selectedAgentId}</span>
                <span>{activity.length} satır · kullanıcı / asistan / araç</span>
              </div>
            </div>

            <div
              className={styles.activityList}
              data-testid="agents-activity-list"
              data-thread-list="true"
              ref={activityListRef}
              onScroll={onActivityScroll}
            >
              {activity.length === 0 ? (
                <div className={styles.activityEmpty} data-testid="agents-activity-empty">
                  Bu ajan için henüz konuşma yok
                </div>
              ) : (
                activity.map((line) => (
                  <div
                    key={line.id}
                    className={`${styles.activityLine} ${roleClass(line.role)}`}
                    data-testid="agents-activity-line"
                    data-role={line.role}
                    data-status={line.status || ""}
                  >
                    <span className={styles.activityTime}>{formatActivityTime(line.time)}</span>
                    <span className={styles.activityRole} data-testid="agents-thread-role">
                      {roleLabel(line.role)}
                    </span>
                    {line.toolName ? (
                      <span className={styles.activityTool}>{line.toolName}</span>
                    ) : (
                      <span className={styles.activityToolMuted}>—</span>
                    )}
                    {line.status ? (
                      <span className={`${styles.pill} ${statusPillClass(line.status)} ${styles.activityStatus}`}>
                        {line.status}
                      </span>
                    ) : (
                      <span className={styles.activityStatusSpacer} />
                    )}
                    <span className={styles.activityText}>{line.text}</span>
                  </div>
                ))
              )}
              <div ref={activityEndRef} data-testid="agents-activity-end" />
            </div>
          </section>
        ) : null}
      </div>

      <footer className={styles.footer}>
        Worktree izolasyonu: Ayarlar → İzinler. Merge örneği:{" "}
        <span className={styles.mono}>git merge quake-agent-…</span>
        {" · "}Force merge yok.
      </footer>
    </div>
  );
}

function AgentCard({
  agent,
  selected,
  merging,
  hasConflict,
  onSelect,
  onCopy,
  onMergeApply,
  onOpenFolder,
}: {
  agent: WorkspaceSubagentSummary;
  selected: boolean;
  merging: boolean;
  hasConflict: boolean;
  onSelect: () => void;
  onCopy: (text: string, okMsg: string) => void | Promise<void>;
  onMergeApply: () => void;
  onOpenFolder: (path: string) => void;
}) {
  const mergeCmd = mergeCommandForAgent(agent);
  const isolated = agent.isolation === "worktree" || Boolean(agent.worktreePath) || Boolean(agent.worktreeBranch);
  const statusLabel = workspaceAgentStatusLabel(agent.status);

  return (
    <article
      className={styles.card}
      data-status={agent.status}
      data-isolation={agent.isolation || ""}
      data-selected={selected ? "true" : "false"}
      data-conflict={hasConflict ? "true" : "false"}
      data-testid="agents-card"
      data-agent-id={agent.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className={styles.cardTop}>
        <div>
          <div className={styles.cardName}>{agent.name}</div>
          <div className={styles.cardMeta}>
            <span className={`${styles.pill} ${statusPillClass(agent.status)}`}>{statusLabel}</span>
            {isolated ? <span className={`${styles.pill} ${styles.pillOk}`}>worktree</span> : <span className={styles.pill}>paylaşılan</span>}
            {selected ? <span className={`${styles.pill} ${styles.pillRun}`}>seçili</span> : null}
            {hasConflict ? <span className={`${styles.pill} ${styles.pillErr}`}>çatışma</span> : null}
          </div>
        </div>
      </div>

      {agent.description ? <div className={styles.cardBody}>{agent.description}</div> : null}

      {agent.worktreeBranch ? (
        <div className={styles.cardBody}>
          Branch: <span className={styles.mono}>{agent.worktreeBranch}</span>
        </div>
      ) : null}

      {agent.worktreePath ? (
        <div className={styles.cardBody}>
          Yol: <span className={styles.mono}>{agent.worktreePath}</span>
        </div>
      ) : null}

      {agent.resultPreview ? (
        <div className={styles.cardBody}>{agent.resultPreview}</div>
      ) : null}

      <div className={styles.actions} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        {mergeCmd ? (
          <>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionPrimary}`}
              data-testid="agents-merge-apply"
              disabled={merging}
              onClick={onMergeApply}
              title={mergeCmd}
            >
              {merging ? "Merge…" : "Merge uygula"}
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              data-testid="agents-merge-copy"
              onClick={() => void onCopy(mergeCmd, "Merge komutu kopyalandı")}
            >
              Merge kopyala
            </button>
          </>
        ) : null}
        {agent.worktreeBranch ? (
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => void onCopy(agent.worktreeBranch!, "Branch adı kopyalandı")}
          >
            Branch kopyala
          </button>
        ) : null}
        {agent.worktreePath ? (
          <>
            <button
              type="button"
              className={styles.actionBtn}
              data-testid="agents-open-folder"
              onClick={() => onOpenFolder(agent.worktreePath!)}
              title={agent.worktreePath}
            >
              Klasörde aç
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => void onCopy(agent.worktreePath!, "Worktree yolu kopyalandı")}
            >
              Yol kopyala
            </button>
          </>
        ) : null}
        <button
          type="button"
          className={styles.actionBtn}
          onClick={() => void onCopy(agent.id, "Ajan id kopyalandı")}
          title={agent.id}
        >
          Id kopyala
        </button>
      </div>
    </article>
  );
}
