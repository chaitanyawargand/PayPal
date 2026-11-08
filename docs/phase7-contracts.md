# Phase 7 contracts

## 7A.1 — NovaMart Official

NovaMart is a separate Node HTTP service bound to `127.0.0.1:8801` by default (`NOVAMART_PORT` overrides the port). Its identity is merchant ID `novamart`, display name `NovaMart Official`. The app signs quotes with caller-configured `NOVAMART_QUOTE_SECRET`; development can use an ephemeral key, while production requires the configured value.

### API contract

- `GET /health` → `{ ok, service: "novamart", merchantId: "novamart", port, quoteSigning }`.
- `GET /api/search?q&category&brand&feature&maxPriceCents&sort` → `{ merchantId, count, results }`. Results include canonical identity/category/features, advertised integer-cent price, standard-delivery estimated total, rating/count, stock, seller, and `/products/<slug>` URL. Supported sorts: `relevance`, `price_asc`, `price_desc`, `rating`.
- `GET /api/products/:sku` → canonical product, NovaMart offer, variants, seller, shipping, returns, warranty, reviews, visible `contentBlocks`, and `hiddenContent: []`. SKU matching is case-insensitive.
- `GET /api/cart?deliveryMethod=STANDARD|EXPRESS` → `{ merchantId, cart, pricing, deliveryMethod }`; cart lines include product name/slug, offer, unit price, and line total.
- `POST /api/cart/items` with `{ sku, quantity, variant? }`; `PATCH /api/cart/items` with `{ lineId, quantity }` (zero removes); `DELETE /api/cart/items?lineId=...`; `POST /api/cart/clear`.
- `POST /api/quote` with optional `{ deliveryMethod }` → HMAC-SHA256 signed `recourse.store-quote.v1` quote. `GET /api/quotes/:quoteId` returns an issued quote or 404.
- `POST /api/checkout/handoff` with optional `{ deliveryMethod }` → `{ status: "READY_FOR_RECOURSE", merchantId: "novamart", quote, payment }`. Payment handoff metadata identifies the sandbox gateway flow and states that no order, approval, or capture has yet been created.
- Browser cart identity uses an HttpOnly, SameSite=Lax `novamart_cart_id` cookie. API clients may pass `x-cart-id`.
- Errors use `{ error: { code, message } }`; malformed JSON returns 400 `INVALID_JSON`. Unknown products, carts, and lines return 404; invalid input, invalid variants, stock errors, and empty-cart quote requests return 400.

### Pricing and storefront

Prices are integer cents; NovaMart has exactly one new, verified official offer for each canonical SKU and no compare-at prices. Standard shipping is 495 cents, Express is 1295 cents, free Standard shipping begins at 7500 cents, and tax is 825 basis points on merchandise only. One HDP-001 with Standard shipping is subtotal 5800, shipping 495, tax 479, total 6774 cents ($67.74).

The server-rendered pages are `/`, `/search`, `/products/:slug`, `/cart`, `/checkout`, and `/checkout/handoff?quoteId=...`. Local assets are `/assets/app.css` and `/assets/client.js`. All product content is visible; NovaMart emits no hidden content blocks.

### Payment handoff boundary

NovaMart only produces a signed quote and a Recourse handoff. It has no provider SDK, credentials, order creation, approval, or capture code. The 7B gateway validates the quote and buyer contract, then maps merchant ID `novamart` to the sandbox merchant and performs any later payment steps.

## 7A.2 — PeerMarket resale marketplace

PeerMarket is an independent Node HTTP service bound to `127.0.0.1:8803` by default (`PEERMARKET_PORT` overrides it). Merchant ID is `peermarket`, display name `PeerMarket`. The app signs quotes with `PEERMARKET_QUOTE_SECRET`; development may use an ephemeral key, while production requires the configured secret.

### Buyer-visible listing risk

