# Recourse — Shop everything. Trust nothing.

**A pre-payment firewall for AI shopping agents.**

## The problem

AI shopping agents read merchant listings, descriptions, reviews, and other
content that merchants control. That content can try to manipulate an agent into
ignoring a user's budget or buying something else. An agent being manipulated
must never be enough to move money.

## What Recourse does

The user reviews and signs a shopping mission before the autonomous agent acts.
The signed mission binds the requested item, quantity, condition, allowed
merchants, exclusions, and a hard all-in budget cap. The agent can discover and
rank offers, but it cannot move money.

Merchants issue signed quotes. Before payment, the Recourse gateway verifies the
quote signature and its merchant, SKU, quantity, and total against the signed
mission and server-computed pricing. A deterministic payment decision runs
separately from any LLM. Gemini integrations, when enabled, are advisory: the
tightening judge can request more review or block, but cannot loosen a
deterministic outcome or authorize payment. A human can approve only a
`STEP_UP`. The gateway captures at most once and never above the signed cap.
Completed payments produce Evidence that can be verified independently.

## Payment outcomes

- **ALLOW** — all deterministic checks pass; the gateway may capture the
  verified amount.
- **STEP_UP** — the gateway pauses with $0 captured until a human approves or
  rejects. Approval uses the already verified decision and quote; rejection
  excludes that candidate.
- **BLOCK** — the candidate is ineligible. The autonomous flow may exclude it
  and retry through a fresh gateway run.
- **TAMPER_REJECT** — signature or signed payment data failed verification. The
  run aborts immediately with $0 captured.
- **NEEDS_CLARIFICATION** — required mission details, such as a confirmed hard
  cap, are missing. No mission is signed until the user answers.

Planted listing content is untrusted merchant data. It can tighten a decision
to `STEP_UP`, but it is never an instruction to AgentBrain, the signed mission,
the quote, or the payment path.

## Demo flows proven in the browser

- **Normal NovaMart headphones purchase:** `COMPLETED`, 6,774 cents captured
  once, Evidence `VALID`.
- **Planted content attack, approved:** mission
  `mission_6538f7fa-f725-4aea-ba1f-e352474f2131` paused at `STEP_UP` with $0
  captured; approval captured 6,774 cents exactly once; Evidence `VALID`.
- **Planted content attack, rejected:** mission
  `mission_b44e74ed-2830-44ec-a4a5-67ffc09cb615` paused at `STEP_UP` with $0
  captured; rejection excluded the candidate and ended `NO_PURCHASE` with
  $0.00 captured.
- The prior happy-path and clarification/no-purchase browser gates passed.

The NovaMart planted Product Description text was not visible in Sidd's last
manual storefront check. The attack did reach discovery and the judge, and the
reported STEP_UP behavior worked; storefront visibility remains a deferred
polish issue and is not claimed as browser-verified fixed.

## Architecture

| Component | Repository package | Responsibility |
| --- | --- | --- |
| Control Center and mission UI | `packages/app` | HTTP app, dashboard, mission review/signing flow, and Attack Lab |
| Autonomous discovery and missions | `packages/phase7-agent` | Search, quote requests, candidate building, and signed mission orchestration |
| Shared run and candidate contracts | `packages/phase7-contracts` | Validated run, candidate, event, and decision data shapes |
| Merchant storefronts | `packages/stores/novamart`, `packages/stores/dealdemon`, `packages/stores/peermarket` | Independent catalogs, listing APIs, carts, pricing, and signed quotes |
| Shared storefront primitives | `packages/stores/store-core` | Catalog types, pricing, quote signing, and listing content |
| Payment policy | `packages/engine` | Deterministic payment decision rules |
| Quote and contract host adapters | `packages/phase7-host` | HMAC quote verification, signed intent resolution, and deterministic engine bridge |
| Gateway | `packages/phase7-gateway` | Sole payment execution authority; verifies, decides, pauses, and calls the PSP port |
| Advisory judge | `packages/phase7-judge` | Tightening-only judge boundary and optional Gemini adapter |
| Mock payment provider | `packages/psp` | Idempotent in-memory MockPsp; the demo does not move live money |
| Evidence and receipt chain | `packages/evidence`, `packages/ledger` | Evidence creation/verification and signed, hash-chained receipts |
| Local persistence | `packages/db` | SQLite-backed intent and ledger data |

