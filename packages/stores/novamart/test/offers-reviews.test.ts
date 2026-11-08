import { describe, expect, it } from "vitest";
import { CANONICAL_PRODUCTS } from "../../store-core/src/index.js";
import { NOVAMART_OFFERS } from "../src/offers.js";
import { getReviewsForSku } from "../src/reviews.js";

const prices: Record<string, number> = {
  "JKT-001": 18900,
  "JKT-002": 8900,
  "JKT-003": 24900,
  "JKT-004": 13900,
  "JKT-005": 11900,
  "HDP-001": 5800,
  "HDP-002": 4900,
  "HDP-003": 12900,
  "HDP-004": 9900,
  "HDP-005": 3900,
  "RUN-001": 12900,
  "RUN-002": 9800,
  "RUN-003": 11500,
  "RUN-004": 10500,
  "RUN-005": 14900,
  "BPK-001": 7900,
  "BPK-002": 13900,
  "BPK-003": 6900,
  "BPK-004": 11900,
  "BPK-005": 4500,
};
describe("NovaMart offers", () => {
  it("has one offer per canonical SKU", () => {
    expect(NOVAMART_OFFERS).toHaveLength(20);
    expect(new Set(NOVAMART_OFFERS.map((o) => o.sku)).size).toBe(20);
    expect(NOVAMART_OFFERS.map((o) => o.sku).sort()).toEqual(
      CANONICAL_PRODUCTS.map((p) => p.sku).sort(),
    );
  });
  it("uses the specified exact price table", () => {
    for (const offer of NOVAMART_OFFERS)
      expect(offer.unitPriceCents).toBe(prices[offer.sku]);
  });
  it("sells new products through the verified official seller with fair returns", () => {
    for (const offer of NOVAMART_OFFERS) {
      expect(offer.merchantId).toBe("novamart");
      expect(offer.seller).toEqual({
        id: "NOVAMART_OFFICIAL",
        name: "NovaMart Official",
        verified: true,
      });
      expect(offer.condition).toBe("NEW");
      expect(offer.returnsDays).toBe(30);
      expect(offer.finalSale).toBe(false);
      expect(offer.compareAtPriceCents).toBeUndefined();
    }
  });
  it("uses positive integer prices and stock and varied ratings/review totals", () => {
    for (const offer of NOVAMART_OFFERS) {
      expect(
        Number.isSafeInteger(offer.unitPriceCents) && offer.unitPriceCents > 0,
      ).toBe(true);
      expect(Number.isSafeInteger(offer.stock) && offer.stock > 0).toBe(true);
      expect(offer.rating).toBeGreaterThanOrEqual(4.3);
      expect(offer.rating).toBeLessThanOrEqual(4.9);
    }
    expect(
      new Set(NOVAMART_OFFERS.map((o) => o.reviewCount)).size,
    ).toBeGreaterThan(1);
  });
});
describe("NovaMart reviews", () => {
  const all = CANONICAL_PRODUCTS.flatMap((p) => getReviewsForSku(p.sku));
  it("returns three or four deterministic reviews for each SKU", () => {
    for (const p of CANONICAL_PRODUCTS) {
      const a = getReviewsForSku(p.sku);
      expect(a.length).toBeGreaterThanOrEqual(3);
      expect(a.length).toBeLessThanOrEqual(4);
      expect(getReviewsForSku(p.sku)).toEqual(a);
    }
  });
  it("includes required fields and globally unique IDs", () => {
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    for (const r of all) {
      expect(r.id).toMatch(/^NOVAMART-/);
      expect(r.author).toBeTruthy();
      expect(r.rating).toBeGreaterThanOrEqual(1);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.title).toBeTruthy();
      expect(r.body.length).toBeGreaterThan(20);
      expect(typeof r.verifiedPurchase).toBe("boolean");
      expect(Number.isInteger(r.helpfulCount)).toBe(true);
    }
  });
  it("does not reuse review bodies across the catalog", () => {
    expect(new Set(all.map((r) => r.body)).size).toBe(all.length);
  });
  it("mentions two product-specific facts in each review", () => {
    for (const p of CANONICAL_PRODUCTS) {
      for (const review of getReviewsForSku(p.sku)) {
        const facts = p.features.filter((f) => review.body.includes(f));
        expect(facts.length, `${p.sku}: ${review.body}`).toBeGreaterThanOrEqual(
          2,
        );
      }
    }
  });
});
