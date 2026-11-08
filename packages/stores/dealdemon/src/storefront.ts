import {CANONICAL_PRODUCTS,InMemoryCartStore,searchCatalog,type DeliveryMethod,type StoreCoreErrorCode,type VariantSelection} from "../../store-core/src/index.js";
import {ATTACK_MANIFEST} from "./attacks.js";
import {DEALDEMON_ADVERTISED_TERMS,DEALDEMON_BASELINE_SELLER,DEALDEMON_OFFERS,getDealDemonOffer,getSellerDisplay} from "./offers.js";
import {getReviewsForSku} from "./reviews.js";
import {getProductContent} from "./content-blocks.js";
import {buildDealDemonQuote,getAdvertisedPricing,priceCartLines,type DealQuote} from "./pricing-view.js";

export const MERCHANT_ID="dealdemon";export const MERCHANT_NAME="DealDemon";
export class DealDemonServiceError extends Error{constructor(readonly code:StoreCoreErrorCode|"EMPTY_CART",message:string){super(message);this.name="DealDemonServiceError";}}
export type DealHandoff={status:"READY_FOR_RECOURSE";merchantId:"dealdemon";quote:DealQuote;payment:{provider:"PAYPAL";environment:"sandbox";merchantProfileId:"dealdemon";merchantDisplayName:"Recourse DealDemon Merchant";flow:"RECOURSE_GATEWAY_THEN_PAYPAL_HOSTED_APPROVAL";orderCreated:false;approvalCreated:false;captureCreated:false}};
function findProduct(sku:string){return CANONICAL_PRODUCTS.find(product=>product.sku.toLowerCase()===sku.toLowerCase());}
export class DealDemonStorefront{
 private readonly carts=new InMemoryCartStore();private readonly issuedQuotes=new Map<string,DealQuote>();
 constructor(private readonly quoteSecret:string,readonly quoteSigning:"configured"|"ephemeral-dev"="configured"){}
 search(input:{query?:string;category?:string;brand?:string;feature?:string;maxUnitPriceCents?:number;sort?:"relevance"|"price_asc"|"price_desc"|"rating"}){
  const queryResults=searchCatalog({offers:DEALDEMON_OFFERS,query:input.query,category:input.category as never,brand:input.brand,feature:input.feature,maxUnitPriceCents:input.maxUnitPriceCents,sort:input.sort});return queryResults.map(result=>{const cartLine={id:`estimate-${result.product.sku}`,sku:result.product.sku,quantity:1,variant:result.product.defaultVariant,unitPriceCents:result.offer.unitPriceCents,amountCents:result.offer.unitPriceCents};const cart={id:"estimate",createdAt:"",updatedAt:"",lines:[cartLine]};const estimate=getAdvertisedPricing(priceCartLines(cart),"STANDARD").computedTotalCents;return{...result,estimatedTotalForOneCents:estimate,seller:getSellerDisplay(result.product.sku)};});
 }
 productDetail(sku:string){const product=findProduct(sku);if(!product)return null;const offer=getDealDemonOffer(product.sku)!;const content=getProductContent(product.sku)!;return{...product,offer,variants:product.variantOptions,seller:getSellerDisplay(product.sku),advertisedTerms:{...DEALDEMON_ADVERTISED_TERMS},shipping:{shipsFrom:offer.shipsFrom,deliveryEstimateLabel:offer.deliveryEstimateLabel},returnsDays:30,warrantyLabel:"1-year DealDemon warranty",reviews:getReviewsForSku(product.sku),contentBlocks:content.contentBlocks,hiddenContent:content.hiddenContent};}
 getCart(cartId?:string){return this.carts.getOrCreateCart(cartId);}
 addCartItem(cartId:string,sku:string,quantity:number,variant?:VariantSelection){const product=findProduct(sku);const offer=product&&getDealDemonOffer(product.sku);if(!product||!offer)throw new DealDemonServiceError("PRODUCT_NOT_FOUND",`Product not found: ${sku}`);return this.carts.addItem(cartId,product,offer,quantity,variant);}
 setCartQuantity(cartId:string,lineId:string,quantity:number){return this.carts.setLineQuantity(cartId,lineId,quantity);}
 removeCartLine(cartId:string,lineId:string){return this.carts.removeLine(cartId,lineId);}
 clearCart(cartId:string){return this.carts.clearCart(cartId);}
 cartView(cartId:string,deliveryMethod:DeliveryMethod="STANDARD") {const cart=this.carts.requireCart(cartId);const entries=priceCartLines(cart);const lines=entries.map(({line,product,offer})=>({...line,name:product.name,slug:product.slug,offer,seller:getSellerDisplay(product.sku)}));const pricing=cart.lines.length?getAdvertisedPricing(entries,deliveryMethod):{merchandiseSubtotalCents:0,extraChargesCents:0,shippingCents:0,taxCents:0,computedTotalCents:0,lineItems:[]};return{merchantId:MERCHANT_ID,cart:{...cart,lines},pricing,deliveryMethod};}
 createQuote(cartId:string,deliveryMethod:DeliveryMethod="STANDARD",options:{quoteId?:string;issuedAt?:string|Date;expiresInMs?:number;createId?:()=>string;now?:()=>Date}={}):DealQuote{const cart=this.carts.requireCart(cartId);if(!cart.lines.length)throw new DealDemonServiceError("EMPTY_CART","Add an item before requesting a quote");const quote=buildDealDemonQuote(cart,deliveryMethod,this.quoteSecret,options);this.issuedQuotes.set(quote.quoteId,structuredClone(quote));return structuredClone(quote);}
 createHandoff(cartId:string,deliveryMethod:DeliveryMethod="STANDARD"):DealHandoff{return{status:"READY_FOR_RECOURSE",merchantId:MERCHANT_ID,quote:this.createQuote(cartId,deliveryMethod),payment:{provider:"PAYPAL",environment:"sandbox",merchantProfileId:"dealdemon",merchantDisplayName:"Recourse DealDemon Merchant",flow:"RECOURSE_GATEWAY_THEN_PAYPAL_HOSTED_APPROVAL",orderCreated:false,approvalCreated:false,captureCreated:false}};}
 getIssuedQuote(quoteId:string):DealQuote|null{const quote=this.issuedQuotes.get(quoteId);return quote?structuredClone(quote):null;}
 getAttackManifest(){return ATTACK_MANIFEST;}
}
