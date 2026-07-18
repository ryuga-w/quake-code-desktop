---
name: quake-security
description: Audit code and configuration for practical security issues. Use when Codex needs to inspect secret handling, auth flows, trust boundaries, unsafe defaults, input handling, permission checks, exposed routes, or risky operational behavior. Also handle Turkish requests and Turkish phrasing for the same tasks.
---

# Quake Security

Handle both English and Turkish requests. Treat Turkish phrases and synonyms as first-class triggers, and reply in the user's language unless asked otherwise.

Focus on real risk, not performative noise.

## Core workflow

1. Identify trust boundaries and sensitive surfaces.
2. Inspect:
   - auth and session handling
   - secret storage and env usage
   - config defaults
   - exposed routes/endpoints
   - permission checks
   - input validation and output exposure
3. Separate confirmed risk from suspicious patterns.
4. Rank findings by exploitability and impact.
5. Recommend practical mitigations.

## Output format

1. **Security summary**
2. **High-severity findings**
3. **Medium-severity findings**
4. **Suspicious patterns to verify**
5. **Recommended fixes**

## Rules

- Do not print secrets in full.
- Prefer exploitability plus impact over theoretical purity.
- Explain why a finding matters.
- Distinguish code risk from deployment risk.
- Avoid low-value noise when stronger issues exist.

## High-signal areas

- hardcoded or leaked credentials
- auth bypass or weak trust assumptions
- unsafe default config
- missing authorization checks
- overly broad secret exposure in logs or errors
- insecure fallback behavior

## Optional deep-dive reference

If you want a standard report shape, read `references/security-template.md`.
