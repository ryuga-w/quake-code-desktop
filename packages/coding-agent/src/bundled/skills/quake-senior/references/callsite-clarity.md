# Callsite clarity guidance

A senior refactor is not complete if usage stays confusing.

## Check the callsite
- Is the function name enough to understand intent?
- Do argument names and shapes explain themselves?
- Would a new engineer trust this usage immediately?

## Common problems
- bool or flag arguments that require mental decoding
- helper names that are too generic
- wrappers that hide important decisions
- optional arguments that make behavior unclear

## Better outcomes
- self-explanatory names
- explicit data shapes
- callsites that read like intent, not puzzle pieces
