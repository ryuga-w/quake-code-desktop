# Refactor decision matrix

Use this when deciding how far to change the code.

## Rename only
Use when the structure is basically acceptable but the naming hides intent.

## Inline
Use when a helper, wrapper, or tiny abstraction makes the logic harder to scan at the point of use.

## Extract
Use when logic represents a real responsibility, is repeated, or becomes materially clearer as a named concept.

## Split module or file
Use when ownership, scanning cost, or mixed responsibilities are now the main source of complexity.

## Keep local
Use when an extraction would add jumps without increasing clarity.

## Replace API shape
Use when booleans, flags, or weakly named parameters make callsites ambiguous.

## Avoid rewrite
Do not rewrite when a surgical change can recover clarity, safety, and reviewability.
