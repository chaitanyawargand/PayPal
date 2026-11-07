# Recourse

Recourse is a pre-payment firewall for agent-initiated payments. Before money
moves, it checks a payment against a signed Intent Contract:

- A valid payment may be captured.
- A tampered payment is blocked and moves $0.
- Every outcome writes a signed, hash-chained receipt.
- Receipts can be verified independently against the signing public key.

The deterministic engine makes the final payment decision. AI may only
tighten a decision toward step-up or block; it can never loosen a
deterministic block.

## Judge demo: run it end to end

The browser demo uses MockPsp only. It requires no PayPal credentials and
moves no real money.

### Start the app

From the repository root, in PowerShell:

    $env:RUN_PAYPAL_LIVE = "0"
    $env:RECOURSE_PSP = "mock"
    $env:HOST = "127.0.0.1"
    $env:PORT = "8787"
    $env:RECOURSE_DB_PATH = Join-Path $env:TEMP ("recourse-demo-" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + ".db")

    Remove-Item Env:RECOURSE_SIGNING_PUBLIC_KEY_PEM -ErrorAction SilentlyContinue
    Remove-Item Env:RECOURSE_SIGNING_PRIVATE_KEY_PEM -ErrorAction SilentlyContinue

    npx tsx packages/app/src/main.ts

Leave that terminal running and open:

    http://127.0.0.1:8787/

Expected startup output includes:

    Recourse app listening on http://127.0.0.1:8787
    MOCK/SANDBOX - NO REAL MONEY
    PSP: MockPsp (tier C)
    Judge: DISCONNECTED

Do not use the repository root npm run dev script for this demo; it points
at the legacy application entrypoint. The judge demo entrypoint is
packages/app/src/main.ts.

### Click path

Do not refresh the page between these three steps.

1. Click Run ALLOW demo.
   - The JK-101 items total $70.00.
   - The merchant proposes $70.00.
   - Expected result: ALLOW with a MockPsp capture of exactly $70.00.
   - A signed receipt is added and the receipt count increases.

2. Click Run BLOCK demo.
   - The same JK-101 items total $70.00.
   - The merchant proposes $120.00.
   - Expected result: BLOCK with reason TOTAL_MISMATCH.
   - Expected money moved: $0.00.
   - A signed receipt is still added for the blocked attempt.

3. Click Run Evidence demo.
   - Recourse fetches the signed receipts created during this page session.
   - It posts them with the signing public key to the evidence verifier.
   - Expected result: Evidence VALID.
   - Expected chain check: valid.
   - Expected signature check: valid.
   - Expected failures: none.

The Evidence step verifies receipts created in the current page session.
After a page refresh, run ALLOW or BLOCK again before running Evidence.

## API used by the demo

- GET / - judge-facing browser UI
- GET /v1/app/status - app status and signing public key
- POST /v1/payments/execute - executes ALLOW, BLOCK, or STEP_UP outcomes
- GET /v1/receipts/:receiptId - returns one signed receipt entry
- POST /v1/evidence/verify - verifies signed receipt entries against a public key

## Trust model

- The signed Intent Contract defines merchant, budget, item, and payment constraints.
- The deterministic engine computes the expected total; the merchant-proposed total is never trusted as the price source.
- Only an ALLOW outcome may ask the PSP to move money.
- A BLOCK outcome moves $0 but still creates a signed receipt.
- Receipts are hash-chained from a genesis prev_hash and signed with Ed25519.
- The browser and evidence verifier need only the public key, never the private signing key.

## Current demo limits

- This local UI is intentionally MockPsp-only: MOCK/SANDBOX - NO REAL MONEY.
- The integrated app reports Judge: DISCONNECTED; the live AI Judge path is not required for the deterministic ALLOW/BLOCK/Evidence demonstration.
- Starting the app with RUN_PAYPAL_LIVE=1 or a non-Mock PSP is refused.

## Tests

    npx vitest run packages/app/test/ui.test.ts packages/app/test/status.test.ts packages/app/test/evidence.test.ts packages/app/test/app.test.ts packages/app/test/restart.test.ts
    npx tsc -p packages/app/tsconfig.json --noEmit
