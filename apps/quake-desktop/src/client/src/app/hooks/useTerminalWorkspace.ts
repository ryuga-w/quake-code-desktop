import { useEffect, useRef, useState } from "react";
import { apiPost } from "../../lib/api";
import { readStorageArray, writeStorageJson } from "../../lib/storage";
import { appendTerminalOutput, terminalTranscript } from "../../lib/terminal-output";
import type { ToastState } from "../../state/app-store";
import type { TerminalTabState } from "../../components/terminal/terminal-utils";

export type TerminalWorkspaceOptions = {
  showToast: (
    message: string,
    type?: ToastState["type"],
    options?: Pick<ToastState, "actionLabel" | "action">,
  ) => string;
  openTerminalPanel: () => void;
};

function createInitialTerminalTab(): TerminalTabState {
  return {
    id: "terminal-1",
    name: "Terminal 1",
    command: "",
    output: "Komut çıktısı burada görünecek",
    status: "idle",
  };
}

/** Owns legacy terminal run state consumed by SSE and terminal actions. */
export function useTerminalWorkspace({ showToast, openTerminalPanel }: TerminalWorkspaceOptions) {
  const [terminalText, setTerminalText] = useState("");
  const [terminalTabs, setTerminalTabs] = useState<TerminalTabState[]>(() => [createInitialTerminalTab()]);
  const [activeTerminalId, setActiveTerminalId] = useState("terminal-1");
  const [terminalHistory, setTerminalHistory] = useState<string[]>(
    () => readStorageArray<string>("quake-web:terminalHistory"),
  );
  const terminalRuns = useRef(new Map<string, { command: string; output: string }>()).current;
  const terminalTabsRef = useRef<TerminalTabState[]>(terminalTabs);

  useEffect(() => {
    terminalTabsRef.current = terminalTabs;
  }, [terminalTabs]);

  async function runTerminal(commandOverride?: string, tabId = activeTerminalId) {
    const command = (commandOverride ?? terminalText).trim();
    if (!command) return;
    const id = tabId || `terminal-${Date.now()}`;
    openTerminalPanel();
    const nextHistory = [command, ...terminalHistory.filter((entry) => entry !== command)].slice(0, 40);
    setTerminalHistory(nextHistory);
    writeStorageJson("quake-web:terminalHistory", nextHistory);
    setTerminalTabs((tabs) => tabs.map((tab) => tab.id === id
      ? {
          ...tab,
          command,
          output: terminalTranscript(command, "Çalışıyor…"),
          status: "running",
          exitCode: undefined,
          durationMs: undefined,
        }
      : tab));
    try {
      const result = await apiPost<any>("/api/terminal/run", { id, command });
      if (result?.error || result?.ok === false) {
        const reason = result?.error || "komut başlatılamadı";
        const output = terminalTranscript(command, `engellendi · ${reason}`);
        setTerminalTabs((tabs) => tabs.map((tab) => tab.id === id ? { ...tab, output, status: "error" } : tab));
      }
    } catch (error: any) {
      const output = terminalTranscript(command, `başlatılamadı · ${error?.message || "bilinmeyen hata"}`);
      setTerminalTabs((tabs) => tabs.map((tab) => tab.id === id ? { ...tab, output, status: "error" } : tab));
      showToast(`Terminal başlatılamadı: ${error?.message || "bilinmeyen hata"}`, "error");
    }
  }

  function newTerminalTab() {
    const id = `terminal-${Date.now()}`;
    setTerminalTabs((tabs) => [
      ...tabs,
      {
        id,
        name: `Terminal ${tabs.length + 1}`,
        command: "",
        output: "Komut çıktısı burada görünecek",
        status: "idle",
      },
    ]);
    setActiveTerminalId(id);
  }

  async function stopTerminal(tabId = activeTerminalId) {
    await apiPost("/api/terminal/stop", { id: tabId })
      .catch((error) => showToast(`Durdurma başarısız: ${error.message}`, "error"));
    setTerminalTabs((tabs) => tabs.map((tab) => tab.id === tabId
      ? { ...tab, status: "stopped", output: appendTerminalOutput(tab.output, "\n\nDurdurma istendi") }
      : tab));
  }

  function closeTerminalTab(tabId: string) {
    setTerminalTabs((tabs) => {
      const next = tabs.length > 1 ? tabs.filter((tab) => tab.id !== tabId) : tabs;
      if (activeTerminalId === tabId) setActiveTerminalId(next[0]?.id || "terminal-1");
      return next;
    });
  }

  return {
    terminalText,
    terminalTabs,
    activeTerminalId,
    terminalHistory,
    terminalRuns,
    terminalTabsRef,
    setTerminalText,
    setTerminalTabs,
    setActiveTerminalId,
    runTerminal,
    newTerminalTab,
    stopTerminal,
    closeTerminalTab,
  };
}

export type UseTerminalWorkspaceReturn = ReturnType<typeof useTerminalWorkspace>;
