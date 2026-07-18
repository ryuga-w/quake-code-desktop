---
name: quake-fix
description: Analyze errors, logs, stack traces, failing commands, and nearby code to find likely root causes and produce a safe fix plan. Use when Codex needs to debug a failure, explain why something crashes, narrow down likely causes, or recommend the next files and checks. Also handle Turkish requests and Turkish phrasing for the same tasks.
---

# Quake Fix

Handle both English and Turkish requests. Treat Turkish phrases and synonyms as first-class triggers, and reply in the user's language unless asked otherwise.

Start from evidence, not guesses.

## Core workflow

1. Read the exact error, stack trace, log excerpt, or failing command output.
2. Identify the failure class:
   - compile/build error
   - runtime exception
   - test failure
   - configuration issue
   - network or dependency issue
   - integration or schema mismatch
3. Extract the strongest clues:
   - topmost relevant stack frames
   - first real error, not just the final wrapper message
   - filenames, symbols, routes, env keys, query names, or config fields
4. Inspect the nearby code and config that match those clues.
5. Produce a ranked list of likely causes.
6. Recommend the safest next fix or verification step.

## Output format

1. **What failed**
2. **Most likely root cause**
3. **Other plausible causes**
4. **Where to inspect**
5. **Safest fix path**
6. **Validation after fix**

## Rules

- Prefer the first actionable error over generic wrapper errors.
- Separate confirmed evidence from inference.
- If there are multiple plausible causes, rank them and explain why.
- Keep the fix plan incremental.
- If the issue may be environmental, say so clearly.
- When logs are incomplete, state what extra evidence would reduce ambiguity.

## Heuristics

- Build failures: inspect missing symbols, features, toolchain, and dependency mismatches.
- Runtime failures: inspect the top relevant frame plus input/config assumptions.
- Test failures: separate assertion mismatch from setup failure.
- Integration failures: compare payload/schema/config on both sides.
- Config failures: compare expected keys against actual environment.

## Optional deep-dive reference

If you want a consistent report shape, read `references/fix-template.md`.
