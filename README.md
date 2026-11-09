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

## Judge demo: run it end to end (Phase 7 Control Center)

The browser demo uses MockPsp only. It requires no PayPal credentials and
moves no real money.

### Step 1: Start the three store servers

In three separate terminals from the repository root:

```powershell
# Terminal 1: NovaMart (Honest Retailer — Port 8801)
npm run store:novamart

# Terminal 2: DealDemon (Discount/Adversarial Store — Port 8802)
npm run store:dealdemon

# Terminal 3: PeerMarket (Peer Marketplace — Port 8803)
npm run store:peermarket
```

### Step 2: Start the Recourse Control Center

In a fourth terminal from the repository root:

```powershell
npm run app
```

*(Alternatively: `npx tsx packages/app/src/main.ts` or `npm run ui`)*

Leave that running and open your browser to:

```
http://127.0.0.1:8787/
```

### Step 3: End-to-end judge evaluation path

1. **Agent Discovery across stores**:
   - In the Prompt Composer, type `Cheapest wireless headphones, max $70 all-in` (or click `▶ Demo 1: BLOCK Bait & Recover`).
   - The shopping agent queries NovaMart, DealDemon, and PeerMarket simultaneously.
   - Candidates are proposed and ranked in the center panel:
     - **NovaMart HDP-001** (AuraSound X200 Wireless Noise-Cancelling Headphones)
     - **DealDemon HDP-001** (Discount bait with adverse terms/drip fees)
     - **PeerMarket HDP-001** (Open-box, final-sale listing)

2. **NovaMart Honest Purchase (ALLOW)**:
   - Click **👉 Select Candidate for Purchase** on the NovaMart listing.
   - Click **✍ Sign Contract & Authorize Gateway Execution**.
   - The server signs the spending contract via host bridge with Ed25519, binds the draft, and submits the verified HMAC quote.
   - **Verdict**: **ALLOWED**, exact computed total **$67.74 CAPTURED** via MockPsp. A hash-chained receipt is written to the ledger.

3. **PeerMarket Human Review (STEP_UP)**:
   - Run discovery for `running shoes` or click `▶ Demo 2: STEP_UP Human Review`.
   - Select the PeerMarket candidate and click **✍ Sign Contract**.
   - The AI Safety Review (`TighteningJudge`) detects the unverified seller / final-sale condition and tightens to **STEP_UP**.
   - Execution pauses for human intervention:
     - Click **✓ Approve & Continue**: MockPsp executes capture (**$50.17 CAPTURED**).
     - Or click **✗ Reject & Abort**: Run ends with **$0.00 CAPTURED**.

4. **DealDemon Adversarial Defense (BLOCK)**:
   - Select the DealDemon candidate and sign with strict bounds ($70 max, no subscriptions).
   - The deterministic engine catches prohibited subscription line items and price ceiling violation.
   - **Verdict**: **BLOCKED**, **$0.00 CAPTURED** (payment is never called). The agent is notified to try the next candidate.

5. **Cryptographic Proofs**:
   - Click **Inspect Signed Cryptographic Evidence** or navigate to tab 5.
   - Click **🛡️ Verify Cryptographic Chain**.
   - Verifies the RFC 8032 Ed25519 signature and SHA-256 Merkle ledger hash chain. Result: **VALID**.

---

## API used by the demo

- `GET /` — Judge-facing Control Center UI
- `GET /api/status` — Gateway readiness, AI Safety Review status, and store registry
- `POST /api/status/judge` — Toggle AI Judge connected/unavailable for fail-safe testing
- `POST /api/phase7/runs` (and `POST /api/discovery/start`) — Start agent discovery
- `GET /api/phase7/runs/:id` — Get run and candidate snapshot
- `GET /api/phase7/runs/:id/events?afterSeq=N` — Incremental timeline event polling
- `POST /api/phase7/runs/:id/select` — Human candidate selection
- `POST /api/phase7/runs/:id/sign-and-submit` — Server-side Ed25519 contract signing & submission
- `POST /api/phase7/runs/:id/step-up` — Human STEP_UP APPROVE / REJECT
- `POST /api/attack/plant` — Attack Lab prompt injection testing
- `POST /api/evidence/verify` — Cryptographic hash chain verification

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
