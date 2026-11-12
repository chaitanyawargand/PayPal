import {
  formatUsd,
  PRODUCT_CATEGORIES,
  type CanonicalProduct,
  type DeliveryMethod,
  type ProductReview,
} from "../../store-core/src/index.js";
import type { NovaMartStorefront } from "./storefront.js";

export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
function visual(product: CanonicalProduct, large = false): string {
  const [a, b] = product.visual.palette;
  const gradientId = `g-${product.sku}`;
  const icon =
    product.visual.icon === "headphones"
      ? `<path d="M42 68V56a38 38 0 0 1 76 0v12M42 65h16v34H46a8 8 0 0 1-8-8V73a8 8 0 0 1 4-8zm76 0h-16v34h12a8 8 0 0 0 8-8V73a8 8 0 0 0-4-8z"/>`
      : product.visual.icon === "backpack"
        ? `<path d="M58 43a22 22 0 0 1 44 0h9a9 9 0 0 1 9 9v48H40V52a9 9 0 0 1 9-9h9zm0 0v-4a22 22 0 0 1 44 0v4M55 66h50v23H55zM44 65h12v26H44m48-26h12v26H92"/>`
        : product.visual.icon === "shoe"
          ? `<path d="M47 38l18 4 13 30 23 12 26 8v11H36V86l11-7zM38 91h96M65 47l19 5M70 58l20 5M62 83l15-4"/>`
          : `<path d="M50 28L67 20h26l17 8 16 20-13 10-8-9v48H55V49l-8 9-13-10zM80 22v73M58 63h14m16 0h14"/>`;
  return `<div class="visual${large ? " product-visual" : ""}" aria-label="${escapeHtml(product.name)} illustration"><svg viewBox="0 0 160 120" role="img" aria-hidden="true"><defs><linearGradient id="${gradientId}" x2="1" y2="1"><stop stop-color="${escapeHtml(a)}"/><stop offset="1" stop-color="${escapeHtml(b)}"/></linearGradient></defs><circle cx="80" cy="57" r="48" fill="#ffffff" opacity=".56"/><g fill="url(#${gradientId})" stroke="#203d4b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${icon}</g><text x="80" y="112" text-anchor="middle" font-size="8" fill="#203d4b">${escapeHtml(product.visual.motif)}</text></svg></div>`;
}
function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · NovaMart Official</title><link rel="stylesheet" href="/assets/app.css"></head><body><div class="topnote">Recourse Protected Checkout · Transparent totals before you continue</div><header><div class="shell"><div class="headrow"><a class="brand" href="/">NovaMart</a><form class="search" action="/search" method="get"><input name="q" aria-label="Search products" placeholder="Search jackets, headphones, shoes…"><button>Search</button></form><a href="/cart">Cart (<span data-cart-count>0</span>)</a></div><nav>${PRODUCT_CATEGORIES.map((c) => `<a href="/search?category=${encodeURIComponent(c.id)}">${escapeHtml(c.label)}</a>`).join("")}</nav></div></header><div class="trust">Verified official retailer · Clear itemized pricing · 30-day returns · No subscriptions or surprise add-ons</div><main>${body}</main><footer><div class="shell">NovaMart Official · Verified Official Retailer · Every quote is signed for Recourse review.</div></footer><script src="/assets/client.js" defer></script></body></html>`;
}
export function productCard(
  product: CanonicalProduct,
  offer: any,
  estimate: number,
): string {
  return `<article class="card">${visual(product)}<span class="badge">Verified Official Retailer</span><p class="muted">${escapeHtml(product.brand)} · ★ ${escapeHtml(offer.rating)} (${escapeHtml(offer.reviewCount)} reviews)</p><h3><a href="/products/${encodeURIComponent(product.slug)}">${escapeHtml(product.name)}</a></h3><ul>${product.features
    .slice(0, 2)
    .map((f) => `<li>${escapeHtml(f)}</li>`)
    .join(
      "",
    )}</ul><p class="price">${formatUsd(offer.unitPriceCents)}</p><p class="muted">Estimated total for one: ${formatUsd(estimate)} · ${escapeHtml(offer.deliveryEstimateLabel)} · ${escapeHtml(offer.stock)} in stock</p><p>${escapeHtml(offer.seller.name)}</p><div class="card-actions"><a href="/products/${encodeURIComponent(product.slug)}">View Details</a><form data-cart-add><input type="hidden" name="sku" value="${escapeHtml(product.sku)}"><input type="hidden" name="quantity" value="1"><button>Add to Cart</button></form></div></article>`;
}
export function renderHome(store: NovaMartStorefront): string {
  const sections = PRODUCT_CATEGORIES.map((category) => {
    const items = store.search({ category: category.id });
    return `<section class="section shell"><div class="section-head"><h2>${escapeHtml(category.label)}</h2><a href="/search?category=${encodeURIComponent(category.id)}">Shop category</a></div><div class="grid">${items.map(({ product, offer, estimatedTotalForOneCents }) => productCard(product, offer, estimatedTotalForOneCents)).join("")}</div></section>`;
  }).join("");
  return shell(
    "Official outdoor and everyday gear",
    `<section class="hero"><div class="shell"><span class="badge">NovaMart Official · Verified retailer</span><h1>Gear for the miles and moments ahead.</h1><p>Shop carefully selected outdoor and everyday essentials with clear prices, itemized tax and shipping, and a signed quote for Recourse review.</p><form class="search" action="/search"><input name="q" placeholder="What are you looking for?"><button>Explore products</button></form><div class="seller">All-in totals shown before checkout · Verified sellers · 30-day returns · No add-ons</div></div></section>${sections}`,
  );
}
export function renderSearch(
  store: NovaMartStorefront,
  query: Record<string, string>,
): string {
  const results = store.search({
    query: query.q,
    category: query.category,
    brand: query.brand,
    feature: query.feature,
    maxUnitPriceCents: query.maxPrice
      ? Math.round(Number(query.maxPrice) * 100)
      : undefined,
    sort: (query.sort as never) || "relevance",
  });
  const cards = results
    .map((r) => productCard(r.product, r.offer, r.estimatedTotalForOneCents))
    .join("");
  return shell(
    "Search products",
    `<div class="shell section"><h1>Search NovaMart</h1><form class="filterrow" action="/search"><input name="q" value="${escapeHtml(query.q ?? "")}" placeholder="Keywords"><select name="category"><option value="">All categories</option>${PRODUCT_CATEGORIES.map((c) => `<option value="${c.id}" ${query.category === c.id ? "selected" : ""}>${escapeHtml(c.label)}</option>`).join("")}</select><input name="brand" value="${escapeHtml(query.brand ?? "")}" placeholder="Brand"><input name="feature" value="${escapeHtml(query.feature ?? "")}" placeholder="Feature"><input name="maxPrice" type="number" min="0" step="0.01" value="${escapeHtml(query.maxPrice ?? "")}" placeholder="Max price ($)"><select name="sort">${["relevance", "price_asc", "price_desc", "rating"].map((s) => `<option ${query.sort === s ? "selected" : ""}>${s}</option>`).join("")}</select><button>Apply filters</button></form><p>${results.length} result${results.length === 1 ? "" : "s"}</p>${results.length ? `<div class="grid">${cards}</div>` : `<div class="panel empty"><h2>No products found</h2><p>Try a broader search or clear a filter.</p><a href="/search">Clear filters</a></div>`}</div>`,
  );
}
export function renderProduct(
  store: NovaMartStorefront,
  product: CanonicalProduct,
): string {
  const detail = store.productDetail(product.sku)!;
  const offer = detail.offer;
  const estimate = store.search({ query: product.sku })[0]!
    .estimatedTotalForOneCents;
  const reviews = detail.reviews;
  return shell(
    product.name,
    `<div class="shell section"><p><a href="/">Home</a> / <a href="/search?category=${product.category}">${escapeHtml(product.category.replaceAll("_", " "))}</a> / ${escapeHtml(product.name)}</p><div class="two-col">${visual(product, true)}<section><p>${escapeHtml(product.brand)} · ★ ${escapeHtml(offer.rating)} · ${reviews.length} recent reviews of ${escapeHtml(offer.reviewCount)}</p><h1>${escapeHtml(product.name)}</h1><p class="price">${formatUsd(offer.unitPriceCents)}</p><p>Estimated total for one with Standard delivery: <strong>${formatUsd(estimate)}</strong></p><p>${escapeHtml(offer.stock)} available · ${escapeHtml(offer.deliveryEstimateLabel)}</p><form data-cart-add><input type="hidden" name="sku" value="${escapeHtml(product.sku)}"><label>Quantity<input type="number" name="quantity" min="1" max="${offer.stock}" value="1"></label>${product.variantOptions.map((o) => `<label>${escapeHtml(o.label)}<select name="variant:${escapeHtml(o.id)}">${o.values.map((v) => `<option value="${escapeHtml(v)}" ${product.defaultVariant[o.id] === v ? "selected" : ""}>${escapeHtml(v)}</option>`).join("")}</select></label>`).join("")}<button>Add to Cart</button></form><p data-cart-message aria-live="polite"></p><div class="seller"><strong>NovaMart Official · Verified</strong><br>Ships from ${escapeHtml(offer.shipsFrom)} · ${escapeHtml(offer.returnsDays)}-day returns<br>${escapeHtml(offer.warrantyLabel)}</div></section></div><section class="section"><h2>Highlights</h2><ul>${product.features.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul><h2>About this product</h2><p>${escapeHtml(detail.longDescription ?? product.longDescription)}</p><h2>Specifications</h2><table class="specs">${Object.entries(
      product.specifications,
    )
      .map(
        ([k, v]) =>
          `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`,
      )
      .join(
        "",
      )}</table><h2>Shipping & returns</h2><p>${escapeHtml(offer.deliveryEstimateLabel)} from ${escapeHtml(offer.shipsFrom)}. Returns accepted within ${offer.returnsDays} days. ${escapeHtml(offer.warrantyLabel)}.</p><h2>Customer reviews</h2><p>Showing ${reviews.length} recent reviews of ${offer.reviewCount}</p>${reviews.map(reviewHtml).join("")}</section></div>`,
  );
}
function reviewHtml(r: ProductReview): string {
  return `<article class="review"><strong>${escapeHtml(r.title)}</strong><p>★ ${r.rating} · ${escapeHtml(r.author)} · ${escapeHtml(r.date)} · ${r.verifiedPurchase ? "Verified purchase" : ""}</p><p>${escapeHtml(r.body)}</p></article>`;
}
type CartView = ReturnType<NovaMartStorefront["cartView"]>;
function totals(view: CartView): string {
  const p = view.pricing;
  return `<div class="totals"><div class="totalrow"><span>Subtotal</span><strong data-subtotal>${formatUsd(p.merchandiseSubtotalCents)}</strong></div><div class="totalrow"><span>Shipping</span><strong data-shipping>${formatUsd(p.shippingCents)}</strong></div><div class="totalrow"><span>Tax</span><strong data-tax>${formatUsd(p.taxCents)}</strong></div><div class="totalrow grand"><span>Total</span><strong data-total>${formatUsd(p.computedTotalCents)}</strong></div></div>`;
}
export function renderCart(view: CartView): string {
  const lines = view.cart.lines
    .map(
      (line) =>
        `<div class="line"><div><a href="/products/${encodeURIComponent(line.slug)}"><strong>${escapeHtml(line.name)}</strong></a><p class="muted">${Object.entries(
          line.variant,
        )
          .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`)
          .join(
            " · ",
          )}</p><span>${formatUsd(line.unitPriceCents)} each</span></div><label>Qty<input data-quantity data-line-id="${escapeHtml(line.id)}" type="number" min="0" value="${line.quantity}"></label><strong>${formatUsd(line.amountCents)}</strong><button data-remove data-line-id="${escapeHtml(line.id)}">Remove</button></div>`,
    )
    .join("");
  return shell(
    "Your cart",
    `<div class="shell section"><h1>Your cart</h1>${view.cart.lines.length ? `${lines}${totals(view)}<p class="muted">Your signed quote at checkout will contain these same itemized totals.</p><div class="inline"><label>Delivery<select name="deliveryMethod"><option value="STANDARD" ${view.deliveryMethod === "STANDARD" ? "selected" : ""}>Standard</option><option value="EXPRESS" ${view.deliveryMethod === "EXPRESS" ? "selected" : ""}>Express</option></select></label></div><p><a class="button" href="/checkout">Continue to Checkout</a> <button data-clear>Clear cart</button></p>` : `<div class="panel empty"><h2>Your cart is empty</h2><p>Explore verified outdoor and everyday gear.</p><a class="button" href="/">Continue shopping</a></div>`}</div>`,
  );
}
export function renderCheckout(view: CartView): string {
  if (!view.cart.lines.length)
    return shell(
      "Checkout",
      `<div class="shell empty"><h1>Your cart is empty</h1><p>Add an item before checkout.</p><a class="button" href="/">Browse products</a></div>`,
    );
  return shell(
    "Recourse checkout",
    `<div class="shell section"><div class="steps"><strong>Cart</strong><span>› Details</span><span>› Recourse Payment Review</span></div><h1>Review your order</h1><div class="two-col"><section class="panel"><h2>Demo customer details</h2><div class="notice">Sandbox demo — do not enter real personal information. These details are not saved.</div><label>Name<input value="Alex Morgan"></label><label>Email<input value="alex@example.test"></label><fieldset><legend>Delivery method</legend><label class="inline"><input type="radio" name="deliveryMethod" value="STANDARD" ${view.deliveryMethod === "STANDARD" ? "checked" : ""}> Standard</label><label class="inline"><input type="radio" name="deliveryMethod" value="EXPRESS" ${view.deliveryMethod === "EXPRESS" ? "checked" : ""}> Express</label></fieldset><h2>Order summary</h2>${view.cart.lines.map((line) => `<p>${escapeHtml(line.name)} × ${line.quantity} <strong>${formatUsd(line.amountCents)}</strong></p>`).join("")}${totals(view)}<button data-handoff>Continue to Recourse Secure Checkout</button></section><aside class="panel"><h2>PayPal Sandbox via Recourse</h2><p>Recourse verifies the signed quote against the buyer’s signed contract.</p><p>On ALLOW, the PayPal sandbox approval page opens.</p><p>Recourse captures only the verified total.</p><div class="seller">Environment: Sandbox<br>Merchant: Recourse NovaMart Merchant<br>Profile: novamart</div></aside></div></div>`,
  );
}
export function renderHandoff(quote: SignedQuoteView): string {
  return shell(
    "Quote ready for Recourse",
    `<div class="shell section"><div class="status"><h1>Quote locked and ready for Recourse</h1><p>Awaiting Recourse gateway review</p></div><p>Merchant: ${escapeHtml(quote.merchantName)}</p><p>Quote ID: ${escapeHtml(quote.quoteId)}</p><p>Expires: ${escapeHtml(quote.expiresAt)}</p><section class="panel">${quote.lineItems.map((line) => `<div class="totalrow"><span>${escapeHtml(line.label)}</span><strong>${formatUsd(line.amountCents)}</strong></div>`).join("")}<div class="totalrow grand"><span>Grand total</span><strong>${formatUsd(quote.totalCents)}</strong></div></section><p>PayPal order created: No</p><p>Captured amount: $0 so far</p><p><a href="/">Return to NovaMart</a></p></div>`,
  );
}
type SignedQuoteView = {
  merchantName: string;
  quoteId: string;
  expiresAt: string;
  lineItems: { label: string; amountCents: number }[];
  totalCents: number;
};
export function renderNotFound(): string {
  return shell(
    "Page not found",
    `<div class="shell empty"><h1>We couldn’t find that page</h1><p>The link may be outdated or the item may have moved.</p><a class="button" href="/">Return to NovaMart</a></div>`,
  );
}
