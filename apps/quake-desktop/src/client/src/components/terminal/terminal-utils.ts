export type TerminalTabState = { id: string; name: string; command: string; output: string; status: "idle" | "running" | "done" | "error" | "stopped"; exitCode?: number | null; durationMs?: number; scrollLock?: boolean };

export function ensureTerminalTab(tabs: TerminalTabState[], id: string, command: string): TerminalTabState[] {
  return tabs.some((tab) => tab.id === id) ? tabs : [...tabs, { id, name: `Terminal ${tabs.length + 1}`, command, output: "", status: "running" }];
}
