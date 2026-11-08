import {
  CANONICAL_PRODUCTS, InMemoryCartStore, buildQuote, calculatePricing, searchCatalog,
  type DeliveryMethod, type ItemCondition, type SignedStoreQuote, type StoreCoreErrorCode, type StoreOffer, type VariantSelection,
} from "../../store-core/src/index.js";
import { getOfferBySku, PEERMARKET_OFFERS, getPeerRiskFacts } from "./offers.js";
import { PEERMARKET_PRICING_POLICY } from "./pricing-policy.js";
import { getListingNotesForSku } from "./listing-notes.js";
import { getReviewsForSku } from "./reviews.js";
import { getContentBlocks } from "./content-blocks.js";

export const MERCHANT_ID="peermarket";
export const MERCHANT_NAME="PeerMarket";
const conditionSeverity:Record<ItemCondition,number>={USED_GOOD:3,OPEN_BOX:2,USED_LIKE_NEW:1,NEW:0,REFURBISHED:2};
export class PeerMarketServiceError extends Error {constructor(readonly code:StoreCoreErrorCode|"EMPTY_CART",message:string){super(message);this.name="PeerMarketServiceError";}}
export type PeerHandoff={status:"READY_FOR_RECOURSE";merchantId:"peermarket";quote:SignedStoreQuote;payment:{provider:"PAYPAL";environment:"sandbox";merchantProfileId:"peermarket";merchantDisplayName:"Recourse PeerMarket Merchant";flow:"RECOURSE_GATEWAY_THEN_PAYPAL_HOSTED_APPROVAL";orderCreated:false;approvalCreated:false;captureCreated:false}};
function findProduct(sku:string){return CANONICAL_PRODUCTS.find(product=>product.sku.toLowerCase()===sku.toLowerCase());}
export function aggregateQuoteFacts(offers:readonly StoreOffer[]){
 if(!offers.length)throw new PeerMarketServiceError("EMPTY_CART","Add an item before requesting a quote");
 const sellers=new Map(offers.map(offer=>[offer.seller.id,offer.seller]));
 const seller=sellers.size===1?{...offers[0]!.seller}:{id:"PEERMARKET_MULTI_SELLER",name:"Multiple PeerMarket sellers",verified:false,accountAgeLabel:"Mixed seller accounts",location:"Multiple locations"};
 const condition=offers.map(offer=>offer.condition).sort((a,b)=>conditionSeverity[b]-conditionSeverity[a])[0]!;
 return {seller,condition,returnsDays:Math.min(...offers.map(offer=>offer.returnsDays)),finalSale:offers.some(offer=>offer.finalSale),warrantyLabel:"No warranty included"};
}

