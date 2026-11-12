import { describe, expect, it } from "vitest";
import { AgentError } from "../src/errors.js";
import { HttpMerchantToolTransport } from "../src/merchant-tools.js";

const terms = { condition: "NEW", returnsDays: 30, finalSale: false, subscription: false, giftCard: false, warrantyLabel: "1 year" };
const product = { sku: "JKT-001", slug: "jacket", name: "Jacket", defaultVariant: { size: "M" }, seller: { id: "seller", name: "Seller", verified: true }, advertisedTerms: terms, hiddenContent: [] };
const fetcher = (calls: Array<{ url: string; init?: RequestInit }>, respond: (url: string, init?: RequestInit) => Response): typeof fetch => (async (url: string | URL | Request, init?: RequestInit) => {
  const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  calls.push({ url: href, init });
  return respond(href, init);
}) as typeof fetch;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

describe("fixed merchant transport", () => {
  it("rejects unallowlisted merchants and arbitrary routing fields", async () => {
    const transport = new HttpMerchantToolTransport(fetcher([], () => json({} as never)));
    await expect(transport.searchStore({ merchantId: "evil" as never, query: "x" })).rejects.toMatchObject({ code: "UNKNOWN_MERCHANT" });
    await expect(transport.searchStore({ merchantId: "novamart", query: "x", url: "https://evil" } as never)).rejects.toMatchObject({ code: "INVALID_TOOL_INPUT" });
  });

  it("uses only fixed localhost routes, validates responses, and strips quote signatures", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const transport = new HttpMerchantToolTransport(fetcher(calls, (url) => {
      if (url.includes("/api/search?")) return json({ merchantId: "novamart", count: 1, results: [{ sku: "JKT-001", slug: "jacket", name: "Jacket", estimatedTotalForOneCents: 1000, advertisedUnitPriceCents: 1000, seller: product.seller }] });
      if (url.endsWith("/api/products/JKT-001")) return json(product);
      if (url.endsWith("/api/cart/items")) return json({ cart: { id: "cart_1" }, pricing: { computedTotalCents: 1234 } });
      if (url.endsWith("/api/quote")) return json({ quoteId: "q_1", totalCents: 1234, signature: "secret", hmac: "hidden" });
      return json({}, 404);
    }));
    expect((await transport.searchStore({ merchantId: "novamart", query: "jacket" })).length).toBe(1);
    expect((await transport.getProduct({ merchantId: "novamart", sku: "JKT-001" })).advertisedTerms).toEqual(terms);
    expect(await transport.requestQuote({ merchantId: "novamart", sku: "JKT-001", quantity: 1 })).toEqual({ quoteId: "q_1", quoteTotalCents: 1234, advertisedTotalCents: 1234 });
    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:8801/api/search?q=jacket",
      "http://127.0.0.1:8801/api/products/JKT-001",
      "http://127.0.0.1:8801/api/cart/items",
      "http://127.0.0.1:8801/api/quote",
    ]);
    expect(calls.every((call) => call.init?.redirect === "manual")).toBe(true);
  });

  it("fails closed on redirects, HTTP errors, and malformed advertised terms", async () => {
    const redirected = new HttpMerchantToolTransport(fetcher([], () => new Response(null, { status: 302 })));
    await expect(redirected.getProduct({ merchantId: "novamart", sku: "JKT-001" })).rejects.toMatchObject({ code: "STORE_REDIRECT" });
    const unavailable = new HttpMerchantToolTransport(fetcher([], () => json({}, 503)));
    await expect(unavailable.searchStore({ merchantId: "novamart", query: "jacket" })).rejects.toBeInstanceOf(AgentError);
    const invalid = new HttpMerchantToolTransport(fetcher([], () => json({ ...product, advertisedTerms: undefined })));
    await expect(invalid.getProduct({ merchantId: "novamart", sku: "JKT-001" })).rejects.toMatchObject({ code: "STORE_INVALID_RESPONSE" });
  });
});
