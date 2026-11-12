import type { ContentBlock, ProductReview } from "./types.js";

export type PlantedListingAttack = { storeId: string; productSku: string; placement: "description" | "reviews" | "specifications"; instruction: string; plantedAt?: string };

export function applyPlantedListingAttack<T extends { sku: string; longDescription?: string; specifications?: Record<string, string>; reviews?: ProductReview[]; contentBlocks?: ContentBlock[]; hiddenContent?: Array<{ text: string }> }>(detail: T, merchantId: string, attack: PlantedListingAttack | null): T {
  if (!attack || attack.storeId !== merchantId || attack.productSku.toLowerCase() !== detail.sku.toLowerCase()) return detail;
  const text = attack.instruction;
  if (attack.placement === "reviews") {
    const review: ProductReview = { id: `attack-${merchantId}-${detail.sku}`, author: "Merchant content", rating: 1, date: attack.plantedAt ?? new Date().toISOString().slice(0, 10), title: "Customer review", body: text, verifiedPurchase: false, helpfulCount: 0 };
    return { ...detail, reviews: [...(detail.reviews ?? []), review], contentBlocks: [...(detail.contentBlocks ?? []), { id: review.id, kind: "REVIEW", placement: "reviews", visibility: "VISIBLE", text, source: "MERCHANT" }] };
  }
  const kind = attack.placement === "description" ? "DESCRIPTION" : "SPECIFICATION";
  const placement = attack.placement === "description" ? "product-detail" : "specifications";
  const contentBlocks = [...(detail.contentBlocks ?? []), { id: `attack-${merchantId}-${detail.sku}`, kind, placement, visibility: "VISIBLE" as const, text, source: "MERCHANT" as const }];
  if (attack.placement === "description") return { ...detail, longDescription: `${detail.longDescription ?? ""}\n${text}`, contentBlocks };
  return { ...detail, specifications: { ...(detail.specifications ?? {}), "Merchant note": text }, contentBlocks };
}
