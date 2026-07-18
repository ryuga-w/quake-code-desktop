import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";

export class WebAuth {
  readonly enabled: boolean;
  readonly token: string;

  constructor(cwd = process.cwd()) {
    this.enabled = process.env.QUAKE_WEB_AUTH !== "0";
    this.token = process.env.QUAKE_WEB_TOKEN || this.loadOrCreateToken(cwd);
  }

  isAuthorized(req: IncomingMessage, url: URL): boolean {
    if (!this.enabled) return true;
    const provided = req.headers["x-quake-web-token"] || this.websocketProtocolToken(req) || url.searchParams.get("token") || "";
    const value = Array.isArray(provided) ? provided[0] : provided;
    return this.safeEqual(value, this.token);
  }

  reject(res: ServerResponse): void {
    const text = JSON.stringify({ error: "Yetkisiz istek" });
    res.writeHead(401, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(text),
    });
    res.end(text);
  }

  injectClientToken(html: Uint8Array): Buffer {
    if (!this.enabled) return Buffer.from(html);
    const script = `<script>window.__QUAKE_WEB_TOKEN__=${JSON.stringify(this.token)}</script>`;
    return Buffer.from(Buffer.from(html).toString("utf8").replace("</head>", `${script}\n  </head>`));
  }

  private loadOrCreateToken(cwd: string): string {
    const tokenPath = process.env.QUAKE_WEB_TOKEN_FILE || join(cwd, ".quake-code", "web-token");
    if (existsSync(tokenPath)) {
      const token = readFileSync(tokenPath, "utf8").trim();
      if (token) return token;
    }
    const token = randomBytes(24).toString("base64url");
    mkdirSync(dirname(tokenPath), { recursive: true });
    writeFileSync(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
    return token;
  }

  private websocketProtocolToken(req: IncomingMessage): string {
    const raw = req.headers["sec-websocket-protocol"];
    const protocols = (Array.isArray(raw) ? raw.join(",") : raw || "").split(",").map((value) => value.trim());
    const encoded = protocols.find((value) => value.startsWith("quake-auth."))?.slice("quake-auth.".length);
    if (!encoded) return "";
    try { return Buffer.from(encoded, "base64url").toString("utf8"); } catch { return ""; }
  }

  private safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }
}
