# Stack-aware senior heuristics

## Rust
- Prefer explicit types and exhaustive reasoning where possible.
- Reduce ambiguity at callsites.
- Keep ownership and error paths readable.

## TypeScript / JavaScript
- Clarify data contracts.
- Reduce overly dynamic shapes when they hide intent.
- Prefer readable object flow over clever utility composition.

## React / UI code
- Extract components only when ownership becomes clearer.
- Keep prop APIs readable.
- Make state transitions easy to follow.

## Backend / service code
- Separate IO, validation, and transformation where it improves clarity.
- Make failure behavior obvious.
- Keep orchestration boring and trustworthy.
