import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronRight, FolderCode, ListTree, MousePointer2, PanelBottom, PanelRight, Plus } from "lucide-react";
import type { WebSubagentSummary } from "../../../../shared/protocol";
import { apiGet } from "../../lib/api";
import { type Translate, useI18n } from "../../i18n";
import { readStorageValue, writeStorageValue } from "../../lib/storage";
import { useAppStore } from "../../state/app-store";
import { selectActiveBrowserAddress } from "../../lib/tool-activity";
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
  onToggleTerminal,
  terminalOpen,
  onOpenFiles,
  onOpenBrowser,
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
  onToggleTerminal: () => void;
  terminalOpen: boolean;
  onOpenFiles: () => void;
  onOpenBrowser: () => void;
  onOpenPlan: () => void;
  onOpenAgents?: () => void;
  onOpenSubagent?: (agentId: string) => void;
}) {
  const { t } = useI18n();
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
      <button type="button" className={summaryOpen ? "active" : ""} onClick={() => setSummaryVisibility(!summaryOpen)} title={t("workspace.controls.toggleOutputs")} aria-label={t("workspace.controls.toggleOutputs")} aria-pressed={summaryOpen}><ListTree size={14} /></button>
      <button type="button" className={terminalOpen ? "active" : ""} onClick={onToggleTerminal} title={t("workspace.controls.toggleTerminal")} aria-label={t("workspace.controls.toggleTerminal")} aria-pressed={terminalOpen}><PanelBottom size={15} /></button>
      <button type="button" className={rightOpen ? "active" : ""} onClick={onToggleRight} title={t("workspace.controls.toggleRightPanel")} aria-label={t("workspace.controls.toggleRightPanel")} aria-pressed={rightOpen}><PanelRight size={15} /></button>
    </div>
    {summaryOpen && <WorkspaceContextCard
      workspaceName={workspaceName}
      workspacePath={workspacePath}
      plan={plan}
      subagents={subagents}
      subagentStatus={subagentStatus}
      onOpenFiles={onOpenFiles}
      onOpenBrowser={onOpenBrowser}
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
  onOpenBrowser,
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
  onOpenBrowser?: () => void;
  onOpenPlan: () => void;
  onOpenAgents?: () => void;
  onOpenSubagent?: (agentId: string) => void;
}) {
  const { t } = useI18n();
  const tools = useAppStore((state) => state.tools);
  const messages = useAppStore((state) => state.messages);
  const storeSubagentStatus = useAppStore((state) => state.statuses.subagents);
  const collectedSubagents = useMemo(() => collectWorkspaceSubagents(tools, messages, 12), [messages, tools]);
  const subagents = suppliedSubagents || collectedSubagents;
  const subagentStatus = suppliedSubagentStatus || storeSubagentStatus;
  const browserAddress = useMemo(() => selectActiveBrowserAddress(tools), [tools]);
  const steps = plan?.steps || [];
  const hasPlan = Boolean(plan?.artifact || plan?.enabled || steps.length);

  return <aside className={`workspace-context-card ${hasPlan ? "workspace-context-plan" : ""}`} aria-label={t("workspace.outputs.label")}>
    {hasPlan && <>
      <div className="workspace-context-head">
        <span>{t("workspace.outputs.plan")}</span>
        <button type="button" onClick={onOpenPlan} aria-label={t("workspace.outputs.openPlan")}><Plus aria-hidden="true" /></button>
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
            <b>{workspacePlanStatusLabel(status, t)}</b>
          </button>;
        })}
      </div>
    </>}

    <div className={`workspace-context-head ${hasPlan ? "workspace-context-output-head" : ""}`}>
      <span>{t("workspace.outputs.label")}</span>
      <button type="button" onClick={onOpenFiles} aria-label={t("workspace.outputs.add")}><Plus aria-hidden="true" /></button>
    </div>
    {browserAddress ? (
      <button
        type="button"
        className="workspace-context-row workspace-context-browser"
        title={browserAddress}
        aria-label={`${t("workspace.outputs.browsing")} ${browserAddress}`}
        onClick={onOpenBrowser}
        disabled={!onOpenBrowser}
      >
        <span className="workspace-context-browser-cursor" aria-hidden="true"><MousePointer2 aria-hidden="true" /></span>
        <span className="workspace-context-browser-url">{browserAddress}</span>
        <b><i className="workspace-context-status-dot" /> {t("workspace.outputs.browsing")}</b>
      </button>
    ) : null}
    {subagents.length === 0 ? (
      browserAddress ? null : (
      <button type="button" className="workspace-context-muted" title={workspacePath || workspaceName} onClick={onOpenFiles}>
        {t("workspace.outputs.empty")}
      </button>
      )
    ) : (
      <div className="workspace-context-items">
        <div className="workspace-context-section-label">{t("workspace.outputs.subagents")}</div>
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
              <b>{active ? <><i className="workspace-context-status-dot" /> {t("workspace.agentStatus.running")}</> : workspaceOutputAgentStatusLabel(agent.status, t)}</b>
            </button>
          );
        })}

        <div className="workspace-context-section-label workspace-context-resources-label">
          <span>{t("workspace.outputs.resources")}</span>
          <button type="button" onClick={onOpenFiles} aria-label={t("workspace.outputs.addResource")}><Plus aria-hidden="true" /></button>
        </div>
        <button type="button" className="workspace-context-row workspace-context-resource" onClick={onOpenFiles} title={workspacePath}>
          <span className="workspace-context-icon"><FolderCode aria-hidden="true" /></span>
          <span>{workspaceName || t("workspace.outputs.projectFiles")}</span>
          <b>{t("workspace.outputs.project")}</b>
        </button>
        {onOpenAgents ? (
          <button type="button" className="workspace-context-row workspace-context-view-all" onClick={onOpenAgents}>
            <span className="workspace-context-icon">⌘</span>
            <span>{t("workspace.outputs.viewAll")}</span>
            <ChevronRight aria-hidden="true" />
          </button>
        ) : null}
      </div>
    )}
    {subagentStatus ? <div className="workspace-context-agent-status">{translateSubagentStatus(subagentStatus, t)}</div> : null}
  </aside>;
}

export function workspacePlanStatusLabel(status: string, t: Translate): string {
  if (status === "active") return t("workspace.planStatus.active");
  if (status === "completed") return t("workspace.planStatus.completed");
  if (status === "blocked") return t("workspace.planStatus.blocked");
  return t("workspace.planStatus.pending");
}

export function workspaceOutputAgentStatusLabel(status: string, t: Translate): string {
  const value = status.toLowerCase();
  if (value === "completed" || value === "done" || value === "steered") return t("workspace.agentStatus.completed");
  if (value === "queued" || value === "pending_init") return t("workspace.agentStatus.queued");
  if (value === "error") return t("workspace.agentStatus.error");
  if (value === "aborted" || value === "stopped" || value === "shutdown") return t("workspace.agentStatus.stopped");
  if (value === "interrupted") return t("workspace.agentStatus.interrupted");
  return t("workspace.agentStatus.running");
}

export function translateSubagentStatus(value: string, t: Translate): string {
  return value
    .replace(/running/gi, t("workspace.agentStatus.running"))
    .replace(/queued/gi, t("workspace.agentStatus.queued"))
    .replace(/agents?/gi, t("workspace.agentStatus.subagent"));
}