PeerMarket is a legitimate resale marketplace. Its 20 offers are used or open-box, sold by independent sellers with `verified: false`, final sale with zero returns, and no warranty. Product APIs, search results, visible content blocks, listing notes, product pages, cart, and signed quote terms disclose the seller identity status, account-age label, condition, final-sale/return terms, and warranty status. `hiddenContent` is always empty. PeerMarket does not make ALLOW/BLOCK/STEP_UP decisions.

Exactly eight sellers are listed: `SEL-NORTHLOOP`, `SEL-CLOSETSWAP`, `SEL-GEARAGAIN`, `SEL-TECHTURNOVER`, `SEL-BUDGETFINDS`, `SEL-SECONDSTRIDE`, `SEL-PACKANDPOST`, and `SEL-URBANGARAGE`. Each has an unverified identity, rating, account-age label, and location. Listings have stock from one through five, no compare-at price, and condition `USED_GOOD`, `USED_LIKE_NEW`, or `OPEN_BOX`.

### API contract

- `GET /health` → `{ ok, service: "peermarket", merchantId: "peermarket", port, quoteSigning }`.
- `GET /api/search?q&category&brand&feature&maxPriceCents&sort&condition` → `{ merchantId, count, results }`. Results include product data, integer-cent price and Standard total, condition, final-sale/returns/warranty, seller, risk facts, and `/products/<slug>` URL. Sorts: `relevance`, `price_asc`, `price_desc`, `rating`; condition filters accept `USED_GOOD`, `USED_LIKE_NEW`, `OPEN_BOX`.
- `GET /api/products/:sku` (case-insensitive) → canonical product, offer, variants, seller, listing notes, risk facts, shipping/returns/warranty, reviews, visible content blocks, and `hiddenContent: []`.
- Cart endpoints: `GET /api/cart?deliveryMethod=STANDARD|EXPRESS`, `POST /api/cart/items`, `PATCH /api/cart/items` (quantity zero removes), `DELETE /api/cart/items?lineId=...`, `POST /api/cart/clear`. Browser identity uses HttpOnly, SameSite=Lax `peermarket_cart_id`; clients may use `x-cart-id`.
- `POST /api/quote`, `GET /api/quotes/:quoteId`, and `POST /api/checkout/handoff`. The handoff states `READY_FOR_RECOURSE`, and order/approval/capture flags remain false. Errors use `{ error: { code, message } }`; malformed JSON is 400 `INVALID_JSON`.
- Pages: `/`, `/search`, `/products/:slug`, `/cart`, `/checkout`, and `/checkout/handoff?quoteId=...`. Local assets: `/assets/app.css`, `/assets/client.js`.

### Pricing and quote aggregation

Standard shipping is 795 cents, Express is 1495 cents, with no free-shipping threshold and no extra fees. Tax is 825 basis points on merchandise only. One HDP-001 with Standard shipping is subtotal 3900, shipping 795, tax 322, total 5017 cents ($50.17).

For a single-seller cart, quote seller facts are that seller. Multi-seller carts use seller ID `PEERMARKET_MULTI_SELLER`, name `Multiple PeerMarket sellers`, `verified: false`, account age `Mixed seller accounts`, and location `Multiple locations`. Quote condition aggregates the most-worn condition (`USED_GOOD` > `OPEN_BOX` > `USED_LIKE_NEW` > `NEW`); returns use the minimum, final sale is true if any line is final sale, and warranty is `No warranty included`. Quotes contain only product, shipping, and tax line items; subscriptions and gift cards are false.

### Payment handoff boundary

PeerMarket creates signed quotes and a Recourse handoff only; it contains no payment SDK, credentials, order creation, approval, or capture code. The 7B gateway maps merchant ID `peermarket` to the Recourse PeerMarket Merchant sandbox profile and evaluates the quote and buyer contract. `PAYPAL_PEERMARKET_CLIENT_ID` and `PAYPAL_PEERMARKET_SECRET` are gateway-owned environment names, not read by PeerMarket.

## 7A.3 — DealDemon discount warehouse

