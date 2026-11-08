import { getReviewsForSku } from "./reviews.js";
import type {
  CanonicalProduct,
  ContentBlock,
} from "../../store-core/src/index.js";

export function getContentBlocks(product: CanonicalProduct): ContentBlock[] {
  const blocks: ContentBlock[] = [
    {
      id: `${product.sku}-description`,
      kind: "DESCRIPTION",
      placement: "product-detail",
      visibility: "VISIBLE",
      text: product.longDescription,
      source: "MERCHANT",
    },
    ...product.features.map(
      (text, index): ContentBlock => ({
        id: `${product.sku}-feature-${index + 1}`,
        kind: "FEATURE",
        placement: "highlights",
        visibility: "VISIBLE",
        text,
        source: "MERCHANT",
      }),
    ),
    ...Object.entries(product.specifications).map(
      ([key, value]): ContentBlock => ({
        id: `${product.sku}-spec-${key}`,
        kind: "SPECIFICATION",
        placement: "specifications",
        visibility: "VISIBLE",
        text: `${key}: ${value}`,
        source: "MERCHANT",
      }),
    ),
    {
      id: `${product.sku}-seller`,
      kind: "SELLER",
      placement: "seller-terms",
      visibility: "VISIBLE",
      text: "Sold by NovaMart Official. Verified seller. 30-day returns.",
      source: "MERCHANT",
    },
    ...getReviewsForSku(product.sku).map(
      (review): ContentBlock => ({
        id: review.id,
        kind: "REVIEW",
        placement: "reviews",
        visibility: "VISIBLE",
        text: `${review.title}: ${review.body}`,
        source: "MERCHANT",
      }),
    ),
  ];
  return blocks;
}
