import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
  TerminalSquare,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  AccountApiError,
  accountApi,
  type AdminAccountOverview,
  type AccountSession,
  type AccountUser,
} from "./account-api";
import "../../landing.css";
import "../../auth.css";

type AuthMode = "login" | "signup";

type Feedback = {
  kind: "error" | "success";
  message: string;
} | null;

function initialMode(): AuthMode {
  return new URLSearchParams(window.location.search).get("mode") === "signup" ? "signup" : "login";
}

function QuakeBrand(): React.JSX.Element {
  return (
    <a className="auth-brand" href="/landing.html" aria-label="Quake Code landing page">
      <img src="/quake-code-q.png" width="40" height="40" alt="" />
      <span>QUAKE CODE</span>
    </a>
  );
}

function AuthHeader({ authenticated }: { authenticated: boolean }): React.JSX.Element {
  return (
    <header className="auth-header">
      <QuakeBrand />
      <div className="auth-header-meta">
        <span><i /> QUAKE ID / {authenticated ? "AUTHENTICATED" : "SECURE ACCESS"}</span>
        <a href="/landing.html"><ArrowLeft aria-hidden="true" /> Back to product</a>
      </div>
    </header>
  );
}

function PasswordMeter({ password }: { password: string }): React.JSX.Element {
  const score = useMemo(() => {
    const categories = [/[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
    return Math.min(4, Number(password.length >= 12) + Number(password.length >= 16) + Math.max(0, categories - 2));
  }, [password]);
  const label = ["Enter a password", "Needs more range", "Good start", "Strong", "Excellent"][score];

  return (
    <div className="password-meter" aria-live="polite">
      <div aria-hidden="true">
        {[1, 2, 3, 4].map((level) => <i className={level <= score ? "is-filled" : ""} key={level} />)}
      </div>
      <span>{label}</span>
    </div>
  );
}

function AuthForm({ onAuthenticated }: { onAuthenticated: (user: AccountUser) => void }): React.JSX.Element {
  const [mode, setModeState] = useState<AuthMode>(initialMode);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const setMode = (nextMode: AuthMode) => {
    setModeState(nextMode);
    setFeedback(null);
    setPassword("");
    const url = new URL(window.location.href);
    url.searchParams.set("mode", nextMode);
    window.history.replaceState({}, "", url);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "signup" && !termsAccepted) {
      setFeedback({ kind: "error", message: "Confirm that you accept the account terms to continue." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const result = mode === "signup"
        ? await accountApi.signup({ displayName, email, password, remember })
        : await accountApi.login({ email, password, remember });
      onAuthenticated(result.user);
    } catch (error) {
      setFeedback({ kind: "error", message: accountErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell" id="main">
      <section className="auth-visual" aria-label="Quake Code identity system">
        <div className="auth-visual-media" aria-hidden="true" />
        <div className="auth-visual-grid" aria-hidden="true" />
        <div className="auth-visual-copy">
          <p><span /> ONE IDENTITY / EVERY SURFACE</p>
          <h1>YOUR WORK.<br />IN MOTION.<br /><em>WHEREVER YOU ARE.</em></h1>
          <div className="auth-signal" aria-hidden="true">
            <span>IDENTITY</span><i /><span>RUNTIME</span><i /><span>CONTROL</span>
          </div>
        </div>
        <div className="auth-visual-footer">
          <span>TERMINAL</span><span>DESKTOP</span><span>MOBILE</span>
        </div>
      </section>

      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-panel-inner">
          <div className="auth-index"><span>ACCESS NODE</span><b>Q / ID</b></div>
          <div className="auth-tabs" role="group" aria-label="Account access mode">
            <button
              type="button"
              aria-pressed={mode === "login"}
              className={mode === "login" ? "is-active" : ""}
              onClick={() => setMode("login")}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === "signup"}
              className={mode === "signup" ? "is-active" : ""}
              onClick={() => setMode("signup")}
            >
              Create account
            </button>
          </div>

          <div className="auth-title-block">
            <p>{mode === "signup" ? "INITIALIZE YOUR QUAKE ID" : "RETURN TO THE SYSTEM"}</p>
            <h2 id="auth-title">{mode === "signup" ? <>CREATE YOUR<br /><em>CONTROL PLANE.</em></> : <>WELCOME<br /><em>BACK.</em></>}</h2>
            <span>
              {mode === "signup"
                ? "One identity for your sessions, devices, and the work ahead."
                : "Sign in to continue from the exact point you left the system."}
            </span>
          </div>

          <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
            {mode === "signup" ? (
              <label>
                <span>FULL NAME</span>
                <div><UserRound aria-hidden="true" /><input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Ada Lovelace" minLength={2} maxLength={64} required /></div>
              </label>
            ) : null}
            <label>
              <span>EMAIL ADDRESS</span>
              <div><TerminalSquare aria-hidden="true" /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" maxLength={254} required /></div>
            </label>
            <label>
              <span>PASSWORD</span>
              <div>
                <LockKeyhole aria-hidden="true" />
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === "signup" ? "12+ characters" : "Your password"}
                  minLength={12}
                  maxLength={128}
                  required
                />
                <button type="button" className="password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
              {mode === "signup" ? <PasswordMeter password={password} /> : null}
            </label>

            <div className="auth-options">
              <label className="check-control">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                <span aria-hidden="true"><Check /></span>
                Keep me signed in
              </label>
              <small>{remember ? "30-day secure session" : "24-hour session"}</small>
            </div>

            {mode === "signup" ? (
              <label className="check-control auth-terms">
                <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
                <span aria-hidden="true"><Check /></span>
                I understand this Quake ID stores account and session security data locally on this runtime.
              </label>
            ) : null}

            {feedback ? <div className={`auth-feedback is-${feedback.kind}`} role="alert"><i />{feedback.message}</div> : null}

            <button className="auth-submit" type="submit" disabled={busy}>
              <span>{busy ? "Securing connection" : mode === "signup" ? "Create Quake ID" : "Enter Quake Code"}</span>
              {busy ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
            </button>
          </form>

          <div className="auth-trust">
            <p><ShieldCheck aria-hidden="true" /><span><b>HARDENED CREDENTIALS</b>Passwords are protected with salted scrypt. Raw session keys never touch disk.</span></p>
            <p><KeyRound aria-hidden="true" /><span><b>YOUR SESSION, YOUR CONTROL</b>Review and revoke every signed-in device from the account console.</span></p>
          </div>
        </div>
      </section>
    </main>
  );
}

function AccountDashboard({ initialUser, onSignedOut }: { initialUser: AccountUser; onSignedOut: () => void }): React.JSX.Element {
  const [user, setUser] = useState(initialUser);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [adminOverview, setAdminOverview] = useState<AdminAccountOverview | null>(null);
  const [adminLoading, setAdminLoading] = useState(initialUser.role === "admin" && !initialUser.passwordChangeRequired);
  const [displayName, setDisplayName] = useState(initialUser.displayName);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [copied, setCopied] = useState(false);

  const refreshSessions = async () => {
    setSessionsLoading(true);
    try {
      const response = await accountApi.sessions();
      setSessions(response.sessions);
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 401) onSignedOut();
      else setFeedback({ kind: "error", message: accountErrorMessage(error) });
    } finally {
      setSessionsLoading(false);
    }
  };

  const refreshAdminOverview = async (candidate: AccountUser = user) => {
    if (candidate.role !== "admin" || candidate.passwordChangeRequired) {
      setAdminOverview(null);
      setAdminLoading(false);
      return;
    }
    setAdminLoading(true);
    try {
      const response = await accountApi.adminOverview();
      setAdminOverview(response.overview);
    } catch (error) {
      setFeedback({ kind: "error", message: accountErrorMessage(error) });
    } finally {
      setAdminLoading(false);
    }
  };

  useEffect(() => {
    void refreshSessions();
    void refreshAdminOverview(initialUser);
  }, []);

  const updateProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProfileBusy(true);
    setFeedback(null);
    try {
      const result = await accountApi.updateProfile(displayName);
      setUser(result.user);
      setDisplayName(result.user.displayName);
      setFeedback({ kind: "success", message: "Identity profile updated." });
    } catch (error) {
      setFeedback({ kind: "error", message: accountErrorMessage(error) });
    } finally {
      setProfileBusy(false);
    }
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordBusy(true);
    setFeedback(null);
    try {
      const result = await accountApi.changePassword(currentPassword, newPassword);
      setUser(result.user);
      setCurrentPassword("");
      setNewPassword("");
      setFeedback({ kind: "success", message: "Password changed. Other sessions were revoked." });
      await refreshSessions();
      await refreshAdminOverview(result.user);
    } catch (error) {
      setFeedback({ kind: "error", message: accountErrorMessage(error) });
    } finally {
      setPasswordBusy(false);
    }
  };

  const revokeSession = async (session: AccountSession) => {
    setFeedback(null);
    try {
      const result = await accountApi.revokeSession(session.id);
      if (result.currentSessionRevoked) {
        onSignedOut();
        return;
      }
      await refreshSessions();
      setFeedback({ kind: "success", message: "Session revoked." });
    } catch (error) {
      setFeedback({ kind: "error", message: accountErrorMessage(error) });
    }
  };

  const revokeOthers = async () => {
    setFeedback(null);
    try {
      await accountApi.revokeOtherSessions();
      await refreshSessions();
      setFeedback({ kind: "success", message: "Every other session has been revoked." });
    } catch (error) {
      setFeedback({ kind: "error", message: accountErrorMessage(error) });
    }
  };

  const logout = async () => {
    try { await accountApi.logout(); } finally { onSignedOut(); }
  };

  const copyIdentity = async () => {
    await navigator.clipboard.writeText(user.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main className="account-shell" id="main">
      <aside className="account-rail">
        <div>
          <p className="account-rail-label"><span /> QUAKE ID / {user.role === "admin" ? "ADMIN" : "ACTIVE"}</p>
          <div className="account-avatar" aria-hidden="true">{initials(user.displayName)}</div>
          <h1>{user.displayName}</h1>
          <p>{user.email}</p>
          {user.role === "admin" ? <span className="admin-role-badge"><Crown aria-hidden="true" /> SYSTEM ADMINISTRATOR</span> : null}
        </div>
        <nav aria-label="Account sections">
          <a className="is-active" href="#overview"><UserRound aria-hidden="true" /> Overview <span>01</span></a>
          <a href="#security"><ShieldCheck aria-hidden="true" /> Security <span>02</span></a>
          <a href="#sessions"><MonitorSmartphone aria-hidden="true" /> Sessions <span>03</span></a>
          {user.role === "admin" ? <a href="#admin"><Crown aria-hidden="true" /> Admin <span>04</span></a> : null}
        </nav>
        <div className="account-rail-bottom">
          <p>MEMBER SINCE<span>{formatDate(user.createdAt)}</span></p>
          <button type="button" onClick={() => void logout()}><LogOut aria-hidden="true" /> Sign out</button>
        </div>
      </aside>

      <section className="account-main">
        <div className="account-topline"><span>IDENTITY CONTROL PLANE</span><a href="/"><span>OPEN WORKSPACE</span><ArrowRight aria-hidden="true" /></a></div>
        <header className="account-heading" id="overview">
          <div><p>GOOD TO HAVE YOU BACK,</p><h2>{user.displayName.split(" ")[0]?.toUpperCase()}.</h2></div>
          <div className="account-status"><i /><span><b>{user.role === "admin" ? "ADMIN AUTHORITY ACTIVE" : "ALL SYSTEMS NOMINAL"}</b>{user.role === "admin" ? "Protected management controls are bound to this identity." : "Your identity and current session are secure."}</span></div>
        </header>

        {user.passwordChangeRequired ? (
          <div className="password-required" role="alert">
            <KeyRound aria-hidden="true" />
            <span><b>TEMPORARY PASSWORD ACTIVE</b>Rotate your password in Security before using administrator controls.</span>
            <a href="#security">ROTATE NOW <ArrowRight aria-hidden="true" /></a>
          </div>
        ) : null}

        {feedback ? <div className={`account-feedback is-${feedback.kind}`} role="status"><i />{feedback.message}</div> : null}

        <div className="account-grid">
          <article className="account-card identity-card">
            <div className="account-card-title"><span>01 / IDENTITY</span><UserRound aria-hidden="true" /></div>
            <form onSubmit={(event) => void updateProfile(event)}>
              <label><span>DISPLAY NAME</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={64} required /></label>
              <label><span>EMAIL ADDRESS</span><input value={user.email} readOnly aria-readonly="true" /></label>
              <button type="submit" disabled={profileBusy || displayName.trim() === user.displayName}>
                {profileBusy ? <LoaderCircle className="is-spinning" /> : <Check />} Save identity
              </button>
            </form>
            <div className="identity-code">
              <p><span>QUAKE ID</span><code>{user.id}</code></p>
              <button type="button" onClick={() => void copyIdentity()} aria-label="Copy Quake ID">{copied ? <Check /> : <Copy />}</button>
            </div>
          </article>

          <article className="account-card security-card" id="security">
            <div className="account-card-title"><span>02 / SECURITY</span><ShieldCheck aria-hidden="true" /></div>
            <div className="security-meter"><strong>STRONG</strong><span><i /><i /><i /><i /></span><small>scrypt / salted / opaque sessions</small></div>
            <form onSubmit={(event) => void changePassword(event)}>
              <label><span>CURRENT PASSWORD</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
              <label><span>NEW PASSWORD</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} maxLength={128} required /></label>
              <button type="submit" disabled={passwordBusy || !currentPassword || newPassword.length < 12}>
                {passwordBusy ? <LoaderCircle className="is-spinning" /> : <KeyRound />} Rotate password
              </button>
            </form>
          </article>

          <article className="account-card sessions-card" id="sessions">
            <div className="account-card-title">
              <span>03 / ACTIVE SESSIONS</span>
              <button type="button" onClick={() => void revokeOthers()} disabled={sessions.filter((session) => !session.current).length === 0}>REVOKE OTHERS</button>
            </div>
            <div className="session-list">
              {sessionsLoading ? <div className="session-loading"><LoaderCircle className="is-spinning" /> Resolving secure sessions…</div> : sessions.map((session) => (
                <div className="session-row" key={session.id}>
                  <div className="session-device">{deviceIcon(session.userAgent)}</div>
                  <div><strong>{deviceName(session.userAgent)}</strong><span>{compactUserAgent(session.userAgent)}</span></div>
                  <p><span>{session.current ? "CURRENT" : "LAST ACTIVE"}</span>{session.current ? "This device" : relativeTime(session.lastSeenAt)}</p>
                  {session.current
                    ? <span className="current-session"><i /> LIVE</span>
                    : <button type="button" onClick={() => void revokeSession(session)} aria-label={`Revoke ${deviceName(session.userAgent)} session`}><Trash2 aria-hidden="true" /> Revoke</button>}
                </div>
              ))}
            </div>
          </article>

          {user.role === "admin" ? (
            <article className="account-card admin-card" id="admin">
              <div className="account-card-title"><span>04 / ADMIN CONTROL</span><Crown aria-hidden="true" /></div>
              {user.passwordChangeRequired ? (
                <div className="admin-locked"><LockKeyhole aria-hidden="true" /><span><b>CONTROL PLANE LOCKED</b>Change the temporary password to unlock protected administrator data.</span></div>
              ) : adminLoading ? (
                <div className="session-loading"><LoaderCircle className="is-spinning" /> Resolving administrator authority…</div>
              ) : adminOverview ? (
                <>
                  <div className="admin-stats">
                    <p><strong>{adminOverview.userCount}</strong><span>IDENTITIES</span></p>
                    <p><strong>{adminOverview.adminCount}</strong><span>ADMINS</span></p>
                    <p><strong>{adminOverview.activeSessionCount}</strong><span>LIVE SESSIONS</span></p>
                  </div>
                  <div className="admin-user-list">
                    {adminOverview.users.map((account) => (
                      <div key={account.id}>
                        <span className="admin-user-icon">{account.role === "admin" ? <Crown aria-hidden="true" /> : <UsersRound aria-hidden="true" />}</span>
                        <p><strong>{account.displayName}</strong><small>{account.email}</small></p>
                        <b className={account.role === "admin" ? "is-admin" : ""}>{account.role.toUpperCase()}</b>
                        <span>{account.activeSessions} LIVE</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </article>
          ) : null}
        </div>

        <footer className="account-footer"><span>QUAKE ID / LOCAL AUTHORITY</span><p>Credentials stay on this runtime. Sessions can be revoked at any time.</p></footer>
      </section>
    </main>
  );
}

function App(): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AccountUser | null>(null);

  const handleSignedOut = () => {
    setUser(null);
    const url = new URL(window.location.href);
    url.searchParams.set("mode", "login");
    window.history.replaceState({}, "", url);
  };

  useEffect(() => {
    let active = true;
    accountApi.session()
      .then((response) => { if (active) setUser(response.user); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <AuthHeader authenticated={Boolean(user)} />
      {loading ? (
        <main className="auth-loading" id="main"><img src="/quake-code-q.png" alt="" /><LoaderCircle aria-hidden="true" /><span>RESOLVING IDENTITY</span></main>
      ) : user ? (
        <AccountDashboard initialUser={user} onSignedOut={handleSignedOut} />
      ) : (
        <AuthForm onAuthenticated={setUser} />
      )}
    </>
  );
}

function accountErrorMessage(error: unknown): string {
  if (error instanceof AccountApiError) return error.message;
  if (error instanceof TypeError) return "The account service is unavailable. Check that the Quake server is running.";
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "Q";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(value));
}

function relativeTime(value: string): string {
  const deltaMinutes = Math.round((Date.parse(value) - Date.now()) / 60_000);
  if (Math.abs(deltaMinutes) < 1) return "just now";
  if (Math.abs(deltaMinutes) < 60) return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(deltaMinutes, "minute");
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(deltaHours, "hour");
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(deltaHours / 24), "day");
}

function deviceName(userAgent: string): string {
  if (/Electron/i.test(userAgent)) return "Quake Desktop";
  if (/Edg\//i.test(userAgent)) return "Microsoft Edge";
  if (/Firefox\//i.test(userAgent)) return "Mozilla Firefox";
  if (/Chrome\//i.test(userAgent)) return "Google Chrome";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "Quake Web Session";
}

function compactUserAgent(userAgent: string): string {
  if (/Windows/i.test(userAgent)) return "Windows runtime";
  if (/Android/i.test(userAgent)) return "Android runtime";
  if (/iPhone|iPad/i.test(userAgent)) return "iOS runtime";
  if (/Macintosh/i.test(userAgent)) return "macOS runtime";
  if (/Linux/i.test(userAgent)) return "Linux runtime";
  return "Unknown runtime";
}

function deviceIcon(userAgent: string): React.JSX.Element {
  if (/Android|iPhone|iPad/i.test(userAgent)) return <Smartphone aria-hidden="true" />;
  if (/Electron/i.test(userAgent)) return <Laptop aria-hidden="true" />;
  return <MonitorSmartphone aria-hidden="true" />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
