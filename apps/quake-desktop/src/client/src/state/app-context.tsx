import React, { createContext, useContext, type ReactNode } from "react";
import { useAppStore, type ToolCardState, type ToastState } from "./app-store";

interface AppConfig {
  host: string;
  port: number;
  cwd: string;
  workspaceRoots: string[];
  authEnabled: boolean;
  terminalEnabled: boolean;
  maxFilePreviewBytes: number;
  workspaceAllowlist: string[];
}

interface AppContextValue {
  config: AppConfig;
  cwd: string;
  workspaceName: string;
  isStreaming: boolean;
  currentModel: string;
  currentThinking: string;
  showToast: (message: string, type?: ToastState["type"]) => string;
  sendCommand: (command: any) => Promise<any>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}

export function AppProvider({ children, config, cwd }: { children: ReactNode; config: AppConfig; cwd: string }) {
  const store = useAppStore();
  const state = store.state;
  const models = store.models;
  const currentModel = models.find((m: any) => m.current) || state?.model;
  const currentModelValue = currentModel ? `${currentModel.provider}/${currentModel.id}` : "";
  const currentThinking = String(state?.thinkingLevel || "medium");
  const workspaceName = cwd.split(/[\\/]/).filter(Boolean).pop() || "Çalışma alanı";

  const value: AppContextValue = {
    config,
    cwd,
    workspaceName,
    isStreaming: Boolean(state?.isStreaming),
    currentModel: currentModelValue,
    currentThinking,
    showToast: store.showToast,
    sendCommand: async (command: any) => {
      const { apiPost } = await import("../lib/api");
      return apiPost("/api/command", command);
    },
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
