# Judge Integration Seam Analysis (JUDGE_SEAM.md)

## Executive Summary
This document analyzes the integration seam for connecting the Recourse LLM Judge (`packages/judge`) into the pre-payment execution pipeline at the `packages/app` composition root without modifying frozen packages (`core`, `engine`, `flow`, `ledger`, `psp`, `db`, `gateway`).

---

## Seam Modes

### 1. ACTIVE Mode (Recommended)
- **Mechanism**: The Judge acts as an app-level gate immediately following deterministic evaluation and prior to PSP invocation.
- **Workflow**:
  1. Policy Engine produces deterministic verdict (e.g. `ALLOW`).
  2. If prose or unstructured merchant evidence spans exist, `judgeGate` evaluates the evidence with Gemini.
  3. `applyTightening(det, judge)` computes the final verdict.
  4. If the Judge tightens the verdict from `ALLOW` to `BLOCK` or `STEP_UP`, the tightened verdict is passed to `psp.charge()`.
  5. The PSP adapter sees a non-ALLOW verdict and refuses to charge (`money_moved_cents: 0`, `capture_id: null`).
- **Guarantee**: **$0 is moved** when the Judge tightens to `BLOCK`.

### 2. SHADOW Mode (Advisory)
- **Mechanism**: The Judge runs in parallel or post-decision, recording advisory analysis without altering the payment flow.
- **Workflow**:
  1. Engine executes normally.
  2. Judge evaluates evidence asynchronously or records findings in the decision breakdown.
  3. The UI explicitly renders `Judge: SHADOW (Advisory only)`.
- **Guarantee**: Non-interfering observation of LLM judgment accuracy on live or staged traffic.

---

## Contract 2 Compliance
The Judge exports:
- `applyTightening(det, judge)`: Pure monotonic tightening function (`ALLOW < STEP_UP < BLOCK`). Final is **never looser** than deterministic.
- Grounded quote verification with `indexOf` + 80-char negation window check.
- Injected client dependency injection: Zero hardcoded secrets, full testability without network.
