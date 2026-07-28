import { utilityProcess, type UtilityProcess } from "electron";

export interface ServerOptions {
  /** Mutlak yol: dist/server/index.js */
  serverEntry: string;
  port: number;
  cwd: string;
  workspaceRoots?: string[];
  host?: string;
  secrets?: Record<string, string>;
  /** Packaged Desktop'a ait agent ayar dizini; global/eski CLI kurulumundan bağımsızdır. */
  agentDir?: string;
  /** Packaged Desktop içindeki derlenmiş client klasörü. */
  publicDir?: string;
}

let child: UtilityProcess | undefined;

/**
 * Arka uç sunucusunu ayrı bir Node sürecinde (utilityProcess) başlatır.
 * Sunucu env'i yalnızca açılışta okuduğu için workspace değişiminde yeniden çağrılır.
 */
export function startServer(opts: ServerOptions): UtilityProcess {
  stopServer();
  child = utilityProcess.fork(opts.serverEntry, [], {
    stdio: "pipe",
    env: {
      ...process.env,
      ...(opts.secrets || {}),
      ...(opts.agentDir ? { QUAKE_CODE_CODING_AGENT_DIR: opts.agentDir } : {}),
      ...(opts.publicDir ? { QUAKE_WEB_PUBLIC_DIR: opts.publicDir } : {}),
      QUAKE_WEB_PORT: String(opts.port),
      QUAKE_WEB_HOST: opts.host ?? "127.0.0.1",
      QUAKE_WEB_CWD: opts.cwd,
      QUAKE_WEB_WORKSPACE_ROOTS_JSON: JSON.stringify(opts.workspaceRoots || [opts.cwd]),
      QUAKE_BROWSER_EMBEDDED: process.env.QUAKE_BROWSER_EMBEDDED || "1",
      QUAKE_BROWSER_BRIDGE_PORT: process.env.QUAKE_BROWSER_BRIDGE_PORT || "9223",
      QUAKE_CDP_PORT: process.env.QUAKE_CDP_PORT || "9222",
      QUAKE_COMPUTER_USE_BRIDGE_PORT: process.env.QUAKE_COMPUTER_USE_BRIDGE_PORT || "9224",
    },
  });
  child.stdout?.on("data", (d: Buffer) => process.stdout.write(`[server] ${d}`));
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[server] ${d}`));
  return child;
}

export function stopServer(): void {
  if (child) {
    try {
      child.kill();
    } catch {
      /* zaten ölmüş olabilir */
    }
    child = undefined;
  }
}

export function getServer(): UtilityProcess | undefined {
  return child;
}
