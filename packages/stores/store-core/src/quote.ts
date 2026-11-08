import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { StoreCoreError } from "./errors.js";
import { assertIntegerCents } from "./money.js";
import type {
  ItemCondition,
  QuoteLineItem,
  SellerFacts,
  SignedStoreQuote,
  StoreQuotePayload,
} from "./types.js";
export const STORE_QUOTE_VERSION = "recourse.store-quote.v1";
type Secret = string | Buffer;
function signingBytes(
  payload: Record<string, unknown>,
  secret: Secret,
): Buffer {
  const clean = { ...payload };
  delete clean.signature;
  return createHmac("sha256", secret)
    .update(canonicalJson(clean), "utf8")
    .digest();
}
export function signQuotePayload<T extends Record<string, unknown>>(
  payload: T,
  secret: Secret,
): string {
  return signingBytes(payload, secret).toString("base64url");
}
export function verifySignedQuote(quote: unknown, secret: Secret): boolean {
  try {
    if (!quote || typeof quote !== "object" || Array.isArray(quote))
      return false;
    const object = quote as Record<string, unknown>;
    if (
      object.signatureAlgorithm !== "HMAC-SHA256" ||
      typeof object.signature !== "string" ||
      !object.signature
    )
      return false;
    const expected = signingBytes(object, secret);
    const actual = Buffer.from(object.signature, "base64url");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}
export function validateQuoteConsistency(value: unknown): string[] {
  const issues: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value))
    return ["INVALID_QUOTE"];
  const q = value as Record<string, any>;
  if (!Array.isArray(q.lineItems)) {
    issues.push("MISSING_LINE_ITEMS");
    return issues;
  }
  let sum = 0,
    subtotal = 0,
    shipping = 0,
    tax = 0;
  for (const item of q.lineItems) {
    if (
      !item ||
      typeof item !== "object" ||
      !Number.isSafeInteger(item.amountCents)
    ) {
      issues.push("NON_INTEGER_CENTS");
      continue;
    }
    sum += item.amountCents;
    if (item.kind === "PRODUCT") subtotal += item.amountCents;
    if (item.kind === "SHIPPING") shipping += item.amountCents;
    if (item.kind === "TAX") tax += item.amountCents;
  }
  for (const n of [
    q.subtotalCents,
    q.shippingCents,
    q.taxCents,
    q.totalCents,
    q.computedTotalCents,
  ])
    if (!Number.isSafeInteger(n)) issues.push("NON_INTEGER_CENTS");
  if (Number.isSafeInteger(q.totalCents) && sum !== q.totalCents)
    issues.push("LINE_ITEMS_SUM_MISMATCH");
  if (
    Number.isSafeInteger(q.computedTotalCents) &&
    sum !== q.computedTotalCents
  )
    issues.push("COMPUTED_TOTAL_MISMATCH");
  if (
    Number.isSafeInteger(q.totalCents) &&
    Number.isSafeInteger(q.computedTotalCents) &&
    q.totalCents !== q.computedTotalCents
  )
    issues.push("TOTAL_MISMATCH");
  if (Number.isSafeInteger(q.subtotalCents) && subtotal !== q.subtotalCents)
    issues.push("SUBTOTAL_MISMATCH");
  if (Number.isSafeInteger(q.shippingCents) && shipping !== q.shippingCents)
    issues.push("SHIPPING_MISMATCH");
  if (Number.isSafeInteger(q.taxCents) && tax !== q.taxCents)
    issues.push("TAX_MISMATCH");
  return [...new Set(issues)];
}
export function buildQuote(
  input: {
    merchantId: string;
    merchantName: string;
    cartId: string;
    items: StoreQuotePayload["items"];
    pricing: {
      lineItems: QuoteLineItem[];
      merchandiseSubtotalCents: number;
      shippingCents: number;
      taxCents: number;
      computedTotalCents: number;
    };
    seller: SellerFacts;
    terms: StoreQuotePayload["terms"];
    quoteId?: string;
    issuedAt?: string | Date;
    expiresInMs?: number;
  },
  secret: Secret,
): SignedStoreQuote {
  const lineItems = input.pricing.lineItems.map((i) => ({ ...i }));
  const sum = lineItems.reduce(
    (n, i) => n + assertIntegerCents(i.amountCents),
    0,
  );
  const subtotal = lineItems
    .filter((i) => i.kind === "PRODUCT")
    .reduce((n, i) => n + i.amountCents, 0);
  const shipping = lineItems
    .filter((i) => i.kind === "SHIPPING")
    .reduce((n, i) => n + i.amountCents, 0);
  const tax = lineItems
    .filter((i) => i.kind === "TAX")
    .reduce((n, i) => n + i.amountCents, 0);
  if (
    sum !== input.pricing.computedTotalCents ||
    subtotal !== input.pricing.merchandiseSubtotalCents ||
    shipping !== input.pricing.shippingCents ||
    tax !== input.pricing.taxCents ||
    sum < 0
  )
    throw new StoreCoreError(
      "INVALID_QUOTE",
      "Pricing breakdown is inconsistent",
    );
  const issued = input.issuedAt ?? new Date();
  const issuedDate = issued instanceof Date ? issued : new Date(issued);
  const expiresIn = input.expiresInMs ?? 600000;
  if (
    !Number.isFinite(issuedDate.getTime()) ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn < 0
  )
    throw new StoreCoreError("INVALID_QUOTE", "Invalid quote timing");
  const payload: StoreQuotePayload = {
    version: STORE_QUOTE_VERSION,
    merchantId: input.merchantId,
    merchantName: input.merchantName,
    quoteId: input.quoteId ?? randomUUID(),
    cartId: input.cartId,
    currency: "USD",
    issuedAt: issuedDate.toISOString(),
    expiresAt: new Date(issuedDate.getTime() + expiresIn).toISOString(),
    items: input.items.map((i) => ({ ...i, variant: { ...i.variant } })),
    lineItems,
    subtotalCents: subtotal,
    shippingCents: shipping,
    taxCents: tax,
    totalCents: sum,
    computedTotalCents: sum,
    seller: { ...input.seller },
    terms: { ...input.terms },
  };
  const unsigned = { ...payload, signatureAlgorithm: "HMAC-SHA256" as const };
  return {
    ...unsigned,
    signature: signQuotePayload(
      unsigned as unknown as Record<string, unknown>,
      secret,
    ),
  };
}
