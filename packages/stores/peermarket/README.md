# PeerMarket

PeerMarket is an independent peer-to-peer resale marketplace. It reuses `@recourse/store-core` for the canonical products, cart, search, integer-cent pricing, and HMAC-signed quotes. Listings are honest about condition, the independent seller's unverified status and account age, final-sale terms, and the absence of a warranty.

## Start

Run `npm run store:peermarket` from the repository root. The app listens at **http://127.0.0.1:8803** by default; `PEERMARKET_PORT` overrides the port. Configure `PEERMARKET_QUOTE_SECRET` for stable signatures. Development without a configured secret uses a temporary key; production requires one.

PeerMarket merchant ID is `peermarket`. Quote seller aggregation is deterministic: one seller remains that seller; mixed sellers use `PEERMARKET_MULTI_SELLER`. Quote condition selects the most worn condition in the order `USED_GOOD`, `OPEN_BOX`, `USED_LIKE_NEW`, `NEW`; returns use the minimum, final sale is true if any item is final sale, and the warranty is `No warranty included`.

## Pricing and risk disclosures

All listed products are used or open-box, sold by independent sellers whose identity is not verified by PeerMarket. Listings are final sale, have no returns, and include no warranty. Seller history and condition notes are shown on product pages and included in product content APIs. No hidden content, discounts, add-ons, subscriptions, or protection plans are used.

Standard shipping is 795 cents; Express is 1495 cents. PeerMarket never offers free shipping. Tax is 825 basis points on merchandise only. One HDP-001 with Standard shipping has merchandise subtotal 3900, shipping 795, tax 322, and total **5017 cents ($50.17)**.

## Endpoints

- `GET /health`
- `GET /api/search?q=&category=&brand=&feature=&maxPriceCents=&sort=&condition=`
- `GET /api/products/:sku`
- `GET /api/cart?deliveryMethod=STANDARD|EXPRESS`
- `POST /api/cart/items`, `PATCH /api/cart/items`, `DELETE /api/cart/items?lineId=...`, `POST /api/cart/clear`
- `POST /api/quote`, `GET /api/quotes/:quoteId`, `POST /api/checkout/handoff`
- Pages at `/`, `/search`, `/products/:slug`, `/cart`, `/checkout`, `/checkout/handoff?quoteId=...`

The signed quote format is `recourse.store-quote.v1` (HMAC-SHA256). It contains the seller, condition, return/final-sale terms, and warranty facts. Checkout creates a signed quote and handoff only. The 7B gateway maps `peermarket` to the Recourse PeerMarket Merchant sandbox account, reviews contract risk, and performs later payment steps. Gateway-owned environment variable names are `PAYPAL_PEERMARKET_CLIENT_ID` and `PAYPAL_PEERMARKET_SECRET`; PeerMarket never reads them.

## Checks

```sh
npx vitest run packages/stores/store-core/test packages/stores/peermarket/test --pool=threads --maxWorkers=1 --reporter=verbose
npx tsc --noEmit -p packages/stores/peermarket/tsconfig.json
```
