import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DATABASE_VERSION = 1;
const PASSWORD_KEY_BYTES = 32;
const DEFAULT_SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SESSION_DAYS = 30;
const SHORT_SESSION_HOURS = 24;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1_000;
const DUMMY_SALT = Buffer.from("quake-code-account-auth-dummy-salt", "utf8");

export type AccountRole = "user" | "admin";

export type AccountUser = {
  id: string;
  email: string;
  displayName: string;
  role: AccountRole;
  passwordChangeRequired: boolean;
  createdAt: string;
};

export type AdminAccountUser = AccountUser & {
  activeSessions: number;
};

export type AdminAccountOverview = {
  userCount: number;
  adminCount: number;
  activeSessionCount: number;
  users: AdminAccountUser[];
};

export type AccountSession = {
  id: string;
  current: boolean;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

export type AccountAuthResult = {
  user: AccountUser;
  sessionToken: string;
  expiresAt: string;
};

export type AccountRequestMeta = {
  userAgent?: string;
  remember?: boolean;
};

type PasswordDigest = {
  algorithm: "scrypt";
  salt: string;
  hash: string;
  cost: number;
  blockSize: number;
  parallelization: number;
  keyBytes: number;
};

type StoredUser = AccountUser & {
  password: PasswordDigest;
  updatedAt: string;
};

type StoredSession = {
  id: string;
  userId: string;
  tokenHash: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

type AccountDatabase = {
  version: typeof DATABASE_VERSION;
  users: StoredUser[];
  sessions: StoredSession[];
};

export class AccountAuthError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AccountAuthError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class AccountAuthService {
  readonly filePath: string;
  private readonly scryptCost: number;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(options: { filePath?: string; scryptCost?: number } = {}) {
    this.filePath = options.filePath
      ?? process.env.QUAKE_ACCOUNT_AUTH_FILE
      ?? join(homedir(), ".quake-code", "account-auth.json");
    this.scryptCost = options.scryptCost ?? DEFAULT_SCRYPT_COST;
    if (!Number.isInteger(this.scryptCost) || this.scryptCost < 1_024 || (this.scryptCost & (this.scryptCost - 1)) !== 0) {
      throw new TypeError("scryptCost must be a power of two greater than or equal to 1024");
    }
  }

  async register(
    input: { email: unknown; displayName: unknown; password: unknown },
    meta: AccountRequestMeta = {},
  ): Promise<AccountAuthResult> {
    const email = normalizeEmail(input.email);
    const displayName = normalizeDisplayName(input.displayName);
    const password = validatePassword(input.password);

    return this.exclusive(async () => {
      const database = await this.readDatabase();
      this.pruneExpiredSessions(database);
      if (database.users.some((user) => user.email === email)) {
        throw new AccountAuthError(409, "EMAIL_IN_USE", "Bu e-posta adresiyle zaten bir hesap var.");
      }

      const now = new Date().toISOString();
      const user: StoredUser = {
        id: randomUUID(),
        email,
        displayName,
        role: "user",
        passwordChangeRequired: false,
        password: await this.hashPassword(password),
        createdAt: now,
        updatedAt: now,
      };
      const authResult = this.createSession(user, meta);
      database.users.push(user);
      database.sessions.push(authResult.storedSession);
      await this.writeDatabase(database);
      return { user: publicUser(user), sessionToken: authResult.token, expiresAt: authResult.storedSession.expiresAt };
    });
  }

  async provisionAdmin(input: {
    email: unknown;
    displayName: unknown;
    password: unknown;
    passwordChangeRequired?: boolean;
  }): Promise<AccountUser> {
    const email = normalizeEmail(input.email);
    const displayName = normalizeDisplayName(input.displayName);
    const password = validatePassword(input.password);

    return this.exclusive(async () => {
      const database = await this.readDatabase();
      this.pruneExpiredSessions(database);
      if (database.users.some((user) => user.email === email)) {
        throw new AccountAuthError(409, "EMAIL_IN_USE", "Bu e-posta adresiyle zaten bir hesap var.");
      }

      const now = new Date().toISOString();
      const user: StoredUser = {
        id: randomUUID(),
        email,
        displayName,
        role: "admin",
        passwordChangeRequired: input.passwordChangeRequired !== false,
        password: await this.hashPassword(password),
        createdAt: now,
        updatedAt: now,
      };
      database.users.push(user);
      await this.writeDatabase(database);
      return publicUser(user);
    });
  }

  async login(
    input: { email: unknown; password: unknown },
    meta: AccountRequestMeta = {},
  ): Promise<AccountAuthResult> {
    const email = normalizeEmail(input.email);
    const password = typeof input.password === "string" ? input.password : "";

    return this.exclusive(async () => {
      const database = await this.readDatabase();
      this.pruneExpiredSessions(database);
      const user = database.users.find((candidate) => candidate.email === email);
      const passwordMatches = user
        ? await this.verifyPassword(password, user.password)
        : await this.performDummyPasswordCheck(password);
      if (!user || !passwordMatches) {
        throw new AccountAuthError(401, "INVALID_CREDENTIALS", "E-posta veya parola hatalı.");
      }

      const authResult = this.createSession(user, meta);
      database.sessions.push(authResult.storedSession);
      await this.writeDatabase(database);
      return { user: publicUser(user), sessionToken: authResult.token, expiresAt: authResult.storedSession.expiresAt };
    });
  }

  getSession(sessionToken: string, touch = true): Promise<{ user: AccountUser; session: AccountSession } | null> {
    if (!sessionToken) return Promise.resolve(null);
    return this.exclusive(async () => {
      const database = await this.readDatabase();
      const pruned = this.pruneExpiredSessions(database);
      const tokenHash = hashSessionToken(sessionToken);
      const session = database.sessions.find((candidate) => safeEqual(candidate.tokenHash, tokenHash));
      const user = session ? database.users.find((candidate) => candidate.id === session.userId) : undefined;
      if (!session || !user) {
        if (pruned) await this.writeDatabase(database);
        return null;
      }

      const lastSeen = Date.parse(session.lastSeenAt);
      if (touch && (!Number.isFinite(lastSeen) || Date.now() - lastSeen >= SESSION_TOUCH_INTERVAL_MS)) {
        session.lastSeenAt = new Date().toISOString();
        await this.writeDatabase(database);
      } else if (pruned) {
        await this.writeDatabase(database);
      }
      return { user: publicUser(user), session: publicSession(session, session.id) };
    });
  }

  listSessions(sessionToken: string): Promise<AccountSession[]> {
    return this.exclusive(async () => {
      const database = await this.readDatabase();
      const pruned = this.pruneExpiredSessions(database);
      const currentHash = hashSessionToken(sessionToken);
      const current = database.sessions.find((candidate) => safeEqual(candidate.tokenHash, currentHash));
      if (!current) throw new AccountAuthError(401, "SESSION_REQUIRED", "Oturum açmanız gerekiyor.");
      if (pruned) await this.writeDatabase(database);
      return database.sessions
        .filter((session) => session.userId === current.userId)
        .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))
        .map((session) => publicSession(session, current.id));
    });
  }

  getAdminOverview(sessionToken: string): Promise<AdminAccountOverview> {
    return this.exclusive(async () => {
      const { database } = await this.requireAdminStoredSession(sessionToken);
      this.pruneExpiredSessions(database);
      const sessionCountByUser = new Map<string, number>();
      for (const session of database.sessions) {
        sessionCountByUser.set(session.userId, (sessionCountByUser.get(session.userId) ?? 0) + 1);
      }
      const users = database.users
        .map((user) => ({ ...publicUser(user), activeSessions: sessionCountByUser.get(user.id) ?? 0 }))
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      return {
        userCount: users.length,
        adminCount: users.filter((user) => user.role === "admin").length,
        activeSessionCount: database.sessions.length,
        users,
      };
    });
  }

  async updateProfile(sessionToken: string, input: { displayName: unknown }): Promise<AccountUser> {
    const displayName = normalizeDisplayName(input.displayName);
    return this.exclusive(async () => {
      const { database, user } = await this.requireStoredSession(sessionToken);
      user.displayName = displayName;
      user.updatedAt = new Date().toISOString();
      await this.writeDatabase(database);
      return publicUser(user);
    });
  }

  async changePassword(
    sessionToken: string,
    input: { currentPassword: unknown; newPassword: unknown },
  ): Promise<AccountUser> {
    const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
    const newPassword = validatePassword(input.newPassword);
    return this.exclusive(async () => {
      const { database, user, session } = await this.requireStoredSession(sessionToken);
      if (!await this.verifyPassword(currentPassword, user.password)) {
        throw new AccountAuthError(401, "INVALID_CURRENT_PASSWORD", "Mevcut parola hatalı.");
      }
      if (currentPassword === newPassword) {
        throw new AccountAuthError(400, "PASSWORD_UNCHANGED", "Yeni parola mevcut paroladan farklı olmalı.");
      }
      user.password = await this.hashPassword(newPassword);
      user.passwordChangeRequired = false;
      user.updatedAt = new Date().toISOString();
      database.sessions = database.sessions.filter((candidate) => candidate.userId !== user.id || candidate.id === session.id);
      await this.writeDatabase(database);
      return publicUser(user);
    });
  }

  logout(sessionToken: string): Promise<void> {
    if (!sessionToken) return Promise.resolve();
    return this.exclusive(async () => {
      const database = await this.readDatabase();
      const tokenHash = hashSessionToken(sessionToken);
      const nextSessions = database.sessions.filter((session) => !safeEqual(session.tokenHash, tokenHash));
      if (nextSessions.length === database.sessions.length) return;
      database.sessions = nextSessions;
      await this.writeDatabase(database);
    });
  }

  revokeSession(sessionToken: string, sessionId: string): Promise<{ currentSessionRevoked: boolean }> {
    return this.exclusive(async () => {
      const { database, user, session } = await this.requireStoredSession(sessionToken);
      const target = database.sessions.find((candidate) => candidate.id === sessionId && candidate.userId === user.id);
      if (!target) throw new AccountAuthError(404, "SESSION_NOT_FOUND", "Oturum bulunamadı.");
      database.sessions = database.sessions.filter((candidate) => candidate.id !== target.id);
      await this.writeDatabase(database);
      return { currentSessionRevoked: target.id === session.id };
    });
  }

  revokeOtherSessions(sessionToken: string): Promise<void> {
    return this.exclusive(async () => {
      const { database, user, session } = await this.requireStoredSession(sessionToken);
      database.sessions = database.sessions.filter((candidate) => candidate.userId !== user.id || candidate.id === session.id);
      await this.writeDatabase(database);
    });
  }

  private async requireStoredSession(sessionToken: string): Promise<{
    database: AccountDatabase;
    user: StoredUser;
    session: StoredSession;
  }> {
    if (!sessionToken) throw new AccountAuthError(401, "SESSION_REQUIRED", "Oturum açmanız gerekiyor.");
    const database = await this.readDatabase();
    this.pruneExpiredSessions(database);
    const tokenHash = hashSessionToken(sessionToken);
    const session = database.sessions.find((candidate) => safeEqual(candidate.tokenHash, tokenHash));
    const user = session ? database.users.find((candidate) => candidate.id === session.userId) : undefined;
    if (!session || !user) throw new AccountAuthError(401, "SESSION_REQUIRED", "Oturum açmanız gerekiyor.");
    return { database, user, session };
  }

  private async requireAdminStoredSession(sessionToken: string): Promise<{
    database: AccountDatabase;
    user: StoredUser;
    session: StoredSession;
  }> {
    const authSession = await this.requireStoredSession(sessionToken);
    if (authSession.user.role !== "admin") {
      throw new AccountAuthError(403, "ADMIN_REQUIRED", "Bu işlem için yönetici yetkisi gerekiyor.");
    }
    if (authSession.user.passwordChangeRequired) {
      throw new AccountAuthError(403, "PASSWORD_CHANGE_REQUIRED", "Yönetici işlemlerinden önce geçici parolanızı değiştirin.");
    }
    return authSession;
  }

  private createSession(user: StoredUser, meta: AccountRequestMeta): { token: string; storedSession: StoredSession } {
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const durationMs = meta.remember === false
      ? SHORT_SESSION_HOURS * 60 * 60 * 1_000
      : SESSION_DAYS * 24 * 60 * 60 * 1_000;
    const nowIso = new Date(now).toISOString();
    return {
      token,
      storedSession: {
        id: randomUUID(),
        userId: user.id,
        tokenHash: hashSessionToken(token),
        userAgent: sanitizeUserAgent(meta.userAgent),
        createdAt: nowIso,
        lastSeenAt: nowIso,
        expiresAt: new Date(now + durationMs).toISOString(),
      },
    };
  }

  private async hashPassword(password: string): Promise<PasswordDigest> {
    const salt = randomBytes(24);
    const params = {
      cost: this.scryptCost,
      blockSize: SCRYPT_BLOCK_SIZE,
      parallelization: SCRYPT_PARALLELIZATION,
      keyBytes: PASSWORD_KEY_BYTES,
    };
    const hash = await derivePassword(password, salt, params);
    return {
      algorithm: "scrypt",
      salt: salt.toString("base64url"),
      hash: hash.toString("base64url"),
      ...params,
    };
  }

  private async verifyPassword(password: string, digest: PasswordDigest): Promise<boolean> {
    try {
      const expected = Buffer.from(digest.hash, "base64url");
      const actual = await derivePassword(password, Buffer.from(digest.salt, "base64url"), digest);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  private async performDummyPasswordCheck(password: string): Promise<boolean> {
    const derived = await derivePassword(password, DUMMY_SALT, {
      cost: this.scryptCost,
      blockSize: SCRYPT_BLOCK_SIZE,
      parallelization: SCRYPT_PARALLELIZATION,
      keyBytes: PASSWORD_KEY_BYTES,
    });
    return timingSafeEqual(derived, Buffer.alloc(PASSWORD_KEY_BYTES));
  }

  private pruneExpiredSessions(database: AccountDatabase): boolean {
    const now = Date.now();
    const userIds = new Set(database.users.map((user) => user.id));
    const sessions = database.sessions.filter((session) => userIds.has(session.userId) && Date.parse(session.expiresAt) > now);
    if (sessions.length === database.sessions.length) return false;
    database.sessions = sessions;
    return true;
  }

  private async readDatabase(): Promise<AccountDatabase> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<AccountDatabase>;
      if (parsed.version !== DATABASE_VERSION || !Array.isArray(parsed.users) || !Array.isArray(parsed.sessions)) {
        throw new Error("Unsupported account database format");
      }
      const database = parsed as AccountDatabase;
      database.users = database.users.map((user) => ({
        ...user,
        role: user.role === "admin" ? "admin" : "user",
        passwordChangeRequired: user.passwordChangeRequired === true,
      }));
      return database;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: DATABASE_VERSION, users: [], sessions: [] };
      }
      throw error;
    }
  }

  private async writeDatabase(database: AccountDatabase): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(database, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => undefined);
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") throw new AccountAuthError(400, "INVALID_EMAIL", "Geçerli bir e-posta adresi girin.");
  const email = value.normalize("NFKC").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new AccountAuthError(400, "INVALID_EMAIL", "Geçerli bir e-posta adresi girin.");
  }
  return email;
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string") throw new AccountAuthError(400, "INVALID_NAME", "Adınız 2–64 karakter olmalı.");
  const displayName = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (displayName.length < 2 || displayName.length > 64 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    throw new AccountAuthError(400, "INVALID_NAME", "Adınız 2–64 karakter olmalı.");
  }
  return displayName;
}

