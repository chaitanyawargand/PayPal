import { CANONICAL_PRODUCTS, type ItemCondition, type SellerFacts, type StoreOffer } from "../../store-core/src/index.js";
import { PEERMARKET_SELLERS } from "./sellers.js";

export { PEERMARKET_SELLERS } from "./sellers.js";
type OfferDefinition = { price:number; condition:ItemCondition; seller:string };
const definitions:Record<string,OfferDefinition>={
  "JKT-001":{price:13900,condition:"OPEN_BOX",seller:"SEL-NORTHLOOP"},"JKT-002":{price:5900,condition:"USED_GOOD",seller:"SEL-CLOSETSWAP"},"JKT-003":{price:17900,condition:"USED_LIKE_NEW",seller:"SEL-GEARAGAIN"},"JKT-004":{price:8900,condition:"OPEN_BOX",seller:"SEL-CLOSETSWAP"},"JKT-005":{price:7900,condition:"USED_GOOD",seller:"SEL-NORTHLOOP"},
  "HDP-001":{price:3900,condition:"USED_GOOD",seller:"SEL-TECHTURNOVER"},"HDP-002":{price:2900,condition:"OPEN_BOX",seller:"SEL-BUDGETFINDS"},"HDP-003":{price:7900,condition:"USED_LIKE_NEW",seller:"SEL-TECHTURNOVER"},"HDP-004":{price:6400,condition:"USED_GOOD",seller:"SEL-BUDGETFINDS"},"HDP-005":{price:2400,condition:"OPEN_BOX",seller:"SEL-TECHTURNOVER"},
  "RUN-001":{price:7900,condition:"USED_GOOD",seller:"SEL-SECONDSTRIDE"},"RUN-002":{price:6400,condition:"USED_LIKE_NEW",seller:"SEL-SECONDSTRIDE"},"RUN-003":{price:6900,condition:"OPEN_BOX",seller:"SEL-GEARAGAIN"},"RUN-004":{price:6900,condition:"USED_GOOD",seller:"SEL-SECONDSTRIDE"},"RUN-005":{price:9900,condition:"OPEN_BOX",seller:"SEL-URBANGARAGE"},
  "BPK-001":{price:4900,condition:"USED_LIKE_NEW",seller:"SEL-PACKANDPOST"},"BPK-002":{price:8900,condition:"USED_GOOD",seller:"SEL-GEARAGAIN"},"BPK-003":{price:4400,condition:"OPEN_BOX",seller:"SEL-URBANGARAGE"},"BPK-004":{price:7900,condition:"USED_GOOD",seller:"SEL-PACKANDPOST"},"BPK-005":{price:2900,condition:"USED_LIKE_NEW",seller:"SEL-CLOSETSWAP"},
};
const sellerById = new Map(PEERMARKET_SELLERS.map((seller)=>[seller.id,seller]));
export const PEERMARKET_OFFERS:readonly StoreOffer[]=Object.freeze(CANONICAL_PRODUCTS.map((product,index)=>{
  const d=definitions[product.sku]!;const seller=sellerById.get(d.seller)!;
  return {sku:product.sku,merchantId:"peermarket",unitPriceCents:d.price,condition:d.condition,rating:3.8+(index%8)*0.1,reviewCount:5+(index%7)*3,stock:1+(index%5),seller:{...seller} as SellerFacts,warrantyLabel:"No warranty included",returnsDays:0,finalSale:true,shipsFrom:seller.location!,deliveryEstimateLabel:"4–8 business days — peer seller dispatch"};
}));
export function getOfferBySku(sku:string):StoreOffer|undefined{return PEERMARKET_OFFERS.find(offer=>offer.sku.toLowerCase()===sku.toLowerCase());}
export function conditionLabel(condition:ItemCondition):string {return condition==="USED_GOOD"?"Used (Good)":condition==="USED_LIKE_NEW"?"Used (Like New)":condition==="OPEN_BOX"?"Open Box":condition.replaceAll("_"," ");}
export function getPeerRiskFacts(offer:StoreOffer):string[]{return ["Seller is not verified by PeerMarket",`${offer.condition.startsWith("USED")?"Used item":"Open-box item"} — ${conditionLabel(offer.condition)}`,"Final sale — no returns",offer.warrantyLabel,offer.seller.accountAgeLabel??"Seller account age not provided"];}