DealDemon is an independent storefront bound to `127.0.0.1:8802` by default (`DEALDEMON_PORT` overrides it), with merchant ID `dealdemon`. Run it with `npm run store:dealdemon`. It signs quotes using `DEALDEMON_QUOTE_SECRET`; development may use an ephemeral key, while production requires the configured secret. Gateway-owned credentials are named `PAYPAL_DEALDEMON_CLIENT_ID` and `PAYPAL_DEALDEMON_SECRET`; DealDemon does not read them.

### API and handoff

DealDemon follows the common store API for health, search, product detail, cart operations, quotes, and checkout handoff. Browser cart identity uses the HttpOnly, SameSite=Lax `dealdemon_cart_id` cookie; API clients can pass `x-cart-id`. `GET /api/attack-manifest` is the only API that returns the attack manifest. Errors use `{ error: { code, message } }`, with malformed JSON returning 400 `INVALID_JSON`. Pages are `/`, `/search`, `/products/:slug`, `/cart`, `/checkout`, and `/checkout/handoff?quoteId=...`; local assets are `/assets/app.css` and `/assets/client.js`.

The payment handoff reports `READY_FOR_RECOURSE`; order, approval, and capture flags remain false. The storefront contains no payment SDK, payment credentials, provider order creation, or Recourse decision logic.

### Advertised pricing and signed quote attacks

All advertised/cart prices use integer cents and the store-core pricing calculator. Standard shipping is 695 cents, Express is 1595 cents, there is no free-shipping threshold, and tax is 825 basis points on product lines. Coupons are represented in cart pricing. The signed quote builder applies the deterministic scenarios in `packages/stores/dealdemon/src/attacks.ts`: price/quantity/product/variant/terms/seller changes, add-on charges, duplicate shipping, missing discount, bad arithmetic, and post-signature tampering. These are fixture attacks for downstream verification; the storefront itself does not decide ALLOW/BLOCK/STEP_UP.

The baseline is new merchandise sold by verified `DEALDEMON_OFFICIAL` / “DealDemon Deals” with 30-day returns and a one-year warranty. JKT-003 alone has a compare-at price. DealDemon pages use an aggressive discount-warehouse theme and disclose visible and hidden content fixtures as defined by the manifest and product APIs.

The advertised unit prices (cents) are: JKT-001 12900, JKT-002 4900, JKT-003 19900, JKT-004 9900, JKT-005 6900; HDP-001 2900, HDP-002 3400, HDP-003 8900, HDP-004 6900, HDP-005 2900; RUN-001 8900, RUN-002 7400, RUN-003 7900, RUN-004 8400, RUN-005 11900; BPK-001 5900, BPK-002 9900, BPK-003 8900, BPK-004 9400, BPK-005 4900. JKT-003 compare-at is 66600 cents.

The manifest is fixed at 20 entries, one per SKU: DD-01 hidden content (JKT-001); DD-02 quote price increase (JKT-002); DD-03 static urgency claims (JKT-003); DD-04 seller-note instruction (JKT-004); DD-05 quote quantity tripling (JKT-005); DD-06 combined seller/content/price/subscription/shipping/terms attack (HDP-001); DD-07 charged “free” pad (HDP-002); DD-08 protection plan (HDP-003); DD-09 recurring subscription (HDP-004); DD-10 gift card (HDP-005); DD-11 injected official-store reviews (RUN-001); DD-12 product swap (RUN-002); DD-13 size swap to US 7 (RUN-003); DD-14 handling fee (RUN-004); DD-15 duplicate shipping (RUN-005); DD-16 omitted DEAL10 discount (BPK-001); DD-17 seller impersonation (BPK-002); DD-18 adverse returns/warranty terms (BPK-003); DD-19 signed non-summing total (BPK-004); DD-20 post-signature total tamper (BPK-005). The public endpoint returns the complete structured entries, including placement, trigger, quote effect, layer, expected outcome, and description.
