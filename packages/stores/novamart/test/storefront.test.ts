import { describe, expect, it } from "vitest";
import { CANONICAL_PRODUCTS, verifySignedQuote } from "../../store-core/src/index.js";
import { NovaMartServiceError, NovaMartStorefront } from "../src/storefront.js";

describe("NovaMart storefront service", () => {
  it("computes the HDP-001 Standard estimate as $67.74", () => {
    const store = new NovaMartStorefront("test-secret");
    const result = store.search({ query: "HDP-001" })[0]!;
    expect(result.product.sku).toBe("HDP-001");
    expect(result.estimatedTotalForOneCents).toBe(6774);
  });
  it("applies free standard shipping at the threshold", () => {
    const store = new NovaMartStorefront("test-secret");
    const cart = store.getCart("cart");
    store.addCartItem(cart.id, "HDP-001", 2);
    const view = store.cartView(cart.id);
    expect(view.pricing.merchandiseSubtotalCents).toBe(11600);
    expect(view.pricing.shippingCents).toBe(0);
  });
  it("creates a verifiable quote with only generated product, shipping, and tax lines", () => {
    const store = new NovaMartStorefront("test-secret");
    const cart = store.getCart("cart");
    store.addCartItem(cart.id, "HDP-001", 1);
    const quote = store.createQuote(cart.id);
    expect(verifySignedQuote(quote, "test-secret")).toBe(true);
    expect(quote.lineItems.map((line) => line.kind)).toEqual([
      "PRODUCT",
      "SHIPPING",
      "TAX",
    ]);
    expect(quote.seller.verified).toBe(true);
    expect(quote.terms.subscription).toBe(false);
    expect(quote.terms.giftCard).toBe(false);
    expect(quote.totalCents).toBe(6774);
  });
  it("advertises add-on terms for every product and matches each signed quote", () => {
    const store = new NovaMartStorefront("test-secret");
    for (const product of CANONICAL_PRODUCTS) {
      const detail = store.productDetail(product.sku)!;
      expect(detail.advertisedTerms).toEqual({
        condition: detail.offer.condition,
        returnsDays: detail.offer.returnsDays,
        finalSale: detail.offer.finalSale,
        subscription: false,
        giftCard: false,
        warrantyLabel: detail.offer.warrantyLabel,
      });
      const cart = store.getCart(`terms-${product.sku}`);
      store.addCartItem(cart.id, product.sku, 1);
      const quote = store.createQuote(cart.id);
      expect(detail.advertisedTerms.subscription).toBe(quote.terms.subscription);
      expect(detail.advertisedTerms.giftCard).toBe(quote.terms.giftCard);
    }
  });
  it("detects quote tampering with both the total and a line amount", () => {
    const store = new NovaMartStorefront("test-secret");
    const cart = store.getCart("cart");
    store.addCartItem(cart.id, "HDP-001", 1);
    const quote = store.createQuote(cart.id);
    expect(verifySignedQuote({ ...quote, totalCents: 1 }, "test-secret")).toBe(
      false,
    );
    expect(
      verifySignedQuote(
        {
          ...quote,
          lineItems: quote.lineItems.map((l, i) =>
            i ? l : { ...l, amountCents: l.amountCents + 1 },
          ),
        },
        "test-secret",
      ),
    ).toBe(false);
  });
  it("returns deep copies of issued quotes and leaves the cart intact", () => {
    const store = new NovaMartStorefront("test-secret");
    const cart = store.getCart("cart");
    store.addCartItem(cart.id, "HDP-001", 1);
    const quote = store.createQuote(cart.id);
    quote.items[0]!.variant.colour = "tampered";
    const saved = store.getIssuedQuote(quote.quoteId)!;
    expect(saved.items[0]!.variant.colour).not.toBe("tampered");
    expect(store.cartView(cart.id).cart.lines).toHaveLength(1);
  });
  it("creates the defined handoff without creating an order, approval, or capture", () => {
    const store = new NovaMartStorefront("test-secret");
    const cart = store.getCart("cart");
    store.addCartItem(cart.id, "HDP-001", 1);
    expect(store.createHandoff(cart.id).payment).toEqual({
      provider: "PAYPAL",
      environment: "sandbox",
      merchantProfileId: "novamart",
      merchantDisplayName: "Recourse NovaMart Merchant",
      flow: "RECOURSE_GATEWAY_THEN_PAYPAL_HOSTED_APPROVAL",
      orderCreated: false,
      approvalCreated: false,
      captureCreated: false,
    });
  });
  it("rejects quote creation from an empty cart with EMPTY_CART", () => {
    const store = new NovaMartStorefront("test-secret");
    const cart = store.getCart("cart");
    try {
      store.createQuote(cart.id);
      throw new Error("Expected empty cart failure");
    } catch (error) {
      expect(error).toBeInstanceOf(NovaMartServiceError);
      expect((error as NovaMartServiceError).code).toBe("EMPTY_CART");
    }
  });
});
