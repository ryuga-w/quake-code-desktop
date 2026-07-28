# Quake Code Web Security

Quake Code Web exposes the same powerful runtime capabilities as the TUI, so it is local-first by default.

## Defaults

- Host defaults to `127.0.0.1`.
- Wildcard binds like `0.0.0.0` are refused unless `QUAKE_WEB_ALLOW_REMOTE=1`.
- `/api/*` requires a local token unless `QUAKE_WEB_AUTH=0`.
- In Vite dev mode, the web token is injected into `index.html` so proxied `/api/*` calls include the same token as production static serving.
- File preview is restricted to the active root; every root in the window is validated independently against the optional allowlist.
- Optional workspace allowlist can restrict valid `QUAKE_WEB_CWD` values.
- Terminal command policy defaults to `safe`.

## Environment

```bash
QUAKE_WEB_HOST=127.0.0.1
QUAKE_WEB_PORT=3737
QUAKE_WEB_CWD=/path/to/workspace
QUAKE_WEB_TOKEN=optional-fixed-token
QUAKE_WEB_AUTH=0
QUAKE_WEB_ALLOW_REMOTE=0
QUAKE_WEB_WORKSPACE_ALLOWLIST=/path/a:/path/b
QUAKE_WEB_TERMINAL_POLICY=safe # safe | allow-all | disabled
```

On Windows shells, path-list separators may be `;` instead of `:` depending on shell and Node platform parsing.

## Web security UI

The client surfaces auth/security state in a top-level banner:

- auth enabled/disabled
- client token loaded/missing
- localhost vs remote bind warning
- active workspace boundary and open-root status
- terminal policy indicator
- dangerous-command warning for obvious destructive terminal input

## Remaining hardening

- Replace SSE query-token auth with cookie/WebSocket auth before remote mode.
- Add project-specific terminal allow/deny policy UI.
- Add explicit confirmations for write/destructive actions.
- Add CORS tests and security regression smoke tests.
- Add workspace allowlist to persistent Quake settings once the web settings schema is stable.
