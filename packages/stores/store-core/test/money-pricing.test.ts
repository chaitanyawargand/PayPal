import {describe,it,expect} from "vitest";
import {CANONICAL_PRODUCTS,calculatePricing,formatUsd,calculateTaxCents,addCents,multiplyCents,canonicalJson,StoreCoreError} from "../src/index.js";
const product=CANONICAL_PRODUCTS[0]!;const offer={sku:product.sku,merchantId:"shop",unitPriceCents:5800,rating:4,reviewCount:1,stock:4,condition:"NEW" as const,seller:{id:"s",name:"Seller",verified:true},warrantyLabel:"",returnsDays:30,finalSale:false,shipsFrom:"US",deliveryEstimateLabel:"soon"};const policy={standardShippingCents:495,expressShippingCents:1200,freeStandardShippingThresholdCents:7500,taxRateBps:825};
describe("money helpers",()=>{
 it.each([[6774,"$67.74"],[5,"$0.05"],[123456,"$1,234.56"],[-250,"-$2.50"]] as const)("formats %i cents",(cents,expected)=>expect(formatUsd(cents)).toBe(expected));
 it("rejects non-integer cents",()=>{expect(()=>formatUsd(1.5)).toThrowError(StoreCoreError);expect(()=>formatUsd(Number.NaN)).toThrowError(StoreCoreError);});
 it("adds and multiplies integer cents",()=>{expect(addCents(20,22)).toBe(42);expect(multiplyCents(250,3)).toBe(750);});
 it("rejects fractional and NaN inputs in addition and multiplication",()=>{expect(()=>addCents(1,Number.NaN)).toThrowError(StoreCoreError);expect(()=>addCents(1.2)).toThrowError(StoreCoreError);expect(()=>multiplyCents(Number.NaN,2)).toThrowError(StoreCoreError);expect(()=>multiplyCents(100,Number.NaN)).toThrowError(StoreCoreError);});
 it("rounds tax half-up and rounds values below half down",()=>{expect(calculateTaxCents(5800,825)).toBe(479);expect(calculateTaxCents(1,5000)).toBe(1);expect(calculateTaxCents(1,4999)).toBe(0);});
});
describe("canonical JSON",()=>{
 it("sorts nested object keys, preserves array order, and emits compact JSON",()=>{expect(canonicalJson({z:[{b:2,a:1},3],a:{y:true,x:null}})).toBe('{"a":{"x":null,"y":true},"z":[{"a":1,"b":2},3]}');});
 it.each([undefined,()=>1,Symbol("x"),1n])("rejects unsupported values",(value)=>{expect(()=>canonicalJson(value)).toThrow(TypeError);});
 it("rejects non-finite numbers and circular structures",()=>{expect(()=>canonicalJson(Infinity)).toThrow(TypeError);const cycle:{self?:unknown}={};cycle.self=cycle;expect(()=>canonicalJson(cycle)).toThrow(TypeError);});
});
describe("pricing",()=>{
 it("matches the reference total and its line item sum",()=>{const result=calculatePricing({lines:[{product,offer,quantity:1}],deliveryMethod:"STANDARD",policy});expect(result).toMatchObject({merchandiseSubtotalCents:5800,shippingCents:495,taxCents:479,computedTotalCents:6774});expect(result.computedTotalCents).toBe(result.lineItems.reduce((sum,item)=>sum+item.amountCents,0));});
 it("charges standard shipping below threshold and makes it free at threshold",()=>{expect(calculatePricing({lines:[{product,offer:{...offer,unitPriceCents:7499},quantity:1}],deliveryMethod:"STANDARD",policy}).shippingCents).toBe(495);expect(calculatePricing({lines:[{product,offer:{...offer,unitPriceCents:7500},quantity:1}],deliveryMethod:"STANDARD",policy}).shippingCents).toBe(0);});
 it("always charges express shipping even above the free threshold",()=>{expect(calculatePricing({lines:[{product,offer:{...offer,unitPriceCents:9000},quantity:1}],deliveryMethod:"EXPRESS",policy:{...policy,expressShippingCents:1295}}).shippingCents).toBe(1295);});
 it("taxes merchandise only, excluding shipping",()=>{const result=calculatePricing({lines:[{product,offer,quantity:1}],deliveryMethod:"STANDARD",policy});expect(result.taxCents).toBe(479);expect(result.taxCents).not.toBe(calculateTaxCents(result.merchandiseSubtotalCents+result.shippingCents,policy.taxRateBps));});
 it("rejects mismatched product and offer SKUs",()=>{expect(()=>calculatePricing({lines:[{product,offer:{...offer,sku:"other"},quantity:1}],deliveryMethod:"STANDARD",policy})).toThrowError(StoreCoreError);});
 it("rejects caller-supplied shipping and tax lines",()=>{for(const kind of ["SHIPPING","TAX"] as const)expect(()=>calculatePricing({lines:[{product,offer,quantity:1}],deliveryMethod:"STANDARD",policy,extraLineItems:[{id:"x",kind,label:"x",amountCents:1}]})).toThrowError(StoreCoreError);});
 it("applies negative discounts and keeps the total equal to line item sums",()=>{const result=calculatePricing({lines:[{product,offer,quantity:1}],deliveryMethod:"STANDARD",policy,extraLineItems:[{id:"discount",kind:"DISCOUNT",label:"Discount",amountCents:-100}]});expect(result.extraChargesCents).toBe(-100);expect(result.computedTotalCents).toBe(result.lineItems.reduce((sum,item)=>sum+item.amountCents,0));});
});
