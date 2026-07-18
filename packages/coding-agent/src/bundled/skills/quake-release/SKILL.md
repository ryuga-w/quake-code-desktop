---
name: quake-release
description: Produce release notes and upgrade guidance from code changes. Use when Codex needs to summarize what shipped, explain user-facing impact, call out breaking changes, or convert technical diffs into release-ready notes. Also handle Turkish requests and Turkish phrasing for the same tasks.
---

# Quake Release

Handle both English and Turkish requests. Treat Turkish phrases and synonyms as first-class triggers, and reply in the user's language unless asked otherwise.

Translate technical change into user-facing impact.

## Core workflow

1. Read the relevant diff, commit list, changelog fragments, or changed files.
2. Group changes by user impact:
   - new features
   - fixes
   - performance or reliability
   - docs/tooling/internal cleanup
   - breaking changes
3. Separate user-facing impact from internal implementation details.
4. Call out upgrade or migration steps when needed.
5. Keep the final notes concise and scannable.

## Output format

1. **Release highlights**
2. **Fixes and improvements**
3. **Breaking changes / migrations**
4. **Developer-facing notes**

## Rules

- Avoid inventing product value beyond the diff.
- Prefer impact language over implementation trivia.
- If no breaking changes are visible, say so.
- If changes are mostly internal, explain that plainly.
- Keep tone clear and release-ready.

## Optional deep-dive reference

If you want a standard report shape, read `references/release-template.md`.
