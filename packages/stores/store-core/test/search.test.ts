import {describe,it,expect} from "vitest";
import {CANONICAL_PRODUCTS,searchCatalog,partitionContentBlocks,visibleContentText,summarizeReviews} from "../src/index.js";
const offers=CANONICAL_PRODUCTS.map((p,i)=>({sku:p.sku,merchantId:"x",unitPriceCents:1000+i,rating:i%5,reviewCount:i,stock:2,condition:"NEW" as const,seller:{id:"s",name:"S",verified:true},warrantyLabel:"",returnsDays:30,finalSale:false,shipsFrom:"US",deliveryEstimateLabel:""}));
describe("catalog search",()=>{
 it("ranks the ANC headphones match first",()=>{expect(searchCatalog({offers,query:"ANC headphones"})[0]?.product.sku).toBe("HDP-001");});
 it("returns exactly the five products in a selected category",()=>{expect(searchCatalog({offers,category:"JACKETS"})).toHaveLength(5);expect(searchCatalog({offers,category:"JACKETS"}).every(r=>r.product.category==="JACKETS")).toBe(true);});
 it("filters by brand, feature, and maximum unit price",()=>{expect(searchCatalog({offers,brand:"aurasound"}).map(r=>r.product.sku)).toEqual(["HDP-001"]);expect(searchCatalog({offers,feature:"noise cancellation"}).map(r=>r.product.sku)).toContain("HDP-001");expect(searchCatalog({offers,maxUnitPriceCents:1002}).every(r=>r.offer.unitPriceCents<=1002)).toBe(true);});
 it("requires every token in a multi-token query to match",()=>{expect(searchCatalog({offers,query:"wireless earbuds"}).map(r=>r.product.sku)).toContain("HDP-002");expect(searchCatalog({offers,query:"wireless hiking"})).toEqual([]);});
 it("sorts by ascending and descending price with deterministic ties",()=>{expect(searchCatalog({offers,sort:"price_asc"}).slice(0,2).map(r=>r.offer.unitPriceCents)).toEqual([1000,1001]);expect(searchCatalog({offers,sort:"price_desc"})[0]?.offer.unitPriceCents).toBe(1019);});
 it("sorts by rating, then review count, then SKU",()=>{const sorted=searchCatalog({offers,sort:"rating"});expect(sorted[0]!.offer.rating).toBe(4);expect(sorted[0]!.offer.reviewCount).toBe(19);});
 it("returns an empty list for a no-match query",()=>{expect(searchCatalog({offers,query:"unicorn"})).toEqual([]);});
});
describe("content blocks",()=>{
 const blocks=[{id:"v",kind:"DESCRIPTION" as const,placement:"body",visibility:"VISIBLE" as const,text:"Shown text",source:"MERCHANT" as const},{id:"h",kind:"CHECKOUT_NOTE" as const,placement:"hidden",visibility:"HIDDEN" as const,text:"Hidden text",source:"MERCHANT" as const}];
 it("partitions visible and hidden blocks",()=>{expect(partitionContentBlocks(blocks)).toEqual({visible:[blocks[0]],hidden:[blocks[1]]});});
 it("includes only visible text in the visible content output",()=>{expect(visibleContentText(blocks)).toBe("Shown text");expect(visibleContentText(blocks)).not.toContain("Hidden text");});
});
describe("review summaries",()=>{
 it("counts reviews, averages to one decimal, and counts each rating",()=>{expect(summarizeReviews([{rating:5},{rating:4},{rating:4}] as never)).toEqual({reviewCount:3,averageRating:4.3,ratingCounts:{1:0,2:0,3:0,4:2,5:1}});});
 it("summarizes an empty set",()=>{expect(summarizeReviews([])).toEqual({reviewCount:0,averageRating:0,ratingCounts:{1:0,2:0,3:0,4:0,5:0}});});
});
