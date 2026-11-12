# Recourse — Devpost submission pack

## Project name

Recourse

## Tagline

Shop everything. Trust nothing.

## Short description

Recourse is a pre-payment firewall for AI shopping agents. It checks a
user-signed shopping mission and a merchant-signed quote before the gateway
can ask MockPsp to capture money.

## Long description

AI agents can search and compare products quickly, but merchant-controlled
listings and reviews can contain text that tries to redirect the agent or
override a user's budget. Recourse treats that content as untrusted data and
keeps the payment decision behind a separate gateway.

Before the autonomous flow starts, the user reviews and signs a mission that
sets the item, quantity, condition, merchant bounds, exclusions, and hard
all-in budget cap. The agent discovers and ranks offers, while merchants issue
signed quotes. The gateway independently verifies the quote and applies
deterministic rules before calling MockPsp. Ambiguous cases pause at `STEP_UP`
for a human decision. A planted instruction can tighten review, but cannot
change the signed mission, quote, payment amount, or gateway authority.

## Inspiration / problem

Shopping agents consume content written by sellers and third parties. A
malicious review or product description can tell an agent to ignore the user's
budget, add an unrelated item, or approve a purchase. We wanted the system to
make one boundary explicit: being persuaded by a listing must not give an agent
the ability to spend.

## What it does

- Drafts a shopping mission and asks the user to resolve missing details before
  signing.
- Discovers offers across NovaMart, DealDemon, and PeerMarket.
- Treats merchant listing text as untrusted data and applies a deterministic
  risk path that can request STEP_UP or block a candidate.
- Verifies merchant-signed quotes against the selected merchant, SKU,
  quantity, computed total, and signed cap.
- Lets a human approve or reject only a paused STEP_UP decision.
- Uses MockPsp for capture and issues verifiable Evidence for completed
  payments.

## How it works

1. The user reviews and signs a mission with a hard all-in cap.
2. The autonomous agent searches merchant storefronts, fetches listing data,
   requests quotes, and ranks candidates. Listing text stays data; it is not
   appended to the mission or sent as an instruction to AgentBrain.
3. The gateway verifies the selected merchant's signed quote and applies the
   deterministic payment policy.
4. `ALLOW` may proceed to capture. `STEP_UP` pauses at $0 until human approval;
   rejection excludes the candidate. `BLOCK` excludes and may retry through a
   fresh gateway run. `TAMPER_REJECT` aborts at $0.
5. MockPsp enforces idempotent capture. Completed payments produce signed,
   verifiable Evidence.

## How we built it

The project is a TypeScript and Node.js application. `packages/app` contains
the Control Center and mission UI. `packages/phase7-agent` implements
discovery and autonomous mission orchestration; `packages/phase7-contracts`
defines the run and candidate contracts. Three separate storefront packages
provide merchant listings and signed quotes. `packages/phase7-host` verifies
quotes and resolves signed intent, `packages/engine` makes deterministic
payment decisions, and `packages/phase7-gateway` is the only component that
executes payment through the PSP port. `packages/phase7-judge` provides the
tightening-only judge boundary and optional Gemini adapter. `packages/psp`
contains MockPsp. Evidence and receipt verification live in
`packages/evidence` and `packages/ledger`.

The UI uses HTML, CSS, and browser JavaScript. Zod validates API and model data;
Vitest covers unit and integration behavior. The app uses Node's HTTP and
SQLite APIs, Node crypto for HMAC and Ed25519 operations, and optional Gemini
access through `fetch`. The demo payment provider is MockPsp only.

## Security model

The agent, merchant content, and model output are untrusted. The user-signed
mission defines what can be bought and the maximum all-in amount. The gateway
verifies merchant signatures and payment fields, applies server-side computed
totals and deterministic rules, and is the sole money mover. Capture is
idempotent and bounded by the signed cap. A quote/signature mismatch or payment
field mutation is `TAMPER_REJECT` and aborts with $0. A `BLOCK` excludes the
candidate; applicable retries use fresh gateway runs. Four unsuccessful
attempts end in `NO_PURCHASE` with $0. Optional Gemini output is advisory and
cannot loosen the deterministic decision or approve payment.

