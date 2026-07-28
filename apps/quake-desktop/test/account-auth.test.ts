import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountAuthError, AccountAuthService } from "../src/server/account-auth.js";

const temporaryDirectories: string[] = [];

async function createService(): Promise<AccountAuthService> {
  const directory = await mkdtemp(join(tmpdir(), "quake-account-auth-"));
  temporaryDirectories.push(directory);
  return new AccountAuthService({ filePath: join(directory, "account-auth.json"), scryptCost: 1_024 });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("AccountAuthService", () => {
  it("registers a normalized account without persisting raw secrets", async () => {
    const service = await createService();
    const password = "Quake-Runtime-2026!";
    const result = await service.register({
      email: "  Pilot@Example.COM ",
      displayName: "  Quake   Pilot  ",
      password,
    }, { userAgent: "Quake Test/1.0", remember: true });

    expect(result.user).toMatchObject({ email: "pilot@example.com", displayName: "Quake Pilot" });
    expect(result.sessionToken.length).toBeGreaterThan(30);
    expect(await service.getSession(result.sessionToken)).toMatchObject({
      user: { id: result.user.id, email: "pilot@example.com" },
      session: { current: true, userAgent: "Quake Test/1.0" },
    });

    const database = await readFile(service.filePath, "utf8");
    expect(database).not.toContain(password);
    expect(database).not.toContain(result.sessionToken);
    expect(database).toContain('"algorithm": "scrypt"');
  });

  it("rejects duplicate identities and weak credentials", async () => {
    const service = await createService();
    await service.register({ email: "pilot@example.com", displayName: "Quake Pilot", password: "Quake-Runtime-2026!" });

    await expect(service.register({
      email: "PILOT@example.com",
      displayName: "Other Pilot",
      password: "Another-Strong-2026!",
    })).rejects.toMatchObject<AccountAuthError>({ statusCode: 409, code: "EMAIL_IN_USE" });

    await expect(service.register({
      email: "invalid",
      displayName: "Q",
      password: "short",
    })).rejects.toMatchObject<AccountAuthError>({ statusCode: 400, code: "INVALID_EMAIL" });
  });

  it("uses generic login failures and creates revocable sessions", async () => {
    const service = await createService();
    const first = await service.register({
      email: "pilot@example.com",
      displayName: "Quake Pilot",
      password: "Quake-Runtime-2026!",
    }, { userAgent: "Desktop A" });

    await expect(service.login({ email: "pilot@example.com", password: "wrong-password" }))
      .rejects.toMatchObject<AccountAuthError>({ statusCode: 401, code: "INVALID_CREDENTIALS" });
    await expect(service.login({ email: "missing@example.com", password: "wrong-password" }))
      .rejects.toMatchObject<AccountAuthError>({ statusCode: 401, code: "INVALID_CREDENTIALS" });

    const second = await service.login({ email: "pilot@example.com", password: "Quake-Runtime-2026!" }, { userAgent: "Desktop B" });
    const sessions = await service.listSessions(first.sessionToken);
    expect(sessions).toHaveLength(2);
    expect(sessions.find((session) => session.userAgent === "Desktop A")?.current).toBe(true);

    const secondSession = sessions.find((session) => session.userAgent === "Desktop B")!;
    await service.revokeSession(first.sessionToken, secondSession.id);
    expect(await service.getSession(second.sessionToken)).toBeNull();
    expect(await service.listSessions(first.sessionToken)).toHaveLength(1);
  });

  it("updates identity and rotates passwords while revoking other sessions", async () => {
    const service = await createService();
    const first = await service.register({
      email: "pilot@example.com",
      displayName: "Quake Pilot",
      password: "Quake-Runtime-2026!",
    }, { userAgent: "Primary" });
    const second = await service.login({
      email: "pilot@example.com",
      password: "Quake-Runtime-2026!",
    }, { userAgent: "Secondary" });

    expect(await service.updateProfile(first.sessionToken, { displayName: "Mission Control" }))
      .toMatchObject({ displayName: "Mission Control" });
    await service.changePassword(first.sessionToken, {
      currentPassword: "Quake-Runtime-2026!",
      newPassword: "Quake-Control-Plane-2027!",
    });

    expect(await service.getSession(second.sessionToken)).toBeNull();
    await expect(service.login({ email: "pilot@example.com", password: "Quake-Runtime-2026!" }))
      .rejects.toMatchObject<AccountAuthError>({ code: "INVALID_CREDENTIALS" });
    await expect(service.login({ email: "pilot@example.com", password: "Quake-Control-Plane-2027!" }))
      .resolves.toMatchObject({ user: { displayName: "Mission Control" } });
  });

  it("provisions a real admin role and gates the control plane behind password rotation", async () => {
    const service = await createService();
    await service.register({
      email: "pilot@example.com",
      displayName: "Quake Pilot",
      password: "Quake-Runtime-2026!",
    });
    const admin = await service.provisionAdmin({
      email: "admin@quakecode.local",
      displayName: "System Admin",
      password: "Temporary-Admin-2026!",
    });

    expect(admin).toMatchObject({ role: "admin", passwordChangeRequired: true });
    const adminLogin = await service.login({
      email: "admin@quakecode.local",
      password: "Temporary-Admin-2026!",
    });
    await expect(service.getAdminOverview(adminLogin.sessionToken))
      .rejects.toMatchObject<AccountAuthError>({ statusCode: 403, code: "PASSWORD_CHANGE_REQUIRED" });

    const rotated = await service.changePassword(adminLogin.sessionToken, {
      currentPassword: "Temporary-Admin-2026!",
      newPassword: "Permanent-Admin-Control-2027!",
    });
    expect(rotated.passwordChangeRequired).toBe(false);
    await expect(service.getAdminOverview(adminLogin.sessionToken)).resolves.toMatchObject({
      userCount: 2,
      adminCount: 1,
      activeSessionCount: 2,
      users: expect.arrayContaining([
        expect.objectContaining({ email: "admin@quakecode.local", role: "admin" }),
        expect.objectContaining({ email: "pilot@example.com", role: "user" }),
      ]),
    });
  });
});