function validatePassword(value: unknown): string {
  if (typeof value !== "string") throw new AccountAuthError(400, "WEAK_PASSWORD", "Parola en az 12 karakter olmalı.");
  if (value.length < 12 || value.length > 128 || Buffer.byteLength(value, "utf8") > 256) {
    throw new AccountAuthError(400, "WEAK_PASSWORD", "Parola 12–128 karakter olmalı.");
  }
  const groups = [/[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value)].filter(Boolean).length;
  if (value.length < 16 && groups < 3) {
    throw new AccountAuthError(400, "WEAK_PASSWORD", "Daha uzun bir parola veya en az üç farklı karakter türü kullanın.");
  }
  return value;
}

function sanitizeUserAgent(value: string | undefined): string {
  const normalized = String(value || "Unknown device").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return normalized.slice(0, 240) || "Unknown device";
}

function publicUser(user: StoredUser): AccountUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    passwordChangeRequired: user.passwordChangeRequired,
    createdAt: user.createdAt,
  };
}

function publicSession(session: StoredSession, currentSessionId: string): AccountSession {
  return {
    id: session.id,
    current: session.id === currentSessionId,
    userAgent: session.userAgent,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
  };
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function derivePassword(
  password: string,
  salt: Buffer,
  params: { cost: number; blockSize: number; parallelization: number; keyBytes: number },
): Promise<Buffer> {
  const minimumMemory = 128 * params.cost * params.blockSize;
  const maxmem = Math.max(64 * 1024 * 1024, minimumMemory + 2 * 1024 * 1024);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, params.keyBytes, {
      N: params.cost,
      r: params.blockSize,
      p: params.parallelization,
      maxmem,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
