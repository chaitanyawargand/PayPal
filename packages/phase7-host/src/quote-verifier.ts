import { verifySignedQuote } from "../../stores/store-core/src/quote.js";
import type { Clock } from "./contract-resolver.js";

export type NormalizedQuoteItem = { sku: string; quantity: number };
export type NormalizedQuoteLineItem = { kind: string; amountCents: number; sku?: string };
export type VerifiedQuoteDetails = {
  quoteId: string;
  merchantId: string;
  currency: "USD";
  expiresAt: string;
  totalCents: number;
  items: NormalizedQuoteItem[];
  lineItems: NormalizedQuoteLineItem[];
};
export type VerifiedQuoteKey = { runId: string; candidateId: string; quoteId: string };

function keyOf(key: VerifiedQuoteKey): string { return `${key.runId}:${key.candidateId}:${key.quoteId}`; }

export class InMemoryVerifiedQuoteStore {
  private readonly values = new Map<string, VerifiedQuoteDetails>();

  put(key: VerifiedQuoteKey, value: VerifiedQuoteDetails): void {
    const normalized: VerifiedQuoteDetails = {
      quoteId: value.quoteId,
      merchantId: value.merchantId,
      currency: value.currency,
      expiresAt: value.expiresAt,
      totalCents: value.totalCents,
      items: value.items.map(({ sku, quantity }) => ({ sku, quantity })),
      lineItems: value.lineItems.map(({ kind, amountCents, sku }) => ({ kind, amountCents, ...(sku === undefined ? {} : { sku }) })),
    };
    this.values.set(keyOf(key), normalized);
  }

  take(key: VerifiedQuoteKey): VerifiedQuoteDetails | null {
    const id = keyOf(key);
    const value = this.values.get(id);
    if (!value) return null;
    this.values.delete(id);
    return value;
  }
}

export type QuoteVerifierResult = { ok: true; merchantId: string; sku: string; quoteTotalCents: number } | { ok: false; reason: string };
export type QuoteVerifierInput = { runId: string; candidateId: string; quoteId: string; signedQuote: unknown };
export type QuoteVerifierPort = { verify(input: QuoteVerifierInput): Promise<QuoteVerifierResult> | QuoteVerifierResult };
export type HmacQuoteVerifierDependencies = { merchantSecrets: Readonly<Record<string, string | Buffer | undefined>>; quoteStore: InMemoryVerifiedQuoteStore; clock: Clock };

export class HmacQuoteVerifier implements QuoteVerifierPort {
  constructor(private readonly deps: HmacQuoteVerifierDependencies) {}

  verify(input: QuoteVerifierInput): QuoteVerifierResult {
    try {
      if (!input.signedQuote || typeof input.signedQuote !== "object" || Array.isArray(input.signedQuote)) return { ok: false, reason: "INVALID_QUOTE" };
      const raw = input.signedQuote as Record<string, unknown>;
      if (typeof raw.merchantId !== "string") return { ok: false, reason: "UNKNOWN_MERCHANT" };
      const secret = this.deps.merchantSecrets[raw.merchantId];
      if (secret === undefined || !verifySignedQuote(raw, secret)) return { ok: false, reason: "INVALID_SIGNATURE" };
      if (raw.quoteId !== input.quoteId) return { ok: false, reason: "QUOTE_ID_MISMATCH" };
      if (raw.currency !== "USD") return { ok: false, reason: "INVALID_CURRENCY" };
      if (typeof raw.expiresAt !== "string" || !Number.isFinite(Date.parse(raw.expiresAt)) || Date.parse(raw.expiresAt) <= this.deps.clock.now().getTime()) return { ok: false, reason: "QUOTE_EXPIRED" };
      if (!Number.isSafeInteger(raw.totalCents) || (raw.totalCents as number) < 0) return { ok: false, reason: "INVALID_TOTAL" };
      if (!Array.isArray(raw.items) || raw.items.length === 0 || !Array.isArray(raw.lineItems) || raw.lineItems.length === 0) return { ok: false, reason: "QUOTE_ITEMS_MISSING" };
      const items: NormalizedQuoteItem[] = [];
      for (const value of raw.items) {
        if (!value || typeof value !== "object") return { ok: false, reason: "INVALID_QUOTE_ITEM" };
        const item = value as Record<string, unknown>;
        if (typeof item.sku !== "string" || !item.sku || !Number.isSafeInteger(item.quantity) || (item.quantity as number) <= 0) return { ok: false, reason: "INVALID_QUOTE_ITEM" };
        items.push({ sku: item.sku, quantity: item.quantity as number });
      }
      const lineItems: NormalizedQuoteLineItem[] = [];
      for (const value of raw.lineItems) {
        if (!value || typeof value !== "object") return { ok: false, reason: "INVALID_QUOTE_LINE" };
        const line = value as Record<string, unknown>;
        if (typeof line.kind !== "string" || !line.kind || !Number.isSafeInteger(line.amountCents) || (line.sku !== undefined && typeof line.sku !== "string")) return { ok: false, reason: "INVALID_QUOTE_LINE" };
        lineItems.push({ kind: line.kind, amountCents: line.amountCents as number, ...(typeof line.sku === "string" ? { sku: line.sku } : {}) });
      }
      const details: VerifiedQuoteDetails = { quoteId: input.quoteId, merchantId: raw.merchantId, currency: "USD", expiresAt: raw.expiresAt, totalCents: raw.totalCents as number, items, lineItems };
      this.deps.quoteStore.put({ runId: input.runId, candidateId: input.candidateId, quoteId: input.quoteId }, details);
      return { ok: true, merchantId: raw.merchantId, sku: items[0]!.sku, quoteTotalCents: details.totalCents };
    } catch {
      return { ok: false, reason: "INVALID_QUOTE" };
    }
  }
}
