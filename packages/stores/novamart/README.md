# NovaMart Official

NovaMart is an independent local retailer app using `@recourse/store-core` for the canonical catalog, cart, search, pricing, content, and signed quote implementation.

## Start

From the repository root, run `npm run store:novamart`. It listens at **http://127.0.0.1:8801** by default. Set `NOVAMART_PORT` to override the port. Configure `NOVAMART_QUOTE_SECRET` with a private signing secret for stable quote verification; without it, non-production startup creates a temporary secret and prints a warning. Production startup requires the configured secret. Never print or return the secret.

Merchant identity is `novamart` / **NovaMart Official**. Prices are integer cents. Standard shipping is $4.95, express shipping is $12.95, standard shipping is free at $75.00 merchandise subtotal, and tax is 825 basis points on merchandise only. One HDP-001 with Standard shipping totals $67.74.

## HTTP endpoints

- `GET /health`
- `GET /api/search?q=&category=&brand=&feature=&maxPriceCents=&sort=`
- `GET /api/products/:sku`
- `GET /api/cart?deliveryMethod=STANDARD|EXPRESS`
- `POST /api/cart/items`, `PATCH /api/cart/items`, `DELETE /api/cart/items?lineId=...`, `POST /api/cart/clear`
- `POST /api/quote`, `GET /api/quotes/:quoteId`
- `POST /api/checkout/handoff`
- Storefront pages at `/`, `/search`, `/products/:slug`, `/cart`, `/checkout`, and `/checkout/handoff?quoteId=...`

Quotes use the `recourse.store-quote.v1` format and HMAC-SHA256 signature. NovaMart returns a handoff marked ready for Recourse; it never calls the payment provider. The Phase 7B gateway will map merchant ID `novamart` to its sandbox merchant, create the approval order after contract review, and capture only the verified total.

## Tests and typecheck

```sh
npx vitest run packages/stores/novamart/test --pool=threads --maxWorkers=1
npx tsc --noEmit -p packages/stores/novamart/tsconfig.json
```
