# Completion checklist

Use this before considering a senior refactor done.
Strict-finish mode should pass this checklist cleanly.

## No-gap finish
- Did the touched code end in a complete, runnable, believable state?
- Did we avoid leaving obvious follow-up work inside the changed path?

## No placeholders
- No new TODO, FIXME, stub, fake return, or placeholder branch unless explicitly requested.
- No half-migrated pattern left behind without a stated reason.

## Callsite completion
- Were dependent callsites cleaned up after API or naming changes?
- Does usage read clearly without requiring future cleanup?

## Control-flow completion
- Are important branches handled completely?
- Were error, edge, and fallback paths left in a coherent state?

## Honesty rule
- If full completion was unsafe or blocked, was the scope narrowed explicitly instead of hiding the gap?
