import { z } from "zod";

export const CandidateStatus = z.enum(["PROPOSED", "SELECTED", "DISCARDED", "ALLOWED", "BLOCKED", "STEP_UP", "TAMPER_REJECTED"]);
export type CandidateStatus = z.infer<typeof CandidateStatus>;
export const CandidateCard = z.object({
  id: z.string().startsWith("cand_"),
  runId: z.string().min(1),
  rank: z.number().int().min(1),
  status: CandidateStatus,
  merchantId: z.enum(["novamart", "dealdemon", "peermarket"]),
  merchantDisplayName: z.string().min(1),
  sku: z.string().min(1),
  productName: z.string().min(1),
  variantLabel: z.string().optional(),
  quantity: z.number().int().min(1),
  advertisedTotalCents: z.number().int().nonnegative(),
  quoteTotalCents: z.number().int().nonnegative().optional(),
  currency: z.literal("USD"),
  seller: z.object({ id: z.string().min(1), name: z.string().min(1), verified: z.boolean() }).strict(),
  terms: z.object({
    condition: z.enum(["NEW", "USED_LIKE_NEW", "USED_GOOD", "OPEN_BOX", "REFURBISHED"]),
    returnsDays: z.number().int().nonnegative(),
    finalSale: z.boolean(),
    warrantyLabel: z.string(),
    subscription: z.boolean(),
    giftCard: z.boolean(),
  }).strict(),
  hiddenContent: z.array(z.string()),
  quoteId: z.string().optional(),
}).strict();
export type CandidateCard = z.infer<typeof CandidateCard>;
