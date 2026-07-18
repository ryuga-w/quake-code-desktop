# Strict-finish mode

Use this mode when the user wants senior-level execution with no loose ends in the touched path.

## Goal
Finish the requested change cleanly enough that another engineer does not immediately see obvious follow-up work inside the implemented path.

## Rules
- Narrow scope if needed, but do not leave the chosen scope half-finished.
- Clean up dependent callsites when a touched API or name change requires it.
- Do not leave TODO, FIXME, placeholder logic, fake returns, or dangling branches in touched code.
- Do not mix old and new patterns in the same touched path without a strong reason.
- If a blocker prevents full completion, state it explicitly and isolate it cleanly.

## When to use it
- production hardening
- bugfixes that must feel complete
- refactors where half-migration would create debt
- cleanup requests where trust matters more than diff size

## Final check
Before calling the work done, ask:
- Is the touched path complete?
- Are dependent usage sites coherent?
- Is any obvious follow-up work being hidden?
- Would a strong reviewer say this feels finished?
