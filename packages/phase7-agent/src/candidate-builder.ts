import { CandidateCard, type CandidateCard as Candidate } from "../../phase7-contracts/src/candidate.js";
import { MERCHANTS, type MerchantId } from "./config.js";
import { AgentError } from "./errors.js";
import { ProductDetailSchema } from "./store-schemas.js";
import type { QuoteToolResult } from "./merchant-tools.js";

export function buildCandidateCard(input: {
  runId: string;
  merchantId: MerchantId;
  sku: string;
  quantity: number;
  product: unknown;
  quote: unknown;
  variant?: Record<string, string>;
}): Candidate {
  const productResult = ProductDetailSchema.safeParse(input.product);
  if (!productResult.success) throw new AgentError("STORE_INVALID_RESPONSE", `Store ${input.merchantId} returned incomplete product terms.`);
  const quote = zQuote(input.quote, input.merchantId);
  const product = productResult.data;
  if (product.sku.toLowerCase() !== input.sku.toLowerCase()) throw new AgentError("STORE_INVALID_RESPONSE", `Store ${input.merchantId} returned a different product.`);
  const selectedVariant = input.variant ?? product.defaultVariant;
  const variantLabel = Object.entries(selectedVariant).map(([key, value]) => `${key}: ${value}`).join(", ");
  return CandidateCard.parse({
    id: `cand_${encodeURIComponent(input.runId)}_${input.merchantId}_${product.sku}`,
    runId: input.runId,
    rank: 1,
    status: "PROPOSED",
    merchantId: input.merchantId,
    merchantDisplayName: MERCHANTS[input.merchantId].displayName,
    sku: product.sku,
    productName: product.name,
    ...(variantLabel ? { variantLabel } : {}),
    quantity: input.quantity,
    advertisedTotalCents: quote.advertisedTotalCents,
    quoteTotalCents: quote.quoteTotalCents,
    currency: "USD",
    seller: product.seller,
    terms: { ...product.advertisedTerms },
    hiddenContent: product.hiddenContent.map((block) => block.text),
    quoteId: quote.quoteId,
  });
}

function zQuote(value: unknown, merchantId: MerchantId): QuoteToolResult {
  if (!value || typeof value !== "object") throw new AgentError("STORE_INVALID_RESPONSE", `Store ${merchantId} returned an invalid quote summary.`);
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.quoteId !== "string" || candidate.quoteId.length === 0
    || !Number.isSafeInteger(candidate.quoteTotalCents) || (candidate.quoteTotalCents as number) < 0
    || !Number.isSafeInteger(candidate.advertisedTotalCents) || (candidate.advertisedTotalCents as number) < 0) {
    throw new AgentError("STORE_INVALID_RESPONSE", `Store ${merchantId} returned an invalid quote summary.`);
  }
  return { quoteId: candidate.quoteId, quoteTotalCents: candidate.quoteTotalCents as number, advertisedTotalCents: candidate.advertisedTotalCents as number };
}
