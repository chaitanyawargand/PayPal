# `packages/compiler`

Draft-only contract compiler that transforms unstructured or semi-structured requests into unsigned draft Intent Contracts.

Conforms strictly to **Phase 6 Contract 3**.

## Invariants
- **Draft-only**: Never signs, hashes, saves, or executes contracts. The draft object contains **no signature** and **no hash**.
- **Ambiguity rejection**: If merchants, budget caps, or per-order limits are missing or ambiguous, returns `status: "NEEDS_CLARIFICATION"` with informative warnings. Never guesses spending terms.
- **Integer cents only**: All amounts are strictly positive integer cents.

