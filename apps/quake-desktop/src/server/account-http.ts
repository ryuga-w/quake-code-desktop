import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import {
  AccountAuthError,
  type AccountAuthService,
  type AccountUser,
} from "./account-auth.js";

const ACCOUNT_API_PREFIX = "/api/account";
const SESSION_COOKIE = "quake_account_session";
const MAX_JSON_BODY_BYTES = 16 * 1024;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1_000;
const MAX_LOGIN_ATTEMPTS = 8;
const MAX_SIGNUP_ATTEMPTS = 5;

type JsonHeaders = Record<string, string | string[]>;
type SendJson = (res: ServerResponse, status: number, body: unknown, headers?: JsonHeaders) => void;

type AttemptWindow = {
  count: number;
  resetsAt: number;
};

export function isAccountApiPath(pathname: string): boolean {
  return pathname === ACCOUNT_API_PREFIX || pathname.startsWith(`${ACCOUNT_API_PREFIX}/`);
}

export class AccountHttpController {
  private readonly attempts = new Map<string, AttemptWindow>();

  constructor(private readonly accountAuth: AccountAuthService) {}

  async handle(req: IncomingMessage, res: ServerResponse, url: URL, sendJson: SendJson): Promise<void> {
    const method = req.method || "GET";
    const pathname = url.pathname;
    const commonHeaders = { "Cache-Control": "no-store" };

    try {
      if (method !== "GET" && method !== "HEAD") this.assertSameOrigin(req);

      if (method === "GET" && pathname === `${ACCOUNT_API_PREFIX}/session`) {
        const authSession = await this.accountAuth.getSession(readSessionCookie(req));
        sendJson(res, 200, authSession ?? { user: null, session: null }, commonHeaders);
        return;
      }

      if (method === "POST" && pathname === `${ACCOUNT_API_PREFIX}/signup`) {
        const body = await readJsonBody(req);
        const rateKey = `signup:${clientAddress(req)}`;
        this.consumeAttempt(rateKey, MAX_SIGNUP_ATTEMPTS);
        const result = await this.accountAuth.register({
          email: body.email,
          displayName: body.displayName,
          password: body.password,
        }, {
          userAgent: req.headers["user-agent"],
          remember: body.remember !== false,
        });
        this.clearAttempts(rateKey);
        sendJson(res, 201, { user: result.user }, {
          ...commonHeaders,
          "Set-Cookie": sessionCookie(req, result.sessionToken, result.expiresAt),
        });
        return;
      }

      if (method === "POST" && pathname === `${ACCOUNT_API_PREFIX}/login`) {
        const body = await readJsonBody(req);
        const rateKey = `login:${clientAddress(req)}:${rateEmail(body.email)}`;
        this.assertAttemptAvailable(rateKey, MAX_LOGIN_ATTEMPTS);
        try {
          const result = await this.accountAuth.login({ email: body.email, password: body.password }, {
            userAgent: req.headers["user-agent"],
            remember: body.remember !== false,
          });
          this.clearAttempts(rateKey);
          sendJson(res, 200, { user: result.user }, {
            ...commonHeaders,
            "Set-Cookie": sessionCookie(req, result.sessionToken, result.expiresAt),
          });
        } catch (error) {
          this.consumeAttempt(rateKey, MAX_LOGIN_ATTEMPTS);
          throw error;
        }
        return;
      }

      if (method === "POST" && pathname === `${ACCOUNT_API_PREFIX}/logout`) {
        await assertJsonRequest(req);
        await this.accountAuth.logout(readSessionCookie(req));
        sendJson(res, 200, { ok: true }, {
          ...commonHeaders,
          "Set-Cookie": clearSessionCookie(req),
        });
        return;
      }

      if (method === "GET" && pathname === `${ACCOUNT_API_PREFIX}/sessions`) {
        const sessions = await this.accountAuth.listSessions(readSessionCookie(req));
        sendJson(res, 200, { sessions }, commonHeaders);
        return;
      }

      if (method === "GET" && pathname === `${ACCOUNT_API_PREFIX}/admin/overview`) {
        const overview = await this.accountAuth.getAdminOverview(readSessionCookie(req));
        sendJson(res, 200, { overview }, commonHeaders);
        return;
      }

      if (method === "POST" && pathname === `${ACCOUNT_API_PREFIX}/sessions/revoke-others`) {
        await assertJsonRequest(req);
        await this.accountAuth.revokeOtherSessions(readSessionCookie(req));
        sendJson(res, 200, { ok: true }, commonHeaders);
        return;
      }

      if (method === "DELETE" && pathname.startsWith(`${ACCOUNT_API_PREFIX}/sessions/`)) {
        const sessionId = decodeURIComponent(pathname.slice(`${ACCOUNT_API_PREFIX}/sessions/`.length));
        if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
          throw new AccountAuthError(400, "INVALID_SESSION", "Geçersiz oturum kimliği.");
        }
        const result = await this.accountAuth.revokeSession(readSessionCookie(req), sessionId);
        sendJson(res, 200, { ok: true, ...result }, result.currentSessionRevoked
          ? { ...commonHeaders, "Set-Cookie": clearSessionCookie(req) }
          : commonHeaders);
        return;
      }

      if (method === "PATCH" && pathname === `${ACCOUNT_API_PREFIX}/profile`) {
        const body = await readJsonBody(req);
        const user = await this.accountAuth.updateProfile(readSessionCookie(req), { displayName: body.displayName });
        sendJson(res, 200, { user }, commonHeaders);
        return;
      }

      if (method === "POST" && pathname === `${ACCOUNT_API_PREFIX}/password`) {
        const body = await readJsonBody(req);
        const user = await this.accountAuth.changePassword(readSessionCookie(req), {
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
        });
        sendJson(res, 200, { ok: true, user }, commonHeaders);
        return;
      }

      sendJson(res, 404, { error: "Hesap uç noktası bulunamadı.", code: "NOT_FOUND" }, commonHeaders);
    } catch (error) {
      const status = error instanceof AccountAuthError ? error.statusCode : accountHttpStatus(error);
      const code = error instanceof AccountAuthError ? error.code : "ACCOUNT_REQUEST_FAILED";
      const message = error instanceof Error ? error.message : "Hesap isteği tamamlanamadı.";
      const headers: JsonHeaders = { ...commonHeaders };
      const retryAfter = Number((error as { retryAfter?: number } | undefined)?.retryAfter);
      if (Number.isFinite(retryAfter) && retryAfter > 0) headers["Retry-After"] = String(Math.ceil(retryAfter));
      sendJson(res, status, { error: message, code }, headers);
    }
  }

  private assertSameOrigin(req: IncomingMessage): void {
    const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    if (fetchSite === "cross-site") {
      throw new AccountAuthError(403, "CROSS_SITE_REQUEST", "Çapraz site isteği reddedildi.");
    }
    const origin = req.headers.origin;
    if (!origin) return;
    const requestHost = String(req.headers.host || "").toLowerCase();
    try {
      if (new URL(origin).host.toLowerCase() !== requestHost) {
        throw new AccountAuthError(403, "ORIGIN_MISMATCH", "İstek kaynağı doğrulanamadı.");
      }
    } catch (error) {
      if (error instanceof AccountAuthError) throw error;
      throw new AccountAuthError(403, "ORIGIN_MISMATCH", "İstek kaynağı doğrulanamadı.");
    }
  }

  private assertAttemptAvailable(key: string, maximum: number): void {
    this.pruneAttempts();
    const current = this.attempts.get(key);
    if (!current || current.resetsAt <= Date.now() || current.count < maximum) return;
    const retryAfter = Math.max(1, Math.ceil((current.resetsAt - Date.now()) / 1_000));
    const error = new AccountAuthError(429, "TOO_MANY_ATTEMPTS", "Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.") as AccountAuthError & { retryAfter?: number };
    error.retryAfter = retryAfter;
    throw error;
  }

  private consumeAttempt(key: string, maximum: number): void {
    this.assertAttemptAvailable(key, maximum);
    const now = Date.now();
    const current = this.attempts.get(key);
    if (!current || current.resetsAt <= now) {
      this.attempts.set(key, { count: 1, resetsAt: now + ATTEMPT_WINDOW_MS });
      return;
    }
    current.count += 1;
  }

  private clearAttempts(key: string): void {
    this.attempts.delete(key);
  }

  private pruneAttempts(): void {
    if (this.attempts.size < 256) return;
    const now = Date.now();
    for (const [key, value] of this.attempts) {
      if (value.resetsAt <= now) this.attempts.delete(key);
    }
  }
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  await assertJsonRequest(req);
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new AccountAuthError(413, "BODY_TOO_LARGE", "İstek gövdesi çok büyük.");
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new AccountAuthError(413, "BODY_TOO_LARGE", "İstek gövdesi çok büyük.");
    }
    chunks.push(buffer);
  }

  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value as Record<string, unknown>;
  } catch {
    throw new AccountAuthError(400, "INVALID_JSON", "Geçerli bir JSON gövdesi gönderin.");
  }
}

async function assertJsonRequest(req: IncomingMessage): Promise<void> {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new AccountAuthError(415, "JSON_REQUIRED", "Content-Type application/json olmalı.");
  }
}

function readSessionCookie(req: IncomingMessage): string {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function sessionCookie(req: IncomingMessage, token: string, expiresAt: string): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1_000));
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
    isSecureRequest(req) ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function clearSessionCookie(req: IncomingMessage): string {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    isSecureRequest(req) ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function isSecureRequest(req: IncomingMessage): boolean {
  const encrypted = Boolean((req.socket as Socket & { encrypted?: boolean }).encrypted);
  return encrypted || String(req.headers["x-forwarded-proto"] || "").split(",")[0]?.trim().toLowerCase() === "https";
}

function clientAddress(req: IncomingMessage): string {
  return req.socket.remoteAddress || "unknown";
}

function rateEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "invalid";
}

function accountHttpStatus(error: unknown): number {
  const status = Number((error as { statusCode?: number } | undefined)?.statusCode);
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

export type AccountSessionResponse = {
  user: AccountUser | null;
};
