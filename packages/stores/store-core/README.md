# @recourse/store-core

Shared merchant-neutral catalog and shopping logic for Recourse store applications. It contains canonical product facts and reusable calculations; each merchant owns its offers, prices, stock, sellers, branding, and server.

Boundary rules: this package contains no prices in the canonical catalog, UI, pages, routes, server, merchant policy, secrets, environment reads, or payment-provider integration. Quote signing receives a secret from its caller.

## Public API

The entry point exports the canonical catalog, product lookup, money and pricing helpers, in-memory cart store, catalog search, content/review helpers, and quote signing/verification functions.

```ts
import { CANONICAL_PRODUCTS, calculatePricing } from "@recourse/store-core";

const product = CANONICAL_PRODUCTS[0];
const quoteTotals = calculatePricing({
  lines: [{ product, offer, quantity: 1 }],
  deliveryMethod: "STANDARD",
  policy: { standardShippingCents: 495, expressShippingCents: 1295, taxRateBps: 825 },
});
```

## Tests

Run from the repository root:

```sh
npx vitest run packages/stores/store-core/test
npx tsc --noEmit -p packages/stores/store-core/tsconfig.json
```
