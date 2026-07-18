import { readStorageRecord, writeStorageJson } from "./storage";

export type SessionProject = {
  cwd: string;
  name: string;
  sessions: Array<{ path: string; id?: string; name?: string; firstMessage?: string; modified?: number; messageCount?: number; cwd?: string; parentSessionPath?: string }>;
};

export function projectNameFromCwd(cwd: string): string {
  if (!cwd) return "Bilinmeyen proje";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

export const LAST_SESSION_BY_WORKSPACE_KEY = "quake-web:lastSessionByWorkspace";

export function normalizeWorkspacePathKey(path: string): string {
  return String(path || "").replace(/[\\/]+$/, "").toLowerCase();
}

export function readLastSessionByWorkspace(): Record<string, string> {
  return readStorageRecord<string>(LAST_SESSION_BY_WORKSPACE_KEY);
}

export function getLastSessionForWorkspace(cwd: string): string | undefined {
  const key = normalizeWorkspacePathKey(cwd);
  if (!key) return undefined;
  const value = readLastSessionByWorkspace()[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function persistLastSessionForWorkspace(cwd: string, sessionPath: string): void {
  const key = normalizeWorkspacePathKey(cwd);
  const path = String(sessionPath || "").trim();
  if (!key || !path) return;
  const next = { ...readLastSessionByWorkspace(), [key]: path };
  writeStorageJson(LAST_SESSION_BY_WORKSPACE_KEY, next);
}

/** Windows system / scratch / boş cwd — sidebar proje listesine girmez. */
export function isValidProjectCwd(cwd: string): boolean {
  const raw = String(cwd || "").trim();
  if (!raw) return false;
  const lower = raw.replace(/\//g, "\\").toLowerCase();
  if (lower.includes("\\no-project") || lower.endsWith("\\no-project")) return false;
  if (lower.includes(".quake-code\\no-project")) return false;
  // Sistem dizinleri (yanlışlıkla cwd olmuş sohbetler)
  if (/\\windows(\\system32)?$/i.test(lower) || lower.includes("\\windows\\system32")) return false;
  if (lower === "c:\\" || lower === "c:") return false;
  if (/\\(system32|syswow64|winsxs)$/i.test(lower)) return false;
  return true;
}

export function groupSessionsByWorkspace(sessions: any[], activeCwd?: string): SessionProject[] {
  const groups = new Map<string, SessionProject>();
  for (const session of sessions || []) {
    const cwd = String(session?.cwd || "").trim();
    if (!isValidProjectCwd(cwd)) continue;
    const key = cwd.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { cwd, name: projectNameFromCwd(cwd), sessions: [] };
      groups.set(key, group);
    }
    group.sessions.push(session);
  }
  const list = [...groups.values()];
  const activeKey = (activeCwd || "").toLowerCase();
  // En son aktiviteye göre sırala (aktif proje en üstte)
  list.sort((a, b) => {
    if (a.cwd.toLowerCase() === activeKey) return -1;
    if (b.cwd.toLowerCase() === activeKey) return 1;
    const ta = Math.max(0, ...a.sessions.map((s) => (typeof s.modified === "number" ? s.modified : Date.parse(String(s.modified || 0)) || 0)));
    const tb = Math.max(0, ...b.sessions.map((s) => (typeof s.modified === "number" ? s.modified : Date.parse(String(s.modified || 0)) || 0)));
    return tb - ta;
  });
  // Sidebar şişmesin: aktif + en güncel N proje
  const MAX_SIDEBAR_PROJECTS = 10;
  if (list.length <= MAX_SIDEBAR_PROJECTS) return list;
  const active = list.find((p) => p.cwd.toLowerCase() === activeKey);
  const rest = list.filter((p) => p.cwd.toLowerCase() !== activeKey).slice(0, MAX_SIDEBAR_PROJECTS - (active ? 1 : 0));
  return active ? [active, ...rest] : rest;
}
