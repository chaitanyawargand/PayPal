# DealDemon

DealDemon is a local, fictional discount-store evaluation app. Its 20 deterministic merchant-content attacks are documented in its test manifest and the API endpoint `/api/attack-manifest`; that manifest is evaluation metadata. The storefront itself contains deliberately conflicting advertised and quoted content for controlled Recourse testing. It makes no ALLOW/BLOCK/STEP_UP decisions.

## Start

Run `npm run store:dealdemon` from the repository root. It listens at **http://127.0.0.1:8802** by default; `DEALDEMON_PORT` overrides the port. Set `DEALDEMON_QUOTE_SECRET` for stable signatures. Development without a secret uses an ephemeral key; production requires a configured key.

## Pricing and quotes

Advertised Standard shipping is 695 cents, Express is 1595 cents, and tax is 825 basis points on merchandise. DealDemon quotes deterministically apply manifest-defined transformations to cart lines. They are signed as constructed, including deliberately inconsistent totals for the designated integrity case and an invalidated signature for the post-signing tamper case.

The manifest has one attack per canonical SKU, in ID order DD-01 through DD-20. The cases cover hidden and visible merchant content, price and quantity changes, added products/fees/subscriptions/gift cards, seller/terms swaps, duplicate shipping, coupon removal, arithmetic inconsistency, and signature tampering. `expectedOutcome` is evaluation metadata only; DealDemon does not make Recourse decisions.

## Endpoints

- `GET /health`, `GET /api/attack-manifest`
- `GET /api/search?q=&category=&brand=&feature=&maxPriceCents=&sort=`
- `GET /api/products/:sku`
- `GET /api/cart?deliveryMethod=STANDARD|EXPRESS`
- `POST /api/cart/items`, `PATCH /api/cart/items`, `DELETE /api/cart/items?lineId=...`, `POST /api/cart/clear`
- `POST /api/quote`, `GET /api/quotes/:quoteId`, `POST /api/checkout/handoff`
- Pages at `/`, `/search`, `/products/:slug`, `/cart`, `/checkout`, and `/checkout/handoff?quoteId=...`

Checkout returns a signed quote and a Recourse handoff only. DealDemon has no payment SDK, credentials, order creation, approval, or capture implementation. Gateway-owned credential names are `PAYPAL_DEALDEMON_CLIENT_ID` and `PAYPAL_DEALDEMON_SECRET`; DealDemon never reads them.

## Checks

```sh
npx vitest run packages/stores/store-core/test packages/stores/dealdemon/test --pool=threads --maxWorkers=1 --reporter=verbose
npx tsc --noEmit -p packages/stores/dealdemon/tsconfig.json
```
