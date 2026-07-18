import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronRight, FolderCode, ListTree, PanelRight, Plus } from "lucide-react";
import type { WebSubagentSummary } from "../../../../shared/protocol";
import { apiGet } from "../../lib/api";
import { readStorageValue, writeStorageValue } from "../../lib/storage";
import { useAppStore } from "../../state/app-store";
import {
  collectWorkspaceSubagents,
  isAgentActiveStatus,
  type WorkspaceSubagentSummary,
} from "../agents/collect-subagents";

export function WorkspaceChrome({
  rightOpen,
  sessionId,
  workspaceName,
  workspacePath,
  plan,
  onToggleRight,
  onOpenFiles,
  onOpenBrowser: _onOpenBrowser,
  onOpenPlan,
  onOpenAgents,
  onOpenSubagent,
}: {
  rightOpen: boolean;
  sessionId?: string;
  workspaceName: string;
  workspacePath: string;
  plan?: import("../../../../shared/protocol").WebPlanState;
  onToggleRight: () => void;
  onOpenFiles: () => void;
  onOpenBrowser: () => void;
  onOpenPlan: () => void;
  onOpenAgents?: () => void;
  onOpenSubagent?: (agentId: string) => void;
}) {
  const tools = useAppStore((state) => state.tools);
  const messages = useAppStore((state) => state.messages);
  const subagentStatus = useAppStore((state) => state.statuses.subagents);
  const collectedSubagents = useMemo(() => collectWorkspaceSubagents(tools, messages, 12), [messages, tools]);
  const [runtimeSubagents, setRuntimeSubagents] = useState<WorkspaceSubagentSummary[]>([]);
  const subagents = runtimeSubagents.length ? runtimeSubagents : collectedSubagents;
  const [summaryOpen, setSummaryOpen] = useState(() => readStorageValue("quake-web:workspaceSummaryOpen", "1") !== "0");
  const knownAgentIdsRef = useRef<Set<string> | null>(null);

  const setSummaryVisibility = (open: boolean) => {
    setSummaryOpen(open);
    writeStorageValue("quake-web:workspaceSummaryOpen", open ? "1" : "0");
  };

  useEffect(() => {
    knownAgentIdsRef.current = null;
    setRuntimeSubagents([]);
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
        const response = await apiGet<{ agents: WebSubagentSummary[]; available: boolean }>(`/api/subagents${query}`);
        if (cancelled) return;
        setRuntimeSubagents(response.available === false ? [] : (response.agents || []).map((agent) => ({
          id: agent.id,
          name: agent.name,
          status: agent.status,
          time: agent.completedAt || agent.startedAt || agent.createdAt,
          isolation: agent.isolation,
          worktreePath: agent.worktreePath,
          worktreeBranch: agent.worktreeBranch,
          description: agent.description,
          resultPreview: agent.resultPreview,
        })));
        const active = response.agents?.some((agent) => isAgentActiveStatus(agent.status));
        timer = window.setTimeout(refresh, active ? 650 : 1_800);
      } catch {
        if (cancelled) return;
        timer = window.setTimeout(refresh, 2_500);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [sessionId]);

  useEffect(() => {
    const currentIds = new Set(subagents.map((agent) => agent.id));
    const previousIds = knownAgentIdsRef.current;
    knownAgentIdsRef.current = currentIds;
    if (!previousIds) return;
    if (subagents.some((agent) => !previousIds.has(agent.id))) setSummaryVisibility(true);
  }, [subagents]);

  return <div className="workspace-chrome">
    <div className="workspace-chrome-controls">
      <button type="button" className="workspace-control-project" onClick={onOpenFiles} title={workspacePath} aria-label="Çalışma alanını aç"><span>▣</span><span>⌄</span></button>
      <button type="button" className={summaryOpen ? "active" : ""} onClick={() => setSummaryVisibility(!summaryOpen)} title="Çıktıları aç/kapat" aria-label="Çıktıları aç/kapat" aria-pressed={summaryOpen}><ListTree size={14} /></button>
      <button type="button" className={rightOpen ? "active" : ""} onClick={onToggleRight} title="Yan paneli aç/kapat" aria-label="Yan paneli aç/kapat" aria-pressed={rightOpen}><PanelRight size={15} /></button>
    </div>
    {summaryOpen && <WorkspaceContextCard
      workspaceName={workspaceName}
      workspacePath={workspacePath}
      plan={plan}
      subagents={subagents}
      subagentStatus={subagentStatus}
      onOpenFiles={onOpenFiles}
      onOpenPlan={onOpenPlan}
      onOpenAgents={onOpenAgents}
      onOpenSubagent={onOpenSubagent}
    />}
  </div>;
}

export function WorkspaceContextCard({
  workspaceName,
  workspacePath,
  plan,
  subagents: suppliedSubagents,
  subagentStatus: suppliedSubagentStatus,
  onOpenFiles,
  onOpenPlan,
  onOpenAgents,
  onOpenSubagent,
}: {
  workspaceName: string;
  workspacePath: string;
  plan?: import("../../../../shared/protocol").WebPlanState;
  subagents?: WorkspaceSubagentSummary[];
  subagentStatus?: string;
  onOpenFiles: () => void;
  onOpenPlan: () => void;
  onOpenAgents?: () => void;
  onOpenSubagent?: (agentId: string) => void;
}) {
  const tools = useAppStore((state) => state.tools);
  const messages = useAppStore((state) => state.messages);
  const storeSubagentStatus = useAppStore((state) => state.statuses.subagents);
  const collectedSubagents = useMemo(() => collectWorkspaceSubagents(tools, messages, 12), [messages, tools]);
  const subagents = suppliedSubagents || collectedSubagents;
  const subagentStatus = suppliedSubagentStatus || storeSubagentStatus;
  const steps = plan?.steps || [];
  const hasPlan = Boolean(plan?.artifact || plan?.enabled || steps.length);

  return <aside className={`workspace-context-card ${hasPlan ? "workspace-context-plan" : ""}`} aria-label="Çıktılar">
    {hasPlan && <>
      <div className="workspace-context-head">
        <span>Plan</span>
        <button type="button" onClick={onOpenPlan} aria-label="Planı aç"><Plus aria-hidden="true" /></button>
      </div>
      {plan?.artifact && (
        <button type="button" className="workspace-context-row workspace-context-title" onClick={onOpenPlan} title={plan.artifact.title}>
          <span className="workspace-context-icon">☷</span>
          <span>{plan.artifact.title}</span>
          <ChevronRight aria-hidden="true" />
        </button>
      )}
      <div className="workspace-context-plan-items">
        {steps.map((step) => {
          const status = step.completed ? "completed" : step.status === "active" ? "active" : step.status === "blocked" ? "blocked" : "pending";
          return <button type="button" className="workspace-context-row workspace-context-plan-step" data-status={status} onClick={onOpenPlan} key={`${step.step}:${step.text}`} title={step.fullText || step.text}>
            <span className="workspace-context-icon">
              {status === "active" ? <i className="workspace-context-spinner" aria-hidden="true" /> : status === "completed" ? "✓" : status === "blocked" ? "!" : step.step}
            </span>
            <span>{step.fullText || step.text}</span>
            <b>{workspacePlanStatusLabel(status)}</b>
          </button>;
        })}
      </div>
    </>}

    <div className={`workspace-context-head ${hasPlan ? "workspace-context-output-head" : ""}`}>
      <span>Çıktılar</span>
      <button type="button" onClick={onOpenFiles} aria-label="Yeni çıktı ekle"><Plus aria-hidden="true" /></button>
    </div>
    {subagents.length === 0 ? (
      <button type="button" className="workspace-context-muted" title={workspacePath || workspaceName} onClick={onOpenFiles}>
        Dosya veya site oluştur
      </button>
    ) : (
      <div className="workspace-context-items">
        <div className="workspace-context-section-label">Alt otonom ajanlar</div>
        {subagents.map((agent, index) => {
          const active = isAgentActiveStatus(agent.status);
          return (
            <button
              type="button"
              className="workspace-context-row workspace-context-agent"
              data-status={agent.status}
              data-active={active ? "true" : undefined}
              data-agent-accent={index % 4}
              key={agent.id}
              title={`${agent.name} · ${agent.description || agent.id}`}
              onClick={() => onOpenSubagent?.(agent.id)}
            >
              <span className="workspace-context-agent-icon"><Bot aria-hidden="true" /></span>
              <span>{agent.name}</span>
              <b>{active ? <><i className="workspace-context-status-dot" /> çalışıyor</> : workspaceOutputAgentStatusLabel(agent.status)}</b>
            </button>
          );
        })}

        <div className="workspace-context-section-label workspace-context-resources-label">
          <span>Kaynaklar</span>
          <button type="button" onClick={onOpenFiles} aria-label="Kaynak ekle"><Plus aria-hidden="true" /></button>
        </div>
        <button type="button" className="workspace-context-row workspace-context-resource" onClick={onOpenFiles} title={workspacePath}>
          <span className="workspace-context-icon"><FolderCode aria-hidden="true" /></span>
          <span>{workspaceName || "Proje dosyaları"}</span>
          <b>proje</b>
        </button>
        {onOpenAgents ? (
          <button type="button" className="workspace-context-row workspace-context-view-all" onClick={onOpenAgents}>
            <span className="workspace-context-icon">⌘</span>
            <span>Tümünü görüntüle</span>
            <ChevronRight aria-hidden="true" />
          </button>
        ) : null}
      </div>
    )}
    {subagentStatus ? <div className="workspace-context-agent-status">{translateSubagentStatus(subagentStatus)}</div> : null}
  </aside>;
}

export function workspacePlanStatusLabel(status: string): string {
  if (status === "active") return "aktif";
  if (status === "completed") return "bitti";
  if (status === "blocked") return "engelli";
  return "bekliyor";
}

export function workspaceOutputAgentStatusLabel(status: string): string {
  const value = status.toLowerCase();
  if (value === "completed" || value === "done" || value === "steered") return "tamamlandı";
  if (value === "queued" || value === "pending_init") return "sırada";
  if (value === "error") return "hata";
  if (value === "aborted" || value === "stopped" || value === "shutdown") return "durduruldu";
  if (value === "interrupted") return "kesildi";
  return "çalışıyor";
}

export function translateSubagentStatus(value: string): string {
  return value
    .replace(/running/gi, "çalışıyor")
    .replace(/queued/gi, "sırada")
    .replace(/agents?/gi, "subagent");
}