Attack Lab registrations are projected into the targeted merchant listing.
Discovery passes listing text as data to candidate and judge layers; it does not
turn that content into mission or payment instructions.

## Security model

- The agent, merchant content, LLM output, and Gemini are untrusted.
- The gateway is the sole money mover. Agent discovery and ranking cannot call
  the PSP directly.
- Prices and totals are computed and checked server-side in integer cents.
- Merchant quotes are HMAC-signed and checked against the selected merchant,
  SKU, quantity, total, and signed user cap before execution.
- Capture is idempotent and limited to the verified total within the signed
  cap. `STEP_UP` approval does not bypass quote verification.
- `TAMPER_REJECT` aborts immediately with $0. `BLOCK` excludes a candidate;
  any retry uses a fresh gateway run. Four unsuccessful attempts end in
  `NO_PURCHASE` with $0 captured.
- Planted content can trigger a tighter review such as `STEP_UP`; it cannot
  loosen a decision, change the signed mission or quote, alter totals, or force
  capture.
- Completed payment Evidence includes cryptographic material for independent
  verification. Non-payment and aborted runs remain visible in the run
  timeline; they do not represent a completed payment receipt.

## How to run

Use four PowerShell terminals from the repository root. The store and app
scripts load local environment configuration with `dotenv/config`.

In each terminal, keep live PayPal disabled:

```powershell
$env:RUN_PAYPAL_LIVE = "0"
```

Start one store per terminal:

```powershell
npm run store:novamart   # default port 8801
npm run store:dealdemon  # default port 8802
npm run store:peermarket # default port 8803
```

Start the Control Center in the fourth terminal:

```powershell
$env:RUN_PAYPAL_LIVE = "0"
npm run app              # default port 8787
```

Open `http://127.0.0.1:8787/`. Store ports can be set with `NOVAMART_PORT`,
`DEALDEMON_PORT`, and `PEERMARKET_PORT`; the app port can be set with
`APP_PORT` (or `PORT`).

For the app to verify quotes issued by the separate store processes, configure
each corresponding quote secret under the same name in the app and that store's
local environment: `NOVAMART_QUOTE_SECRET`, `DEALDEMON_QUOTE_SECRET`, and
`PEERMARKET_QUOTE_SECRET`. Keep the values private and do not print them. In
non-production development, a store without its configured secret generates an
ephemeral key. Gemini is optional; `GEMINI_API_KEY`, `RECOURSE_AGENT_BRAIN`,
`GEMINI_MODEL`, and `GEMINI_TIMEOUT_MS` are the available configuration names.
For a no-network deterministic demo, leave Gemini unconfigured or select the
deterministic AgentBrain. The prototype uses MockPsp only. Do not enable live
PayPal; `RUN_PAYPAL_LIVE` must remain `0`.

The browser demo is manual. Automated tests use fake secrets and MockPsp; they
do not call live Gemini, PayPal, or a live PSP.

## Tests and verification

Run from the repository root:

```sh
npx vitest run --pool=threads --maxWorkers=1
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p packages/app/tsconfig.json
git diff --check
```

Final verification: **61 test files passed, 432 tests passed, 5 skipped**.

## Known limitations

- The prototype executes payments through MockPsp, not live PayPal money
  movement.
- The planted-content attack is proven to reach discovery and the judge path
  and to trigger STEP_UP in the reported approve/reject browser flows.
- Deferred polish issue: planted Product Description text was not visible in
  Sidd's NovaMart storefront browser view in the last manual check, even though
  STEP_UP mission behavior passed. Do not treat the storefront visibility issue
  as browser-verified fixed.
- `TAMPER_REJECT` is covered by automated tests; it is not presented here as a
  separate browser demo.
