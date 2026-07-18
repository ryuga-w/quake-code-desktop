---
name: quake-refactor
description: Analyze a codebase, package, module, or large file and produce a practical refactor plan. Use when Codex needs to identify code smells, split oversized files, reduce coupling, clarify ownership boundaries, find safer extraction seams, or propose a low-risk sequence for cleanup work. Also handle Turkish requests and Turkish phrasing for the same tasks.
---

# Quake Refactor

Handle both English and Turkish requests. Treat Turkish phrases and synonyms as first-class triggers, and reply in the user's language unless asked otherwise.

Inspect structure before suggesting changes. Prefer safe, incremental plans over big-bang rewrites.

## Core workflow

1. Read the target files plus nearby docs or architecture notes.
2. Identify the problem shape:
   - oversized module
   - mixed responsibilities
   - circular or awkward dependencies
   - unclear ownership
   - repeated logic
   - hard-to-test code
   - config/protocol/schema logic mixed into runtime flow
3. Separate observations into:
   - structural issues
   - API boundary issues
   - naming/readability issues
   - testability risks
4. Find the safest seams for extraction or cleanup.
5. Propose the smallest reasonable sequence of steps.
6. Include validation after each step.

## Output format

When the user asks for a full plan, use these sections:

1. **Current problems**
2. **Refactor goals**
3. **Best extraction seams**
4. **Step-by-step plan**
5. **Risks and regressions to watch**
6. **Validation plan**
7. **Optional follow-up cleanups**

## Rules

- Prefer incremental changes that can be reviewed separately.
- Suggest moving related tests with extracted code when applicable.
- Name likely hotspots and high-churn files explicitly.
- If repository instructions discourage growing central modules, respect that in the plan.
- Do not recommend broad rewrites unless the user explicitly asks for one.
- When uncertain, present 2 plausible options and explain tradeoffs.

## Refactor heuristics

- Split by responsibility, not by arbitrary line count.
- Extract code that already has a clear boundary or data model.
- Keep public API changes minimal unless the payoff is strong.
- Prefer introducing focused modules over adding more helpers to bloated files.
- Improve test seams before moving risky logic.

## Optional deep-dive reference

If you need a reporting shape, read `references/refactor-template.md`.
