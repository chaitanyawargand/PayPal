import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signQuotePayload } from "../../stores/store-core/src/index.js";
import type { QuoteLineItem } from "../../stores/store-core/src/types.js";
import { generateKeyPairSync } from "node:crypto";
import type { UnsignedDraftContract } from "../../compiler/src/types.js";
import { EngineDecisionAdapter, InMemorySpendLedger, mapEngineDecision } from "../src/decision-adapter.js";
import { signIntentDraft, IntentContractResolver } from "../src/contract-resolver.js";
import { HmacQuoteVerifier, InMemoryVerifiedQuoteStore } from "../src/quote-verifier.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const quoteSecret = randomBytes(32);
const now = new Date("2030-01-01T00:00:00.000Z");
const contractDraft = (overrides: Partial<UnsignedDraftContract> = {}): UnsignedDraftContract => ({
  id: "intent_fixture", family_id: "family_fixture", version: 1, owner_payer_id: "payer_fixture",
  criteria: [{ id: "criterion_fixture", type: "structured", field: "merchant_id", expected: "novamart" }],
  budget_max_cents: 10000, per_order_cap_cents: 9000, allowed_payee_ids: ["novamart"], blocked_categories: ["gift_card"],
  expires_at: "2030-02-01T00:00:00.000Z", status: "ACTIVE", ...overrides,
});
const productItems = [{ sku: "ANC-001", name: "Headphones", quantity: 1, unitAmountCents: 5800, amountCents: 5800, variant: {} }];
const lineItems: QuoteLineItem[] = [
  { id: "line_product", kind: "PRODUCT" as const, label: "Headphones", sku: "ANC-001", quantity: 1, unitAmountCents: 5800, amountCents: 5800 },
  { id: "line_shipping", kind: "SHIPPING" as const, label: "Shipping", amountCents: 495 },
  { id: "line_tax", kind: "TAX" as const, label: "Tax", amountCents: 479 },
];
function signedQuote(options: { quoteId?: string; merchantId?: string; expiresAt?: string; productSku?: string; productQuantity?: number; lineItems?: typeof lineItems; total?: number } = {}) {
  const lines = options.lineItems ?? lineItems;
  const total = options.total ?? lines.reduce((sum, line) => sum + line.amountCents, 0);
  const payload = {
    version: "recourse.store-quote.v1", merchantId: options.merchantId ?? "novamart", merchantName: "NovaMart", quoteId: options.quoteId ?? "quote_1", cartId: "cart_1", currency: "USD" as const,
    issuedAt: "2029-12-31T00:00:00.000Z", expiresAt: options.expiresAt ?? "2030-01-02T00:00:00.000Z",
    items: [{ sku: options.productSku ?? "ANC-001", name: "Headphones", quantity: options.productQuantity ?? 1, unitAmountCents: 5800, amountCents: 5800, variant: {} }],
    lineItems: lines, subtotalCents: 5800, shippingCents: 495, taxCents: 479, totalCents: total, computedTotalCents: total,
    seller: { id: "seller_1", name: "NovaMart", verified: true },
    terms: { condition: "NEW" as const, returnsDays: 30, finalSale: false, subscription: false, giftCard: false },
    signatureAlgorithm: "HMAC-SHA256" as const,
  };
  return { ...payload, signature: signQuotePayload(payload, quoteSecret) };
}
function makeHarness(options: { contract?: UnsignedDraftContract; spent?: number; contractValue?: unknown } = {}) {
  const contractId = options.contract?.id ?? "intent_fixture";
  const signed = signIntentDraft({ draft: options.contract ?? contractDraft(), shipToHash: "ship_hash_fixture", privateKeyPem, now: new Date("2029-12-01T00:00:00.000Z") });
  const contract = options.contractValue ?? signed;
  const resolver = new IntentContractResolver({ intents: { getIntentById: async () => contract as never }, userPublicKeyPem: publicKeyPem, clock: { now: () => now } });
  const quotes = new InMemoryVerifiedQuoteStore();
  const verifier = new HmacQuoteVerifier({ merchantSecrets: { novamart: quoteSecret }, quoteStore: quotes, clock: { now: () => now } });
  const ledger = new InMemorySpendLedger();
  if (options.spent) ledger.recordCompleted(contractId, options.spent);
  const adapter = new EngineDecisionAdapter({ contractResolver: resolver, quoteStore: quotes, getSpentCents: (id) => ledger.getSpentCents(id), clock: { now: () => now } });
  return { adapter, verifier, quotes, ledger, signed };
}
const candidate = (overrides: Record<string, unknown> = {}) => ({
  id: "cand_1", runId: "run_1", rank: 1, status: "SELECTED", merchantId: "novamart", merchantDisplayName: "NovaMart", sku: "ANC-001", productName: "Headphones", quantity: 1,
  advertisedTotalCents: 6774, quoteTotalCents: 6774, currency: "USD", seller: { id: "seller_1", name: "NovaMart", verified: true },
  terms: { condition: "NEW", returnsDays: 30, finalSale: false, warrantyLabel: "1 year", subscription: false, giftCard: false }, hiddenContent: [], quoteId: "quote_1", ...overrides,
});
const run = (overrides: Record<string, unknown> = {}) => ({ id: "run_1", prompt: "headphones", status: "VERIFYING", draftIntentId: "intent_fixture", signedIntentId: "intent_fixture", createdAt: "2029-12-01T00:00:00.000Z", updatedAt: "2029-12-01T00:00:00.000Z", ...overrides });

