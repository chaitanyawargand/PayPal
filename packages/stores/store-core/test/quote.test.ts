import {describe,it,expect} from "vitest";
import {CANONICAL_PRODUCTS,buildQuote,calculatePricing,verifySignedQuote,validateQuoteConsistency,signQuotePayload,STORE_QUOTE_VERSION} from "../src/index.js";
const p=CANONICAL_PRODUCTS[0]!;const offer={sku:p.sku,merchantId:"x",unitPriceCents:5800,rating:4,reviewCount:0,stock:2,condition:"NEW" as const,seller:{id:"seller",name:"Seller",verified:true},warrantyLabel:"One year",returnsDays:30,finalSale:false,shipsFrom:"US",deliveryEstimateLabel:""};const pricing=calculatePricing({lines:[{product:p,offer,quantity:1}],deliveryMethod:"STANDARD",policy:{standardShippingCents:495,expressShippingCents:1200,taxRateBps:825}});const input={merchantId:"m",merchantName:"Merchant",cartId:"c",items:[{sku:p.sku,name:p.name,quantity:1,unitAmountCents:5800,amountCents:5800,variant:p.defaultVariant}],pricing,seller:offer.seller,terms:{condition:"NEW" as const,returnsDays:30,finalSale:false,subscription:false,giftCard:false,warrantyLabel:"One year"},quoteId:"q",issuedAt:"2025-01-01T00:00:00.000Z"};
describe("signed quotes",()=>{
 it("builds the expected version, currency, item data, and consistent totals",()=>{const q=buildQuote(input,"secret");expect(q.version).toBe(STORE_QUOTE_VERSION);expect(q.version).toBe("recourse.store-quote.v1");expect(q.currency).toBe("USD");expect(q.totalCents).toBe(6774);expect(q.computedTotalCents).toBe(6774);expect(q.totalCents).toBe(q.lineItems.reduce((sum,line)=>sum+line.amountCents,0));expect(q.items).toEqual(input.items);expect(validateQuoteConsistency(q)).toEqual([]);});
 it("uses the default ten-minute expiry and honors a custom expiry",()=>{expect(buildQuote(input,"secret").expiresAt).toBe("2025-01-01T00:10:00.000Z");expect(buildQuote({...input,expiresInMs:120000},"secret").expiresAt).toBe("2025-01-01T00:02:00.000Z");});
 it("signs as-is without mutating or repairing an inconsistent payload",()=>{const payload={merchantId:"m",totalCents:1,computedTotalCents:999,signatureAlgorithm:"HMAC-SHA256",signature:"old"};const before=structuredClone(payload);const signature=signQuotePayload(payload,"secret");expect(payload).toEqual(before);expect(verifySignedQuote({...payload,signature},"secret")).toBe(true);});
 it("verifies correctly signed quotes regardless of key insertion order",()=>{const q=buildQuote(input,"secret");const reordered=Object.fromEntries(Object.entries(q).reverse());expect(verifySignedQuote(reordered,"secret")).toBe(true);});
 it("rejects tampering with totalCents",()=>{const q=buildQuote(input,"secret");expect(verifySignedQuote({...q,totalCents:q.totalCents+1},"secret")).toBe(false);});
 it("rejects tampering with each individual line item amount",()=>{const q=buildQuote(input,"secret");for(let i=0;i<q.lineItems.length;i++){const changed=q.lineItems.map((line,index)=>index===i?{...line,amountCents:line.amountCents+1}:line);expect(verifySignedQuote({...q,lineItems:changed},"secret"),`line item ${i}`).toBe(false);}});
 it("rejects tampering with merchant identity",()=>{const q=buildQuote(input,"secret");expect(verifySignedQuote({...q,merchantId:"attacker"},"secret")).toBe(false);});
 it("returns false for wrong secrets and missing signatures",()=>{const q=buildQuote(input,"secret");expect(verifySignedQuote(q,"wrong")).toBe(false);const {signature:_signature,...missing}=q;expect(verifySignedQuote(missing,"secret")).toBe(false);});
 it.each([null,undefined,4,"quote",[],{}])("returns false for malformed quote input %j",(value)=>{expect(()=>verifySignedQuote(value,"secret")).not.toThrow();expect(verifySignedQuote(value,"secret")).toBe(false);});
 it("flags line item sum mismatch, total mismatch, non-integer values, and missing line items",()=>{
   const q=buildQuote(input,"secret");
   const changedLines=q.lineItems.map((line,i)=>i===0?{...line,amountCents:line.amountCents+1}:line);
   expect(validateQuoteConsistency({...q,lineItems:changedLines})).toContain("LINE_ITEMS_SUM_MISMATCH");
   expect(validateQuoteConsistency({...q,totalCents:1})).toContain("TOTAL_MISMATCH");
   expect(validateQuoteConsistency({...q,subtotalCents:1.5})).toContain("NON_INTEGER_CENTS");
   const {lineItems:_items,...missing}=q;
   expect(validateQuoteConsistency(missing)).toContain("MISSING_LINE_ITEMS");
 });
});
