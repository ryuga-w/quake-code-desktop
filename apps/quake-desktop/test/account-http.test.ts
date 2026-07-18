import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountAuthService } from "../src/server/account-auth.js";
import { AccountHttpController } from "../src/server/account-http.js";

const servers: Server[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function startAccountServer(): Promise<{ origin: string; auth: AccountAuthService }> {
  const directory = await mkdtemp(join(tmpdir(), "quake-account-http-"));
  temporaryDirectories.push(directory);
  const auth = new AccountAuthService({ filePath: join(directory, "auth.json"), scryptCost: 1_024 });
  const controller = new AccountHttpController(auth);
  const server = createServer((request, response) => {
    const origin = `http://${request.headers.host || "127.0.0.1"}`;
    void controller.handle(request, response, new URL(request.url || "/", origin), (res, status, body, headers = {}) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), ...headers });
      res.end(text);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP address");
  return { origin: `http://127.0.0.1:${address.port}`, auth };
}

describe("AccountHttpController", () => {
  it("sets an HttpOnly session cookie and resolves the signed-in identity", async () => {
    const { origin } = await startAccountServer();
    const signup = await fetch(`${origin}/api/account/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        displayName: "Quake Pilot",
        email: "pilot@example.com",
        password: "Quake-Runtime-2026!",
        remember: true,
      }),
    });

    expect(signup.status).toBe(201);
    const setCookie = signup.headers.get("set-cookie") || "";
    expect(setCookie).toContain("quake_account_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("Secure");

    const session = await fetch(`${origin}/api/account/session`, {
      headers: { Cookie: setCookie.split(";", 1)[0]! },
    });
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({
      user: { email: "pilot@example.com", displayName: "Quake Pilot" },
      session: { current: true },
    });
  });

  it("rejects cross-site mutations and non-JSON credential requests", async () => {
    const { origin } = await startAccountServer();
    const crossSite = await fetch(`${origin}/api/account/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: "{}",
    });
    expect(crossSite.status).toBe(403);
    await expect(crossSite.json()).resolves.toMatchObject({ code: "CROSS_SITE_REQUEST" });

    const formEncoded = await fetch(`${origin}/api/account/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
      body: "email=pilot%40example.com&password=secret",
    });
    expect(formEncoded.status).toBe(415);
    await expect(formEncoded.json()).resolves.toMatchObject({ code: "JSON_REQUIRED" });
  });

  it("serves the administrator overview only to a rotated admin identity", async () => {
    const { origin, auth } = await startAccountServer();
    await auth.provisionAdmin({
      email: "admin@quakecode.local",
      displayName: "System Admin",
      password: "Temporary-Admin-2026!",
      passwordChangeRequired: false,
    });
    const login = await fetch(`${origin}/api/account/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email: "admin@quakecode.local", password: "Temporary-Admin-2026!" }),
    });
    const cookie = (login.headers.get("set-cookie") || "").split(";", 1)[0]!;
    const overview = await fetch(`${origin}/api/account/admin/overview`, { headers: { Cookie: cookie } });

    expect(overview.status).toBe(200);
    await expect(overview.json()).resolves.toMatchObject({
      overview: { userCount: 1, adminCount: 1, activeSessionCount: 1 },
    });

    const signup = await fetch(`${origin}/api/account/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        displayName: "Regular User",
        email: "user@example.com",
        password: "Regular-User-Password-2026!",
      }),
    });
    const userCookie = (signup.headers.get("set-cookie") || "").split(";", 1)[0]!;
    const denied = await fetch(`${origin}/api/account/admin/overview`, { headers: { Cookie: userCookie } });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ code: "ADMIN_REQUIRED" });
  });
});
