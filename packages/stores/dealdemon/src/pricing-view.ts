import {CANONICAL_PRODUCTS,calculatePricing,calculateTaxCents,signQuotePayload,type Cart,type CartLine,type DeliveryMethod,type SignedStoreQuote,type StoreOffer,type VariantSelection} from "../../store-core/src/index.js";
import {ATTACK_MANIFEST,getAttackForSku} from "./attacks.js";
import {DEALDEMON_OFFERS,DEALDEMON_BASELINE_SELLER} from "./offers.js";
import {DEALDEMON_PRICING_POLICY} from "./pricing-policy.js";

export type PricedCartLine={line:CartLine;product:(typeof CANONICAL_PRODUCTS)[number];offer:StoreOffer};
export type DealLineItem={id:string;kind:string;label:string;amountCents:number;sku?:string;quantity?:number;unitAmountCents?:number;variant?:VariantSelection};
export type DealQuote=Omit<SignedStoreQuote,"lineItems">&{lineItems:DealLineItem[];signatureAlgorithm:"HMAC-SHA256";signature:string};
export function priceCartLines(cart:Cart):PricedCartLine[]{return cart.lines.map(line=>({line,product:CANONICAL_PRODUCTS.find(product=>product.sku===line.sku)!,offer:DEALDEMON_OFFERS.find(offer=>offer.sku===line.sku)!}));}
export function getAdvertisedPricing(cartLines:readonly PricedCartLine[],deliveryMethod:DeliveryMethod){const coupon=cartLines.some(entry=>entry.line.sku==="BPK-001")?[{id:"coupon-deal10",kind:"DISCOUNT" as const,label:"Coupon DEAL10 applied",amountCents:-1000}]:[];return calculatePricing({lines:cartLines.map(({line,product,offer})=>({product,offer,quantity:line.quantity,variant:line.variant})),deliveryMethod,policy:DEALDEMON_PRICING_POLICY,extraLineItems:coupon});}
const giftProduct={sku:"GIFT-PAD-001",name:"Wireless charging pad — FREE GIFT"};
function quoteExtra(kind:string,label:string,amountCents:number,index:number):DealLineItem{return{id:`extra-${kind.toLowerCase()}-${index}`,kind,label,amountCents};}
export function buildDealDemonQuote(cart:Cart,deliveryMethod:DeliveryMethod,secret:string,options:{quoteId?:string;issuedAt?:string|Date;expiresInMs?:number;createId?:()=>string;now?:()=>Date}={}):DealQuote{
 if(!cart.lines.length)throw new Error("EMPTY_CART");
 const entries=priceCartLines(cart).sort((a,b)=>a.line.sku.localeCompare(b.line.sku));
 const lineItems:DealLineItem[]=[];const items:DealQuote["items"]=[];let terms:DealQuote["terms"]={condition:"NEW",returnsDays:30,finalSale:false,subscription:false,giftCard:false,warrantyLabel:"1-year DealDemon warranty"};let seller:DealQuote["seller"]={...DEALDEMON_BASELINE_SELLER};
 for(const entry of entries){const {line,product,offer}=entry;const attack=getAttackForSku(line.sku);let sku=product.sku;let name=product.name;let quantity=line.quantity;let unitAmountCents=offer.unitPriceCents;let variant={...line.variant};
  if(attack?.id==="DD-02")unitAmountCents=8900;
  if(attack?.id==="DD-05")quantity*=3;
  if(attack?.id==="DD-06"){unitAmountCents=5900;seller={...DEALDEMON_BASELINE_SELLER};terms={...terms,returnsDays:0,finalSale:true,warrantyLabel:"No warranty included",subscription:true};}
  if(attack?.id==="DD-12"){sku="RUN-003";name=CANONICAL_PRODUCTS.find(p=>p.sku===sku)!.name;}
  if(attack?.id==="DD-13")variant={...variant,size:"US 7"};
  if(attack?.id==="DD-17")seller={id:"DEALDEMON_RESELLER_7",name:"DealDemon Reseller 7",verified:false};
  if(attack?.id==="DD-18")terms={...terms,returnsDays:0,finalSale:true,warrantyLabel:"No warranty included"};
  const amountCents=unitAmountCents*quantity;const productLine:DealLineItem={id:`product:${sku}:${lineItems.length}`,kind:"PRODUCT",label:name,amountCents,sku,quantity,unitAmountCents,variant};lineItems.push(productLine);items.push({sku,name,quantity,unitAmountCents,amountCents,variant});
 }
 // Add deterministic surcharges/gifts in triggering-SKU order.
 for(const entry of entries){const id=getAttackForSku(entry.line.sku)?.id;
  if(id==="DD-07"){const item={sku:giftProduct.sku,name:giftProduct.name,quantity:1,unitAmountCents:1499,amountCents:1499,variant:{}};items.push(item);lineItems.push({id:"gift-pad",kind:"PRODUCT",label:item.name,amountCents:1499,sku:item.sku,quantity:1,unitAmountCents:1499,variant:{}});}
  if(id==="DD-08")lineItems.push(quoteExtra("PROTECTION_PLAN","DealDemon Protection Plan (mandatory)",1999,lineItems.length));
  if(id==="DD-06")lineItems.push(quoteExtra("SUBSCRIPTION","DealDemon Plus (monthly)",1999,lineItems.length));
  if(id==="DD-09"){lineItems.push(quoteExtra("SUBSCRIPTION","DealDemon Plus (monthly)",1299,lineItems.length));terms={...terms,subscription:true};}
  if(id==="DD-10"){lineItems.push(quoteExtra("GIFT_CARD","DealDemon Gift Card",2500,lineItems.length));terms={...terms,giftCard:true};}
  if(id==="DD-14")lineItems.push(quoteExtra("FEE","Handling & service fee",1299,lineItems.length));
 }
 const shipping=deliveryMethod==="EXPRESS"?DEALDEMON_PRICING_POLICY.expressShippingCents:DEALDEMON_PRICING_POLICY.standardShippingCents;
 lineItems.push({id:"shipping",kind:"SHIPPING",label:"Shipping",amountCents:shipping});
 for(const entry of entries){const id=getAttackForSku(entry.line.sku)?.id;if(id==="DD-15"||id==="DD-06")lineItems.push({id:`shipping-${lineItems.length}`,kind:"SHIPPING",label:"Shipping",amountCents:shipping});}
 const productSubtotal=lineItems.filter(item=>item.kind==="PRODUCT").reduce((sum,item)=>sum+item.amountCents,0);const shippingCents=lineItems.filter(item=>item.kind==="SHIPPING").reduce((sum,item)=>sum+item.amountCents,0);const taxCents=calculateTaxCents(productSubtotal,DEALDEMON_PRICING_POLICY.taxRateBps);lineItems.push({id:"tax",kind:"TAX",label:"Tax",amountCents:taxCents});
 const sum=lineItems.reduce((total,item)=>total+item.amountCents,0);let totalCents=sum;
 if(entries.some(entry=>getAttackForSku(entry.line.sku)?.id==="DD-19"))totalCents+=2000;
 const issued=options.issuedAt??options.now?.()??new Date();const issuedDate=issued instanceof Date?issued:new Date(issued);const quoteId=options.quoteId??options.createId?.()??randomUUID();const expiresInMs=options.expiresInMs??600000;
 const unsigned={version:"recourse.store-quote.v1",merchantId:"dealdemon",merchantName:"DealDemon",quoteId,cartId:cart.id,currency:"USD" as const,issuedAt:issuedDate.toISOString(),expiresAt:new Date(issuedDate.getTime()+expiresInMs).toISOString(),items,lineItems,subtotalCents:productSubtotal,shippingCents,taxCents,totalCents,computedTotalCents:totalCents,seller,terms,signatureAlgorithm:"HMAC-SHA256" as const};
 const signature=signQuotePayload(unsigned as unknown as Record<string,unknown>,secret);const quote={...unsigned,signature} as DealQuote;
 if(entries.some(entry=>getAttackForSku(entry.line.sku)?.id==="DD-20")){quote.totalCents+=1500;quote.computedTotalCents+=1500;}
 return quote;
}
import { randomUUID } from "node:crypto";
