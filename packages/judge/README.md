# `packages/judge`

LLM Pre-Payment Policy Judge powered by `gemini-3.5-flash` with monotonic pure tightening and fail-closed security.

Conforms strictly to **Phase 6 Contract 2**.

## Key Features
- **Contract 2 Conformance**:
  - `applyTightening(det, judge) -> final`: Strictly ensures `ALLOW < STEP_UP < BLOCK`. Final verdict is **never looser** than deterministic verdict.
- **Quote Grounding Verification**:
  - Verbatim substring check (`indexOf`).
  - 80-character negation window before the quote to protect against inverted context.
- **Fail-Closed Design**:
  - Timeouts, missing API keys, model hallucination, schema parsing failure all default to `STEP_UP`.
- **Zero Secrets**:
  - Gemini client injected via dependency injection; zero hardcoded secrets or environment reading in library code.

