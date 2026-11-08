import { CANONICAL_PRODUCTS } from "./catalog.js";
import { PRODUCT_CATEGORIES, type CanonicalProduct, type ProductCategory, type StoreOffer } from "./types.js";
export type SearchResult={product:CanonicalProduct;offer:StoreOffer;score:number};
export function searchCatalog(input:{offers:readonly StoreOffer[];query?:string;category?:ProductCategory;brand?:string;feature?:string;maxUnitPriceCents?:number;sort?:"relevance"|"price_asc"|"price_desc"|"rating";inStockOnly?:boolean}):SearchResult[]{
 const tokens=(input.query??"").toLowerCase().trim().split(/\s+/).filter(Boolean);
 const results:SearchResult[]=[];
 for(const offer of input.offers){const product=CANONICAL_PRODUCTS.find(p=>p.sku===offer.sku);if(!product)continue;if(input.category&&product.category!==input.category)continue;if(input.brand&&product.brand.toLowerCase()!==input.brand.toLowerCase())continue;if(input.maxUnitPriceCents!==undefined&&offer.unitPriceCents>input.maxUnitPriceCents)continue;if(input.inStockOnly&&offer.stock<=0)continue;
 const category=PRODUCT_CATEGORIES.find(c=>c.id===product.category)?.label??"";const fields=[product.name,product.brand,product.sku,category,...product.features,...Object.values(product.specifications),...product.searchTerms].map(s=>s.toLowerCase());if(input.feature&&!fields.some(s=>s.includes(input.feature!.toLowerCase())))continue;if(!tokens.every(token=>fields.some(f=>f.includes(token))))continue;
 let score=0;if(tokens.length&&[product.name,product.brand,product.sku].some(x=>x.toLowerCase()===tokens.join(" ")))score+=100;for(const token of tokens){if(product.name.toLowerCase().includes(token))score+=20;if(product.brand.toLowerCase().includes(token)||product.sku.toLowerCase()===token)score+=15;if(product.features.some(f=>f.toLowerCase().includes(token)))score+=10;if(product.searchTerms.some(t=>t.toLowerCase().includes(token)))score+=3;}
 results.push({product,offer,score});}
 const sort=input.sort??"relevance";return results.sort((a,b)=>sort==="price_asc"?a.offer.unitPriceCents-b.offer.unitPriceCents||a.product.sku.localeCompare(b.product.sku):sort==="price_desc"?b.offer.unitPriceCents-a.offer.unitPriceCents||a.product.sku.localeCompare(b.product.sku):sort==="rating"?b.offer.rating-a.offer.rating||b.offer.reviewCount-a.offer.reviewCount||a.product.sku.localeCompare(b.product.sku):b.score-a.score||a.product.sku.localeCompare(b.product.sku));
}
