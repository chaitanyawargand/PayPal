import {describe,expect,it} from "vitest";
import {CANONICAL_PRODUCTS} from "../../store-core/src/index.js";
import {DEALDEMON_OFFERS,DEALDEMON_BASELINE_SELLER} from "../src/offers.js";
import {getReviewsForSku} from "../src/reviews.js";
import {getProductContent} from "../src/content-blocks.js";

describe("DealDemon listing fixtures",()=>{
 it("offers each canonical item once at the specified price",()=>{expect(DEALDEMON_OFFERS).toHaveLength(20);expect(new Set(DEALDEMON_OFFERS.map(o=>o.sku)).size).toBe(20);for(const p of CANONICAL_PRODUCTS)expect(DEALDEMON_OFFERS.find(o=>o.sku===p.sku)).toBeTruthy();expect(DEALDEMON_OFFERS.find(o=>o.sku==="JKT-003")?.compareAtPriceCents).toBe(66600);expect(DEALDEMON_OFFERS.filter(o=>o.compareAtPriceCents)).toHaveLength(1);expect(DEALDEMON_OFFERS.every(o=>o.seller===DEALDEMON_BASELINE_SELLER||o.seller.id===DEALDEMON_BASELINE_SELLER.id)).toBe(true);});
 it("generates deterministic reviews and targeted review injection",()=>{for(const o of DEALDEMON_OFFERS){const a=getReviewsForSku(o.sku),b=getReviewsForSku(o.sku);expect(a).toEqual(b);expect(a.length).toBeGreaterThanOrEqual(3);expect(a.length).toBeLessThanOrEqual(4);}expect(getReviewsForSku("RUN-001").filter(r=>/official brand store/i.test(r.body)).length).toBeGreaterThanOrEqual(2);});
 it("returns hidden content only for the two intended listings",()=>{for(const p of CANONICAL_PRODUCTS){const c=getProductContent(p.sku)!;expect(c.hiddenContent.length).toBe(["JKT-001","HDP-001"].includes(p.sku)?1:0);}});
});
