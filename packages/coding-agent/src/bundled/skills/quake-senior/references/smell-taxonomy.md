# Senior smell taxonomy

## Naming smell
- Variable, function, or type names do not reveal intent.
- Comments are compensating for weak naming.

## Control-flow smell
- Branching is surprising, nested, or hard to reason about.
- Important conditions are hidden deep in the function.

## Coupling smell
- One area of code knows too much about another.
- Validation, transformation, and side effects are mixed together.

## Abstraction smell
- Helpers or layers exist without a strong responsibility.
- A generic wrapper hides more than it clarifies.

## Testability smell
- Important decisions are difficult to exercise in isolation.
- Hidden state or dependencies make verification awkward.

## Callsite clarity smell
- Usage is ambiguous without opening the callee.
- Flags, booleans, or weak names make the API hard to trust.

## Reviewability smell
- The diff is wider than the actual design gain.
- Too many unrelated changes move together.
