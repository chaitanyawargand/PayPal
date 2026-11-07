# Phase 6 Frozen Contracts

This document locks the three inter-package contracts agreed upon for Phase 6. Both Part A (Runtime + UI) and Part B (Evidence + Compiler + Judge + Eval) must code strictly against these interfaces.

---

## Contract 1 — Evidence (B builds, A's UI consumes)

### Verification Response Shape
```jsonc
// POST /v1/evidence/verify -> response shape
{
  "valid": true,
  "checks": {
    "chain": true,
    "signatures": true
  },
  "failures": [] // human-readable strings explaining each verification failure
}
```

### Evidence Pack Shape
The evidence pack is an opaque JSON blob to the UI. The UI downloads it, re-uploads it, and offers a "tamper one field" action.
Inside `packages/evidence`, the pack contains:
- `intent_contract`: The Intent Contract associated with the payment sequence.
- `public_key_pem`: The public key used to verify the receipts.
- `signed_entries`: The append-only list of `{ receipt, signature }` entries.
- `created_at`: ISO 8601 timestamp string.

Verification verifies both:
1. `chain`: `verifyReceiptChain(receipts)` holds from genesis hash `'0'.repeat(64)`.
2. `signatures`: `verifyReceiptSignature(entry.receipt.hash, entry.signature, publicKeyPem)` holds for every entry.

---

## Contract 2 — Judge (B builds, A's app consumes)

### Types
```ts
export type Verdict = "ALLOW" | "STEP_UP" | "BLOCK";

export interface JudgeInput {
  deterministic_verdict: Verdict;
  evidence_text: string;
  claim_summary: string;
}

export interface JudgeOutput {
  verdict: "ALLOW" | "STEP_UP" | "BLOCK";
  grounded_quote: string | null;
  reason: string;
  model: "gemini-3.5-flash";
}
```

### Pure Tightening Function
`applyTightening(deterministicVerdict, judgeVerdict) -> finalVerdict`
- Ordering: `ALLOW < STEP_UP < BLOCK`
- The final verdict is **never looser** than the deterministic verdict.
- If deterministic is `BLOCK`, final is always `BLOCK`.
- If deterministic is `STEP_UP`, final can only be `STEP_UP` or `BLOCK`.
- If deterministic is `ALLOW`, final can be `ALLOW`, `STEP_UP`, or `BLOCK`.

---

## Contract 3 — Compiler (B builds, A exposes later)

### Types
```ts
export type CompileDraftStatus = "DRAFT" | "NEEDS_CLARIFICATION";

export interface CompileDraftResult {
  status: CompileDraftStatus;
  draft: Record<string, unknown> | null;
  warnings: string[];
}
```

### Constraints
- Draft-only: converts unstructured buyer requests into an **unsigned** contract draft.
- The `draft` object must contain **no `signature` field, ever**. Tests assert this.
- If merchant, price, caps, or requirements are ambiguous or missing, status must be `"NEEDS_CLARIFICATION"` with informative warnings, never an unverified guess.
- Integer cents only for all monetary amounts (no floats).
