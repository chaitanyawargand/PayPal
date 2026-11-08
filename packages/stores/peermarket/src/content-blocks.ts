import type { CanonicalProduct, ContentBlock, StoreOffer } from "../../store-core/src/index.js";
import { getPeerRiskFacts } from "./offers.js";
import { getListingNotesForSku } from "./listing-notes.js";
import { getReviewsForSku } from "./reviews.js";
export function getContentBlocks(product:CanonicalProduct,offer:StoreOffer):ContentBlock[]{
 return [
  {id:`${product.sku}-description`,kind:"DESCRIPTION",placement:"product-detail",visibility:"VISIBLE",text:product.longDescription,source:"MERCHANT"},
  ...product.features.map((text,index):ContentBlock=>({id:`${product.sku}-feature-${index+1}`,kind:"FEATURE",placement:"highlights",visibility:"VISIBLE",text,source:"MERCHANT"})),
  ...Object.entries(product.specifications).map(([key,value]):ContentBlock=>({id:`${product.sku}-spec-${key}`,kind:"SPECIFICATION",placement:"specifications",visibility:"VISIBLE",text:`${key}: ${value}`,source:"MERCHANT"})),
  ...getListingNotesForSku(product.sku).map((text,index):ContentBlock=>({id:`${product.sku}-condition-${index+1}`,kind:"OTHER",placement:"seller-condition-notes",visibility:"VISIBLE",text,source:"MERCHANT"})),
  {id:`${product.sku}-seller-terms`,kind:"SELLER",placement:"seller-terms",visibility:"VISIBLE",text:getPeerRiskFacts(offer).join(". "),source:"MERCHANT"},
  ...getReviewsForSku(product.sku).map(review=>({id:review.id,kind:"REVIEW" as const,placement:"reviews",visibility:"VISIBLE" as const,text:`${review.title}: ${review.body}`,source:"MERCHANT" as const})),
 ];
}
