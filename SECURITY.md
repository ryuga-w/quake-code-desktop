# Security policy

Quake Code can access source files, execute commands, connect to model providers and MCP servers, control an embedded browser, and—when explicitly enabled—interact with the Windows desktop. Security reports are taken seriously.

## Supported versions

Security fixes are applied to the latest GitHub Release and the current `main` branch.

| Version | Supported |
|---|---|
| Latest release | Yes |
| `main` | Yes |
| Older releases | No |

## Report a vulnerability privately

Do **not** open a public issue or discussion for a suspected vulnerability, exposed credential, sandbox/workspace escape, or unsafe tool-execution path.

Use [GitHub's private vulnerability reporting form](https://github.com/ryuga-w/quake-code-desktop/security/advisories/new) and include:

- a concise description and potential impact;
- reproducible steps or a minimal proof of concept;
- the affected version, commit, and Windows version;
- the permission mode and relevant tool/provider configuration;
- any suggested mitigation.

Do not include live API keys, access tokens, private source code, customer data, or unnecessary personal information. If a secret was exposed, rotate it before reporting.

The maintainer will acknowledge and triage valid reports as availability permits. Public disclosure should be coordinated until a fix or mitigation is available.

## In scope

- workspace boundary or path traversal issues;
- command, file, MCP, browser, desktop, or permission bypasses;
- renderer-to-main/server trust-boundary failures;
- unintended credential or session exposure;
- vulnerable release or update behavior;
- cross-site scripting or request forgery that reaches privileged local capabilities.

General bugs, feature requests, and support questions belong in the public repository unless they expose a security impact.

## Local data

Quake Code stores local settings, session metadata, and provider configuration under user and workspace `.quake-code` directories. These are runtime data, not source files. Never commit them or attach them to a public report.
