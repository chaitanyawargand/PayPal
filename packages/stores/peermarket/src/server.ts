import http from "node:http";
import { getProductBySlug, type DeliveryMethod, type VariantSelection } from "../../store-core/src/index.js";
import { APP_CSS, CLIENT_JS } from "./assets.js";
import type { PeerMarketConfig } from "./config.js";
import { conditionLabel } from "./offers.js";
import { renderCart, renderCheckout, renderHandoff, renderHome, renderNotFound, renderProduct, renderSearch } from "./pages.js";
import { MERCHANT_ID, PeerMarketServiceError, PeerMarketStorefront } from "./storefront.js";

const COOKIE_NAME="peermarket_cart_id";const MAX_BODY_BYTES=64*1024;
type Identity={id:string;isNew:boolean};
function send(res:http.ServerResponse,status:number,body:string,type="text/html; charset=utf-8",headers:Record<string,string>={}){res.writeHead(status,{"Content-Type":type,"X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'","Referrer-Policy":"strict-origin-when-cross-origin",...headers});res.end(body);}
function json(res:http.ServerResponse,status:number,data:unknown,headers:Record<string,string>={}){send(res,status,JSON.stringify(data),"application/json; charset=utf-8",headers);}
class InvalidJsonError extends Error{}
function parseCookie(header:string|undefined):string|undefined{for(const part of(header??"").split(";")){const[key,...rest]=part.trim().split("=");if(key===COOKIE_NAME)return decodeURIComponent(rest.join("="));}return undefined;}
function identity(req:http.IncomingMessage,store:PeerMarketStorefront):Identity{const header=req.headers["x-cart-id"];const value=(Array.isArray(header)?header[0]:header)||parseCookie(req.headers.cookie);return value?{id:value,isNew:false}:{id:store.getCart().id,isNew:true};}
function cookie(identity:Identity):Record<string,string>{return identity.isNew?{"Set-Cookie":`${COOKIE_NAME}=${encodeURIComponent(identity.id)}; HttpOnly; SameSite=Lax; Path=/`}:{};}
async function readJson(req:http.IncomingMessage):Promise<any>{const chunks:Buffer[]=[];let size=0;for await(const part of req){const chunk=Buffer.isBuffer(part)?part:Buffer.from(part);size+=chunk.length;if(size>MAX_BODY_BYTES)throw new PeerMarketServiceError("INVALID_QUOTE","Request body too large");chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new InvalidJsonError();}}
function delivery(value:string|null|undefined):DeliveryMethod{if(!value||value==="STANDARD")return"STANDARD";if(value==="EXPRESS")return"EXPRESS";throw new PeerMarketServiceError("INVALID_QUOTE","deliveryMethod must be STANDARD or EXPRESS");}
function statusFor(code:string){if(code==="PRODUCT_NOT_FOUND"||code==="CART_NOT_FOUND"||code==="CART_LINE_NOT_FOUND")return 404;if(code==="EMPTY_CART"||code.startsWith("INVALID_")||code==="INSUFFICIENT_STOCK")return 400;return 500;}
function errorResponse(res:http.ServerResponse,error:unknown){if(error instanceof InvalidJsonError)return json(res,400,{error:{code:"INVALID_JSON",message:"Request body must be valid JSON"}});if(error instanceof PeerMarketServiceError)return json(res,statusFor(error.code),{error:{code:error.code,message:error.message}});if(error&&typeof error==="object"&&"code"in error&&typeof error.code==="string"&&["INVALID_CENTS","INVALID_QUANTITY","INVALID_VARIANT","INSUFFICIENT_STOCK","CART_NOT_FOUND","CART_LINE_NOT_FOUND","PRODUCT_NOT_FOUND"].includes(error.code)){const message="message"in error&&typeof error.message==="string"?error.message:"Invalid request";return json(res,statusFor(error.code),{error:{code:error.code,message}});}return json(res,500,{error:{code:"INTERNAL_ERROR",message:"An unexpected error occurred"}});}
function params(url:URL):Record<string,string>{return Object.fromEntries(url.searchParams.entries());}

