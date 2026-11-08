import { describe, expect, it } from "vitest";
import { CANONICAL_PRODUCTS, getProductBySku, getProductBySlug, listProductsByCategory, PRODUCT_CATEGORIES } from "../src/index.js";

describe("canonical catalog", () => {
  it("contains exactly twenty products", () => { expect(CANONICAL_PRODUCTS).toHaveLength(20); });
  it.each(PRODUCT_CATEGORIES.map((category) => [category.id] as const))("has five products in %s", (id) => { expect(listProductsByCategory(id)).toHaveLength(5); });
  it("uses unique SKUs and slugs", () => {
    expect(new Set(CANONICAL_PRODUCTS.map((p) => p.sku)).size).toBe(20);
    expect(new Set(CANONICAL_PRODUCTS.map((p) => p.slug)).size).toBe(20);
  });
  it("gives every product useful descriptions, features, specifications, and search terms", () => {
    for (const p of CANONICAL_PRODUCTS) {
      expect(p.features.length, p.sku).toBeGreaterThanOrEqual(4);
      expect(Object.keys(p.specifications).length, p.sku).toBeGreaterThanOrEqual(5);
      expect(p.shortDescription.trim().length, p.sku).toBeGreaterThan(10);
      expect(p.longDescription.trim().split(/[.!?]+/).filter(Boolean).length, p.sku).toBeGreaterThanOrEqual(2);
      expect(p.searchTerms.length, p.sku).toBeGreaterThan(0);
    }
  });
  it("keeps merchant-specific price, stock, seller, and review facts out of canonical products", () => {
    const forbidden = new Set(["price", "priceCents", "unitPriceCents", "stock", "seller", "reviews", "reviewCount"]);
    for (const p of CANONICAL_PRODUCTS) for (const key of Object.keys(p)) expect(forbidden.has(key), `${p.sku}.${key}`).toBe(false);
  });
  it("uses only legal default variant values", () => {
    for (const p of CANONICAL_PRODUCTS) for (const option of p.variantOptions) expect(option.values, `${p.sku}.${option.id}`).toContain(p.defaultVariant[option.id]);
  });
  it("looks up products by SKU and slug and returns undefined for unknown values", () => {
    const p = CANONICAL_PRODUCTS[0]!;
    expect(getProductBySku(p.sku)).toBe(p);
    expect(getProductBySlug(p.slug)).toBe(p);
    expect(getProductBySku("missing")).toBeUndefined();
    expect(getProductBySlug("missing")).toBeUndefined();
  });
  it("lists category products in catalog order and returns an empty list for an unknown category", () => {
    expect(listProductsByCategory("JACKETS")).toEqual(CANONICAL_PRODUCTS.filter((p) => p.category === "JACKETS"));
    expect(listProductsByCategory("UNKNOWN" as never)).toEqual([]);
  });
});