describe("verified quote and engine bridge", () => {
  it("maps each frozen engine verdict and preserves the computed total", () => {
    for (const verdict of ["ALLOW", "STEP_UP", "BLOCK"] as const) {
      expect(mapEngineDecision({ verdict, reason_codes: ["LINE_FROM_UNTRUSTED_CONTENT"], computed_total_cents: 4321, layer_results: [] })).toEqual({ outcome: verdict, reasonCodes: ["LINE_FROM_UNTRUSTED_CONTENT"], computedTotalCents: 4321 });
    }
  });

  it("accepts a genuinely signed 6774-cent quote and produces the real engine ALLOW", async () => {
    const h = makeHarness({ contract: contractDraft({ budget_max_cents: 20000, per_order_cap_cents: 15000 }) });
    const quote = signedQuote();
    expect(await h.verifier.verify({ runId: "run_1", candidateId: "cand_1", quoteId: "quote_1", signedQuote: quote })).toEqual({ ok: true, merchantId: "novamart", sku: "ANC-001", quoteTotalCents: 6774 });
    expect(await h.adapter.decide({ run: run() as never, candidate: candidate() as never, verifiedQuote: { ok: true, merchantId: "novamart", sku: "ANC-001", quoteTotalCents: 6774 } })).toMatchObject({ outcome: "ALLOW", reasonCodes: [], computedTotalCents: 6774 });
  });

  it("uses verified quote price truth when candidate advertised price disagrees", async () => {
    const h = makeHarness();
    await h.verifier.verify({ runId: "run_1", candidateId: "cand_1", quoteId: "quote_1", signedQuote: signedQuote() });
    expect(await h.adapter.decide({ run: run() as never, candidate: candidate({ advertisedTotalCents: 3834 }) as never, verifiedQuote: { ok: true, merchantId: "novamart", sku: "ANC-001", quoteTotalCents: 6774 } })).toMatchObject({ outcome: "ALLOW", computedTotalCents: 6774 });
  });

  it("rejects tampered, wrong-secret, unknown-merchant, expired, and mismatched-ID quotes without storing", async () => {
    const h = makeHarness();
    const verify = (q: unknown, quoteId = "quote_1") => h.verifier.verify({ runId: "run_1", candidateId: "cand_1", quoteId, signedQuote: q });
    const valid = signedQuote();
    expect(await verify({ ...valid, totalCents: 1 })).toMatchObject({ ok: false });
    const wrongSecretQuote = signedQuote();
    expect(await new HmacQuoteVerifier({ merchantSecrets: { novamart: randomBytes(32) }, quoteStore: h.quotes, clock: { now: () => now } }).verify({ runId: "run_1", candidateId: "cand_1", quoteId: "quote_1", signedQuote: wrongSecretQuote })).toMatchObject({ ok: false });
    expect(await verify(signedQuote({ merchantId: "unknown" }))).toMatchObject({ ok: false });
    expect(await verify(signedQuote({ expiresAt: "2029-12-31T00:00:00.000Z" }))).toMatchObject({ ok: false });
    expect(await verify(valid, "different_quote")).toMatchObject({ ok: false });
    expect(h.quotes.take({ runId: "run_1", candidateId: "cand_1", quoteId: "quote_1" })).toBeNull();
  });

  it("lets a signed non-summing quote reach the real engine and blocks its mismatch", async () => {
    const h = makeHarness({ contract: contractDraft({ budget_max_cents: 20000, per_order_cap_cents: 15000 }) });
    const malformedButSigned = signedQuote({ lineItems: [
      { id: "product", kind: "PRODUCT", sku: "ANC-001", quantity: 1, unitAmountCents: 5800, amountCents: 5800, label: "product" },
      { id: "shipping", kind: "SHIPPING", amountCents: 495, label: "shipping" },
      { id: "tax", kind: "TAX", amountCents: 4576, label: "tax" },
    ], total: 12871 });
    expect(await h.verifier.verify({ runId: "run_1", candidateId: "cand_1", quoteId: "quote_1", signedQuote: malformedButSigned })).toMatchObject({ ok: true, quoteTotalCents: 12871 });
    expect(await h.adapter.decide({ run: run() as never, candidate: candidate({ advertisedTotalCents: 3834, quoteTotalCents: 12871 }) as never, verifiedQuote: { ok: true, merchantId: "novamart", sku: "ANC-001", quoteTotalCents: 12871 } })).toMatchObject({ outcome: "BLOCK", reasonCodes: ["TOTAL_MISMATCH"], computedTotalCents: 10871 });
  });

  it("returns engine payee, cap, spend, and blocked gift-card outcomes", async () => {
    const cases: Array<{ contract?: UnsignedDraftContract; spent?: number; sku?: string; expected: string }> = [
      { contract: contractDraft({ allowed_payee_ids: ["other"] }), expected: "PAYEE_NOT_IN_REGISTRY" },
      { contract: contractDraft({ per_order_cap_cents: 6000 }), expected: "OVER_BUDGET" },
      { spent: 4000, expected: "OVER_BUDGET" },
      { sku: "gift-card", contract: contractDraft({ blocked_categories: ["gift_card"] }), expected: "BLOCKED_CATEGORY" },
    ];
    for (const entry of cases) {
      const h = makeHarness({ contract: entry.contract, spent: entry.spent });
      const sku = entry.sku ?? "ANC-001";
      const quote = entry.sku ? signedQuote({ productSku: sku, lineItems: [
        { id: "line_product", kind: "PRODUCT", label: "Gift card", sku, quantity: 1, unitAmountCents: 5800, amountCents: 5800 },
        ...lineItems.slice(1),
      ] }) : signedQuote();
      await h.verifier.verify({ runId: "run_1", candidateId: "cand_1", quoteId: "quote_1", signedQuote: quote });
      const result = await h.adapter.decide({ run: run() as never, candidate: candidate({ sku, quoteTotalCents: 6774 }) as never, verifiedQuote: { ok: true, merchantId: "novamart", sku, quoteTotalCents: 6774 } });
      expect(result).toMatchObject({ outcome: "BLOCK", reasonCodes: [entry.expected], computedTotalCents: 6774 });
    }
  });

  it("fails closed for invalid contracts and consumes verified quotes once", async () => {
    const valid = makeHarness();
    await valid.verifier.verify({ runId: "run_1", candidateId: "cand_1", quoteId: "quote_1", signedQuote: signedQuote() });
    const invalidContract = makeHarness({ contractValue: { ...valid.signed, signature: "tampered" } });
    await invalidContract.verifier.verify({ runId: "run_1", candidateId: "cand_1", quoteId: "quote_1", signedQuote: signedQuote() });
    expect(await invalidContract.adapter.decide({ run: run() as never, candidate: candidate() as never, verifiedQuote: { ok: true, merchantId: "novamart", sku: "ANC-001", quoteTotalCents: 6774 } })).toMatchObject({ outcome: "BLOCK", reasonCodes: ["INTENT_CONTRACT_INVALID_SIGNATURE"] });
    expect(await valid.adapter.decide({ run: run() as never, candidate: candidate() as never, verifiedQuote: { ok: true, merchantId: "novamart", sku: "ANC-001", quoteTotalCents: 6774 } })).toMatchObject({ outcome: "ALLOW" });
    expect(await valid.adapter.decide({ run: run() as never, candidate: candidate() as never, verifiedQuote: { ok: true, merchantId: "novamart", sku: "ANC-001", quoteTotalCents: 6774 } })).toMatchObject({ outcome: "BLOCK", reasonCodes: ["VERIFIED_QUOTE_DETAILS_UNAVAILABLE"] });
  });
});
