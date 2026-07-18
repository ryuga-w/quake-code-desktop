import { existsSync, realpathSync } from "node:fs";
import { delimiter, resolve } from "node:path";

export interface WebSecurityConfig {
  host: string;
  cwd: string;
  allowRemoteAccess: boolean;
  workspaceAllowlist: string[];
}

export function parseWorkspaceAllowlist(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(entry));
}

export function isRemoteHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]" || host === "";
}

export function validateWebSecurity(config: WebSecurityConfig): void {
  if (isRemoteHost(config.host) && !config.allowRemoteAccess) {
    throw new Error(
      `Quake Code ${config.host} adresine bağlanmayı reddetti. QUAKE_WEB_ALLOW_REMOTE=1 değerini yalnızca kimlik, çalışma alanı ve komut politikası hazırlandıktan sonra aç.`,
    );
  }

  if (!config.workspaceAllowlist.length) return;

  const cwd = safeRealpath(config.cwd);
  const allowed = config.workspaceAllowlist.some((entry) => {
    const root = safeRealpath(entry);
    return cwd === root || cwd.startsWith(`${root}\\`) || cwd.startsWith(`${root}/`);
  });
  if (!allowed) {
    throw new Error(`Çalışma alanı Quake Code izinli köklerinde değil: ${config.cwd}`);
  }
}

function safeRealpath(path: string): string {
  const resolved = resolve(path);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}