export function createPeerMarketServer(config:PeerMarketConfig):http.Server{
 const store=new PeerMarketStorefront(config.quoteSecret,config.quoteSigning);let server:http.Server;
 server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url??"/","http://127.0.0.1");const path=url.pathname;const method=req.method??"GET";
  if(method==="GET"&&path==="/health"){const address=server.address();const port=address&&typeof address!=="string"?address.port:config.port;return json(res,200,{ok:true,service:"peermarket",merchantId:MERCHANT_ID,port,quoteSigning:config.quoteSigning});}
  if(method==="GET"&&path==="/assets/app.css")return send(res,200,APP_CSS,"text/css; charset=utf-8");
  if(method==="GET"&&path==="/assets/client.js")return send(res,200,CLIENT_JS,"text/javascript; charset=utf-8");
  if(path.startsWith("/api/")){
   if(method==="POST"&&path==="/api/attack/plant"){const b=await readJson(req);if(b?.storeId!==MERCHANT_ID||typeof b?.productSku!=="string"||typeof b?.instruction!=="string"||!b.instruction.trim()||!["description","reviews","specifications"].includes(b?.placement))return json(res,400,{error:{code:"INVALID_ATTACK",message:"A valid merchant, SKU, placement, and instruction are required"}});if(!store.productDetail(b.productSku))return json(res,404,{error:{code:"PRODUCT_NOT_FOUND",message:"Product not found"}});store.plantAttack({storeId:MERCHANT_ID,productSku:b.productSku,placement:b.placement,instruction:b.instruction,plantedAt:new Date().toISOString()});return json(res,200,{success:true});}
   if(method==="POST"&&path==="/api/attack/clear"){store.clearAttack();return json(res,200,{success:true});}
   if(method==="GET"&&path==="/api/search"){
    const max=url.searchParams.get("maxPriceCents");const results=store.search({query:url.searchParams.get("q")??undefined,category:url.searchParams.get("category")??undefined,brand:url.searchParams.get("brand")??undefined,feature:url.searchParams.get("feature")??undefined,maxUnitPriceCents:max===null?undefined:Number(max),sort:(url.searchParams.get("sort")??"relevance") as never,condition:(url.searchParams.get("condition")??undefined) as never});
    return json(res,200,{merchantId:MERCHANT_ID,count:results.length,results:results.map(({product,offer,estimatedTotalForOneCents,riskFacts})=>({sku:product.sku,slug:product.slug,name:product.name,brand:product.brand,category:product.category,features:product.features.slice(0,2),advertisedUnitPriceCents:offer.unitPriceCents,estimatedTotalForOneCents,rating:offer.rating,reviewCount:offer.reviewCount,stock:offer.stock,condition:offer.condition,conditionLabel:conditionLabel(offer.condition),finalSale:offer.finalSale,returnsDays:offer.returnsDays,warrantyLabel:offer.warrantyLabel,seller:offer.seller,riskFacts,productUrl:`/products/${product.slug}`}))});
   }
   if(method==="GET"&&path.startsWith("/api/products/")){const sku=decodeURIComponent(path.slice("/api/products/".length));const detail=store.productDetail(sku);return detail?json(res,200,detail):json(res,404,{error:{code:"PRODUCT_NOT_FOUND",message:"Product not found"}});}
   if(method==="GET"&&path==="/api/cart"){const cart=identity(req,store);return json(res,200,store.cartView(cart.id,delivery(url.searchParams.get("deliveryMethod"))),cookie(cart));}
   if(method==="POST"&&path==="/api/cart/items"){const body=await readJson(req);const cart=identity(req,store);if(typeof body?.sku!=="string"||!Number.isSafeInteger(body?.quantity))throw new PeerMarketServiceError("INVALID_QUANTITY","sku and integer quantity are required");if(body.variant!==undefined&&(!body.variant||typeof body.variant!=="object"||Array.isArray(body.variant)))throw new PeerMarketServiceError("INVALID_VARIANT","variant must be an object");store.addCartItem(cart.id,body.sku,body.quantity,body.variant as VariantSelection|undefined);return json(res,200,store.cartView(cart.id),cookie(cart));}
   if(method==="PATCH"&&path==="/api/cart/items"){const body=await readJson(req);const cart=identity(req,store);if(typeof body?.lineId!=="string"||!Number.isSafeInteger(body?.quantity))throw new PeerMarketServiceError("INVALID_QUANTITY","lineId and integer quantity are required");store.setCartQuantity(cart.id,body.lineId,body.quantity);return json(res,200,store.cartView(cart.id),cookie(cart));}
   if(method==="DELETE"&&path==="/api/cart/items"){const cart=identity(req,store);const lineId=url.searchParams.get("lineId");if(!lineId)throw new PeerMarketServiceError("CART_LINE_NOT_FOUND","lineId is required");store.removeCartLine(cart.id,lineId);return json(res,200,store.cartView(cart.id),cookie(cart));}
   if(method==="POST"&&path==="/api/cart/clear"){const cart=identity(req,store);store.clearCart(cart.id);return json(res,200,store.cartView(cart.id),cookie(cart));}
   if(method==="POST"&&(path==="/api/quote"||path==="/api/checkout/handoff")){const body=await readJson(req);const cart=identity(req,store);const selected=delivery(body?.deliveryMethod);const result=path==="/api/quote"?store.createQuote(cart.id,selected):store.createHandoff(cart.id,selected);return json(res,200,result,cookie(cart));}
   if(method==="GET"&&path.startsWith("/api/quotes/")){const quote=store.getIssuedQuote(decodeURIComponent(path.slice("/api/quotes/".length)));return quote?json(res,200,quote):json(res,404,{error:{code:"QUOTE_NOT_FOUND",message:"Quote not found"}});}
   return json(res,404,{error:{code:"NOT_FOUND",message:"API endpoint not found"}});
  }
  if(method!=="GET")return send(res,405,renderNotFound());
  const cart=identity(req,store);const headers=cookie(cart);
  if(path==="/")return send(res,200,renderHome(store),undefined,headers);
  if(path==="/search")return send(res,200,renderSearch(store,params(url)),undefined,headers);
  if(path==="/cart")return send(res,200,renderCart(store.cartView(cart.id,delivery(url.searchParams.get("deliveryMethod")))),undefined,headers);
  if(path==="/checkout")return send(res,200,renderCheckout(store.cartView(cart.id)),undefined,headers);
  if(path==="/checkout/handoff"){const quoteId=url.searchParams.get("quoteId");const quote=quoteId?store.getIssuedQuote(quoteId):null;return quote?send(res,200,renderHandoff(quote),undefined,headers):send(res,404,renderNotFound(),undefined,headers);}
  if(path.startsWith("/products/")){const product=getProductBySlug(decodeURIComponent(path.slice("/products/".length)));return product?send(res,200,renderProduct(store,product),undefined,headers):send(res,404,renderNotFound(),undefined,headers);}
  return send(res,404,renderNotFound(),undefined,headers);
 }catch(error){errorResponse(res,error);}});
 return server;
}
