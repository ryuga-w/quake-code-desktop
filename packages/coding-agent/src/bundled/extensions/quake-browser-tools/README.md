# quake-browser-tools

Bundled Quake Code extension that exposes Playwright-backed `browser_*` tools for direct page interaction (navigation, forms, screenshots, tabs, etc.).

Use `web_search` for general lookups first; browser tools are for pages that need real interaction or browser state.

## Tools

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Open a URL (blocks search-result URLs; use `web_search` instead) |
| `browser_snapshot` | Text snapshot of page + interactive elements |
| `browser_click` | Click by CSS selector or snapshot index |
| `browser_type` | Type into an element |
| `browser_fill_form` | Fill multiple fields (`selector → value`) |
| `browser_select_option` | Select a `<select>` option |
| `browser_hover` | Hover an element |
| `browser_press_key` | Press a keyboard shortcut |
| `browser_drag` | Drag between two elements |
| `browser_wait_for` | Wait for selector, text, or network idle |
| `browser_take_screenshot` | Full-page PNG screenshot |
| `browser_console_messages` | Recent console log lines |
| `browser_network_requests` | Recent network requests |
| `browser_tabs` | List tabs and active tab |
| `browser_close` | Close a tab |
| `browser_run_code` | Run JavaScript in page context |
| `browser_evaluate` | Evaluate an expression in page context |
| `browser_file_upload` | Upload files into a file input |
| `browser_handle_dialog` | Accept/dismiss alert/confirm/prompt |
| `browser_resize` | Resize viewport |
| `browser_navigate_back` | Browser back |

## Playwright requirement

- Depends on `playwright` (see `package.json`).
- On Windows, launches **Microsoft Edge** (`channel: "msedge"`); elsewhere uses bundled Chromium.
- Browser runs **headed** (`headless: false`) with a persistent profile.

Install browsers if needed:

```bash
npx playwright install chromium
```

## Profile directory

This extension uses a dedicated persistent profile:

`~/.quake-code/playwright-profile`

`web_search` (core `web-runtime.ts`) uses a **separate** profile:

`~/.quake-code/playwright-web-profile`

The two profiles are intentional today so search and interactive browsing do not share cookies/session state. A future refactor may unify them behind one `BrowserManager`.

## Shutdown behavior

On `session_shutdown`, the extension calls `BrowserManager.shutdown()`:

1. Closes the Playwright persistent context (browser window).
2. Clears in-memory tab state and active tab id.

Registered via `quake.on("session_shutdown", …)` in `index.ts`. Fires when the agent session ends (quit, reload, RPC shutdown, etc.).