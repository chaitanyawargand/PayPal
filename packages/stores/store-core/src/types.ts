import type { StoreCoreErrorCode } from "./errors.js";
export type Cents = number;
export const PRODUCT_CATEGORIES = [
  { id: "JACKETS", label: "Waterproof Jackets" },
  { id: "HEADPHONES", label: "Wireless Headphones" },
  { id: "RUNNING_SHOES", label: "Running Shoes" },
  { id: "BACKPACKS", label: "Travel Backpacks" },
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]["id"];
export type VariantOption = { id: string; label: string; values: readonly string[] };
export type VariantSelection = Record<string, string>;
export type CanonicalProduct = {
  sku: string; slug: string; name: string; brand: string; category: ProductCategory;
  shortDescription: string; longDescription: string; features: readonly string[];
  specifications: Readonly<Record<string, string>>; variantOptions: readonly VariantOption[];
  defaultVariant: VariantSelection; visual: { icon: string; palette: readonly string[]; motif: string };
  searchTerms: readonly string[];
};
export type SellerFacts = { id: string; name: string; verified: boolean; rating?: number; accountAgeLabel?: string; location?: string };
export type ItemCondition = "NEW" | "USED_LIKE_NEW" | "USED_GOOD" | "OPEN_BOX" | "REFURBISHED";
export type StoreOffer = { sku: string; merchantId: string; unitPriceCents: Cents; compareAtPriceCents?: Cents; rating: number; reviewCount: number; stock: number; condition: ItemCondition; seller: SellerFacts; warrantyLabel: string; returnsDays: number; finalSale: boolean; shipsFrom: string; deliveryEstimateLabel: string };
export type ProductReview = { id: string; author: string; rating: number; date: string; title: string; body: string; verifiedPurchase: boolean; helpfulCount: number; variantLabel?: string };
export type ContentBlock = { id: string; kind: "DESCRIPTION"|"FEATURE"|"SPECIFICATION"|"REVIEW"|"SELLER"|"CHECKOUT_NOTE"|"IMAGE_ALT"|"OTHER"; placement: string; visibility: "VISIBLE"|"HIDDEN"; text: string; source: "MERCHANT" };
export type CartLine = { id: string; sku: string; quantity: number; variant: VariantSelection; unitPriceCents: Cents; amountCents: Cents };
export type Cart = { id: string; createdAt: string; updatedAt: string; lines: CartLine[] };
export type QuoteLineItem = { id: string; kind: "PRODUCT"|"SHIPPING"|"TAX"|"FEE"|"DISCOUNT"; label: string; amountCents: Cents; sku?: string; quantity?: number; unitAmountCents?: Cents; variant?: VariantSelection };
export type StoreQuotePayload = { version: string; merchantId: string; merchantName: string; quoteId: string; cartId: string; currency: "USD"; issuedAt: string; expiresAt: string; items: { sku: string; name: string; quantity: number; unitAmountCents: Cents; amountCents: Cents; variant: VariantSelection }[]; lineItems: QuoteLineItem[]; subtotalCents: Cents; shippingCents: Cents; taxCents: Cents; totalCents: Cents; computedTotalCents: Cents; seller: SellerFacts; terms: { condition: ItemCondition; returnsDays: number; finalSale: boolean; subscription: boolean; giftCard: boolean; warrantyLabel?: string } };
export type SignedStoreQuote = StoreQuotePayload & { signatureAlgorithm: "HMAC-SHA256"; signature: string };
export type StoreCoreErrorType = StoreCoreErrorCode;