export class PeerMarketStorefront {
 private readonly carts=new InMemoryCartStore();
 private readonly issuedQuotes=new Map<string,SignedStoreQuote>();
 constructor(private readonly quoteSecret:string,readonly quoteSigning:"configured"|"ephemeral-dev"="configured"){}
 search(input:{query?:string;category?:string;brand?:string;feature?:string;maxUnitPriceCents?:number;sort?:"relevance"|"price_asc"|"price_desc"|"rating";condition?:ItemCondition}){
  return searchCatalog({offers:PEERMARKET_OFFERS,query:input.query,category:input.category as never,brand:input.brand,feature:input.feature,maxUnitPriceCents:input.maxUnitPriceCents,sort:input.sort})
    .filter(result=>!input.condition||result.offer.condition===input.condition)
    .map(result=>({...result,estimatedTotalForOneCents:calculatePricing({lines:[{product:result.product,offer:result.offer,quantity:1}],deliveryMethod:"STANDARD",policy:PEERMARKET_PRICING_POLICY}).computedTotalCents,riskFacts:getPeerRiskFacts(result.offer)}));
 }
 productDetail(sku:string){const product=findProduct(sku);if(!product)return null;const offer=getOfferBySku(product.sku)!;return {...product,offer,variants:product.variantOptions,seller:offer.seller,listingNotes:getListingNotesForSku(product.sku),riskFacts:getPeerRiskFacts(offer),shipping:{shipsFrom:offer.shipsFrom,deliveryEstimateLabel:offer.deliveryEstimateLabel},returnsDays:offer.returnsDays,finalSale:offer.finalSale,warrantyLabel:offer.warrantyLabel,reviews:getReviewsForSku(product.sku),contentBlocks:getContentBlocks(product,offer),hiddenContent:[] as []};}
 getCart(cartId?:string){return this.carts.getOrCreateCart(cartId);}
 addCartItem(cartId:string,sku:string,quantity:number,variant?:VariantSelection){const product=findProduct(sku);const offer=product&&getOfferBySku(product.sku);if(!product||!offer)throw new PeerMarketServiceError("PRODUCT_NOT_FOUND",`Product not found: ${sku}`);return this.carts.addItem(cartId,product,offer,quantity,variant);}
 setCartQuantity(cartId:string,lineId:string,quantity:number){return this.carts.setLineQuantity(cartId,lineId,quantity);}
 removeCartLine(cartId:string,lineId:string){return this.carts.removeLine(cartId,lineId);}
 clearCart(cartId:string){return this.carts.clearCart(cartId);}
 cartView(cartId:string,deliveryMethod:DeliveryMethod="STANDARD"){
  const cart=this.carts.requireCart(cartId);const lines=cart.lines.map(line=>{const product=findProduct(line.sku)!;const offer=getOfferBySku(line.sku)!;return {...line,name:product.name,slug:product.slug,condition:offer.condition,seller:offer.seller,riskFacts:getPeerRiskFacts(offer),offer};});
  const pricing=cart.lines.length?calculatePricing({lines:cart.lines.map(line=>({product:findProduct(line.sku)!,offer:getOfferBySku(line.sku)!,quantity:line.quantity,variant:line.variant})),deliveryMethod,policy:PEERMARKET_PRICING_POLICY}):{merchandiseSubtotalCents:0,extraChargesCents:0,shippingCents:0,taxCents:0,computedTotalCents:0,lineItems:[]};
  return {merchantId:MERCHANT_ID,cart:{...cart,lines},pricing,deliveryMethod};
 }
 createQuote(cartId:string,deliveryMethod:DeliveryMethod="STANDARD"):SignedStoreQuote{
  const cart=this.carts.requireCart(cartId);if(!cart.lines.length)throw new PeerMarketServiceError("EMPTY_CART","Add an item before requesting a quote");
  const entries=cart.lines.map(line=>({line,product:findProduct(line.sku)!,offer:getOfferBySku(line.sku)!}));const pricing=calculatePricing({lines:entries.map(({line,product,offer})=>({product,offer,quantity:line.quantity,variant:line.variant})),deliveryMethod,policy:PEERMARKET_PRICING_POLICY});
  const aggregate=aggregateQuoteFacts(entries.map(entry=>entry.offer));
  const quote=buildQuote({merchantId:MERCHANT_ID,merchantName:MERCHANT_NAME,cartId,items:entries.map(({line,product,offer})=>({sku:product.sku,name:product.name,quantity:line.quantity,unitAmountCents:offer.unitPriceCents,amountCents:line.amountCents,variant:line.variant})),pricing,seller:aggregate.seller,terms:{condition:aggregate.condition,returnsDays:aggregate.returnsDays,finalSale:aggregate.finalSale,subscription:false,giftCard:false,warrantyLabel:aggregate.warrantyLabel}},this.quoteSecret);
  this.issuedQuotes.set(quote.quoteId,structuredClone(quote));return structuredClone(quote);
 }
 createHandoff(cartId:string,deliveryMethod:DeliveryMethod="STANDARD"):PeerHandoff{return {status:"READY_FOR_RECOURSE",merchantId:MERCHANT_ID,quote:this.createQuote(cartId,deliveryMethod),payment:{provider:"PAYPAL",environment:"sandbox",merchantProfileId:"peermarket",merchantDisplayName:"Recourse PeerMarket Merchant",flow:"RECOURSE_GATEWAY_THEN_PAYPAL_HOSTED_APPROVAL",orderCreated:false,approvalCreated:false,captureCreated:false}};}
 getIssuedQuote(quoteId:string):SignedStoreQuote|null{const quote=this.issuedQuotes.get(quoteId);return quote?structuredClone(quote):null;}
}