Attack Lab content can tighten a matching candidate to STEP_UP. It cannot
change the signed mission or quote or force a capture. The planted content is
not an instruction to AgentBrain. The last manual browser check found that
planted Product Description text did not appear on the NovaMart product page;
that storefront visibility polish issue is deferred and is not claimed as
browser-verified fixed.

## Demo script (3–4 minutes)

**0:00–0:25 — Set up the problem.** Show the Control Center and explain that
merchant content is untrusted while the agent has no direct payment authority.

**0:25–1:15 — Normal purchase.** Draft and review a NovaMart headphones
mission with a $70 all-in hard cap. Sign and start it. Show `COMPLETED`, 6,774
cents captured once, and Evidence `VALID`.

**1:15–2:25 — Plant an attack and approve STEP_UP.** In Attack Lab, register a
NovaMart/HDP-001 content instruction. Show the active registration, then start
the mission. Point out that it pauses at STEP_UP with $0 captured. Approve the
pause and show one 6,774-cent capture and Evidence `VALID`. The planted text
was not visible in the NovaMart storefront during the last browser check; do
not imply that storefront visibility has been fixed.

**2:25–3:25 — Reject STEP_UP.** Plant the attack for the reject run, start the
mission, and reject the pause. Show the candidate exclusion, `NO_PURCHASE`, and
$0.00 captured.

**3:25–3:50 — Close on the boundary.** Summarize: listing manipulation can
trigger review, but the gateway verifies the quote and remains in charge of
money movement.

The reported browser outcomes for these runs are recorded below. Do not replay
the completed missions for this submission; use the existing run history or
recorded captures for the video.

## Accomplishments

- Built a signed mission flow that requires user confirmation before
  autonomous execution.
- Connected three distinct local merchant storefronts to autonomous offer
  discovery.
- Kept listing-risk review separate from quote signing and payment execution.
- Verified the normal NovaMart $70-cap flow completed for 6,774 cents with
  Evidence `VALID`.
- Sidd reported a planted-content run pausing at STEP_UP with $0, then
  capturing 6,774 cents exactly once after approval with Evidence `VALID`.
- Sidd reported a second planted-content run pausing at STEP_UP, then ending
  `NO_PURCHASE` with $0 after rejection.
- Prior happy-path and clarification/no-purchase browser gates passed.

## Challenges and known limitations

The security boundary spans agent suggestions, merchant-signed quote data,
user-signed limits, and payment execution. Keeping these distinct while still
making the autonomous experience useful was the main integration challenge.

This is a prototype and uses MockPsp, not live PayPal money movement. Planted
Product Description text was absent from the NovaMart storefront in the last
manual browser check even though the reported judge and STEP_UP behavior
worked. Storefront visibility is a deferred polish issue. `TAMPER_REJECT` is
covered by automated tests; it is not claimed as a separate browser demo.

## What we learned

Separating agent capability from payment authority makes a useful security
boundary. The agent can find and compare offers without holding the power to
capture. Signed intent and quote verification let the gateway check what the
user authorized against what the merchant actually offered. Untrusted content
needs an explicit path into risk review without becoming an instruction to the
agent or a payment input.

## What's next

- Finish the NovaMart storefront projection so planted Product Description
  content is visibly rendered as inert text, then have Sidd verify it in the
  browser.
- Continue testing merchant, SKU, and placement scoping in the running
  storefront processes.
- Improve review tooling for gateway events and Evidence while keeping
  payment authority in the gateway.

## Technologies used

TypeScript, Node.js, HTML, CSS, browser JavaScript, Node HTTP, Node SQLite,
Zod, Vitest, Node crypto (HMAC-SHA256 and Ed25519), optional Gemini API via
`fetch`, and MockPsp.
