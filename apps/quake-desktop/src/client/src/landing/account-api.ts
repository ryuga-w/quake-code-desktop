export type AccountUser = {
  id: string;
  email: string;
  displayName: string;
  role: "user" | "admin";
  passwordChangeRequired: boolean;
  createdAt: string;
};

export type AdminAccountOverview = {
  userCount: number;
  adminCount: number;
  activeSessionCount: number;
  users: Array<AccountUser & { activeSessions: number }>;
};

export type AccountSession = {
  id: string;
  current: boolean;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

type SessionResponse = {
  user: AccountUser | null;
  session: AccountSession | null;
};

export class AccountApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AccountApiError";
    this.status = status;
    this.code = code;
  }
}

async function accountRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/account${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string };
  if (!response.ok) {
    throw new AccountApiError(
      response.status,
      typeof payload.error === "string" && payload.error ? payload.error : "Request failed.",
      payload.code,
    );
  }
  return payload as T;
}

export const accountApi = {
  session: () => accountRequest<SessionResponse>("/session"),
  signup: (input: { displayName: string; email: string; password: string; remember: boolean }) =>
    accountRequest<{ user: AccountUser }>("/signup", { method: "POST", body: JSON.stringify(input) }),
  login: (input: { email: string; password: string; remember: boolean }) =>
    accountRequest<{ user: AccountUser }>("/login", { method: "POST", body: JSON.stringify(input) }),
  logout: () => accountRequest<{ ok: true }>("/logout", { method: "POST", body: "{}" }),
  sessions: () => accountRequest<{ sessions: AccountSession[] }>("/sessions"),
  adminOverview: () => accountRequest<{ overview: AdminAccountOverview }>("/admin/overview"),
  revokeSession: (sessionId: string) =>
    accountRequest<{ ok: true; currentSessionRevoked: boolean }>(`/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  revokeOtherSessions: () =>
    accountRequest<{ ok: true }>("/sessions/revoke-others", { method: "POST", body: "{}" }),
  updateProfile: (displayName: string) =>
    accountRequest<{ user: AccountUser }>("/profile", { method: "PATCH", body: JSON.stringify({ displayName }) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    accountRequest<{ ok: true; user: AccountUser }>("/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};
