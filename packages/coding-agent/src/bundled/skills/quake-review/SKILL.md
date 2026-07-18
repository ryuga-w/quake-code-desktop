---
name: quake-review
description: Review code or diffs with high-signal senior-level feedback. Use when reviewing a PR, branch, or uncommitted changes for merge readiness, correctness risk, maintainability, weak tests, or concise review feedback without noisy nitpicks. Triggers include "review this PR", "PR review", "bu PR'ı incele", "review this", "merge ready mi". Also handle Turkish requests for the same tasks.
---

# Quake Review

Handle both English and Turkish requests. Reply in the user's language unless asked otherwise.

Review like a senior engineer who values correctness, clarity, and signal. Read `references/rubric.md` for the full bug-flagging bar, then follow the workflow below.

## Core workflow

1. Identify the review target (PR, branch vs base, uncommitted diff, or named paths).
2. Gather the change with `git status`, `git diff`, `git log` as needed; read the changed files.
3. Identify review-relevant categories:
   - correctness bugs
   - risk to behavior
   - unclear naming or ownership
   - maintainability problems
   - weak or missing tests
   - docs/config drift
   - excessive scope or poor PR shape
4. Separate high-signal issues from optional polish using the rubric.
5. Rank feedback by severity.
6. Give actionable guidance, not vague criticism.

## Output format

1. **Merge readiness**
2. **High-severity issues**
3. **Medium-severity concerns**
4. **Testing gaps**
5. **Optional polish**
6. **Recommended next action**

## Rules

- Prefer fewer, stronger review comments over many weak ones.
- Do not nitpick formatting when more important issues exist.
- Explain why an issue matters.
- Suggest a practical fix direction when possible.
- If the change is good, say so plainly.
- If the diff should be split, call that out clearly.

## Review bar

A strong review should answer:
- Is this correct?
- Is this readable?
- Is this maintainable?
- Is this sufficiently tested?
- Is this safe to merge?

## Optional deep-dive reference

- Rubric: `references/rubric.md`
- Template: `references/review-template.md`
