import { z } from "zod";
import { MERCHANT_IDS } from "./config.js";

const MerchantIdSchema = z.enum(MERCHANT_IDS as [typeof MERCHANT_IDS[number], ...typeof MERCHANT_IDS[number][]]);
export const SellerResponseSchema = z.object({ id: z.string().min(1), name: z.string().min(1), verified: z.boolean() });
export const SearchResultSchema = z.object({
  sku: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  estimatedTotalForOneCents: z.number().int().nonnegative(),
  advertisedUnitPriceCents: z.number().int().nonnegative(),
  seller: SellerResponseSchema,
});
export const SearchResponseSchema = z.object({
  merchantId: MerchantIdSchema,
  count: z.number().int().nonnegative(),
  results: z.array(SearchResultSchema),
});
export const AdvertisedTermsSchema = z.object({
  condition: z.enum(["NEW", "USED_LIKE_NEW", "USED_GOOD", "OPEN_BOX", "REFURBISHED"]),
  returnsDays: z.number().int().nonnegative(),
  finalSale: z.boolean(),
  subscription: z.boolean(),
  giftCard: z.boolean(),
  warrantyLabel: z.string(),
}).strict();
export const HiddenContentSchema = z.array(z.object({ text: z.string() }));
export const ProductDetailSchema = z.object({
  sku: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  defaultVariant: z.record(z.string(), z.string()),
  seller: SellerResponseSchema,
  advertisedTerms: AdvertisedTermsSchema,
  hiddenContent: HiddenContentSchema,
});
export const CartMutationResponseSchema = z.object({
  cart: z.object({ id: z.string().min(1) }),
  pricing: z.object({ computedTotalCents: z.number().int().nonnegative() }),
});
// Zod strips all other quote payload fields, including signature material.
export const QuoteResponseSchema = z.object({
  quoteId: z.string().min(1),
  totalCents: z.number().int().nonnegative(),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;
export type ProductDetail = z.infer<typeof ProductDetailSchema>;
