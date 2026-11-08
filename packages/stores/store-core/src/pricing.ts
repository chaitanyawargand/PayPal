import { StoreCoreError } from "./errors.js";
import { addCents, assertIntegerCents, calculateTaxCents, multiplyCents } from "./money.js";
import { canonicalJson } from "./canonical-json.js";
import type { CanonicalProduct, StoreOffer, VariantSelection, QuoteLineItem } from "./types.js";
export type DeliveryMethod="STANDARD"|"EXPRESS";
export type PricingPolicy={standardShippingCents:number;expressShippingCents:number;freeStandardShippingThresholdCents?:number;taxRateBps:number};
export type PricingLine={product:CanonicalProduct;offer:StoreOffer;quantity:number;variant?:VariantSelection};
export type PricingBreakdown={merchandiseSubtotalCents:number;extraChargesCents:number;shippingCents:number;taxCents:number;computedTotalCents:number;lineItems:QuoteLineItem[]};
export function calculatePricing(input:{lines:readonly PricingLine[];deliveryMethod:DeliveryMethod;policy:PricingPolicy;extraLineItems?:readonly QuoteLineItem[]}):PricingBreakdown{
 if(!input.lines.length)throw new StoreCoreError("EMPTY_PRICING_INPUT","At least one product line is required");
 const lineItems:QuoteLineItem[]=[];let subtotal=0;
 for(const line of input.lines){if(line.product.sku!==line.offer.sku)throw new StoreCoreError("INVALID_LINE_ITEM","Product and offer SKUs must match");const amount=multiplyCents(assertIntegerCents(line.offer.unitPriceCents),line.quantity);subtotal=addCents(subtotal,amount);lineItems.push({id:`product:${line.product.sku}:${canonicalJson(line.variant??line.product.defaultVariant)}`,kind:"PRODUCT",label:line.product.name,amountCents:amount,sku:line.product.sku,quantity:line.quantity,unitAmountCents:line.offer.unitPriceCents,variant:line.variant??line.product.defaultVariant});}
 let extras=0;for(const item of input.extraLineItems??[]){assertIntegerCents(item.amountCents);if(item.kind==="SHIPPING"||item.kind==="TAX"||(item.amountCents<0&&item.kind!=="DISCOUNT"))throw new StoreCoreError("INVALID_LINE_ITEM","Invalid extra line item");extras=addCents(extras,item.amountCents);lineItems.push({...item});}
 const {policy}=input;let shipping=assertIntegerCents(input.deliveryMethod==="EXPRESS"?policy.expressShippingCents:policy.standardShippingCents);
 if(input.deliveryMethod==="STANDARD"&&policy.freeStandardShippingThresholdCents!==undefined){assertIntegerCents(policy.freeStandardShippingThresholdCents);if(subtotal>=policy.freeStandardShippingThresholdCents)shipping=0;}
 const tax=calculateTaxCents(subtotal,policy.taxRateBps);lineItems.push({id:"shipping",kind:"SHIPPING",label:"Shipping",amountCents:shipping},{id:"tax",kind:"TAX",label:"Tax",amountCents:tax});
 const total=addCents(subtotal,extras,shipping,tax);if(total<0)throw new StoreCoreError("INVALID_LINE_ITEM","Total cannot be negative");
 return {merchandiseSubtotalCents:subtotal,extraChargesCents:extras,shippingCents:shipping,taxCents:tax,computedTotalCents:total,lineItems};
}
