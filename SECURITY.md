# Security policy

## Supported version

Security fixes are made on the latest `main` branch and the newest GitHub
Release.

## Reporting a vulnerability

Please do **not** open a public issue for a suspected vulnerability, exposed
credential, or unsafe tool-execution path. Use the repository's **Security**
tab to create a private vulnerability report and include:

- a concise description and impact;
- reproducible steps or a minimal proof of concept;
- affected version and operating system;
- any suggested mitigation.

Do not include live API keys, access tokens, or customer data in the report.
If a secret was exposed, rotate it immediately before reporting.

## Local data

Quake Code stores local settings, session metadata, and provider credentials
under user and workspace `.quake-code` directories. Those files are runtime
data, not source files, and must never be committed or attached to an issue.
