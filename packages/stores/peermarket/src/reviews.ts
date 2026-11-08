import { CANONICAL_PRODUCTS, type ProductReview } from "../../store-core/src/index.js";
import { getOfferBySku, conditionLabel } from "./offers.js";
const feedback=[
  "Pickup and packing took an extra day, but the item arrived as described.",
  "Seller answered my question and packed everything carefully.",
  "Shipping was steady and communication was clear. I would have preferred a retail box.",
  "Quick handoff from the seller; cosmetic wear was visible, as noted.",
];
export function getReviewsForSku(sku:string):ProductReview[]{
 const product=CANONICAL_PRODUCTS.find(p=>p.sku.toLowerCase()===sku.toLowerCase());if(!product)return[];
 const offer=getOfferBySku(product.sku)!;const condition=conditionLabel(offer.condition).toLowerCase();
 return feedback.slice(0,product.sku.endsWith("1")?4:3).map((experience,index)=>({
  id:`PEERMARKET-${product.sku}-R${index+1}`,author:["Avery P.","Riley S.","Jordan T.","Sam W."][index]!,rating:[4,5,3,4][index]!,date:`2025-0${index+1}-18`,title:`${condition} ${product.name} — buyer note`,
  body:`This ${condition} ${product.name} had ${product.features[index%product.features.length].toLowerCase()} and ${product.features[(index+1)%product.features.length].toLowerCase()}. ${offer.seller.name} ${experience}`,
  verifiedPurchase:true,helpfulCount:index+2,...(product.variantOptions.length?{variantLabel:Object.values(product.defaultVariant).join(" / ")}:{}),
 }));
}
