import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileDraftContract } from "../../compiler/src/compiler.js";
import type { UnsignedDraftContract } from "../../compiler/src/types.js";
import { createRecourseDatabase } from "../../db/src/index.js";
import { MockPsp } from "../../psp/src/mock.js";
import { buildQuote, signQuotePayload, type QuoteLineItem } from "../../stores/store-core/src/index.js";
import type { CandidateCard } from "../../phase7-contracts/src/candidate.js";
import type { JudgeFacts, JudgeModelPort, JudgeRecommendation } from "../../phase7-judge/src/model.js";
import { TighteningJudge } from "../../phase7-judge/src/judge-service.js";
import { GatewayService } from "../../phase7-gateway/src/gateway-service.js";
import type { DecisionPort, PaymentPort } from "../../phase7-gateway/src/ports.js";
import { MockPspPaymentAdapter } from "../../phase7-gateway/src/mock-psp.js";
import {
  EngineDecisionAdapter,
  HmacQuoteVerifier,
  InMemorySpendLedger,
  InMemoryVerifiedQuoteStore,
  IntentContractResolver,
  signIntentDraft,
} from "../src/index.js";

const now = new Date("2030-01-01T00:00:00.000Z");
const nowIso = now.toISOString();
const contractExpiry = "2035-01-01T00:00:00.000Z";
const tempDirs: string[] = [];
type HostHarness = {
  ready: Promise<void>;
  readonly db: ReturnType<typeof createRecourseDatabase>;
  readonly gateway: GatewayService;
  readonly psp: MockPsp;
  readonly quoteStore: InMemoryVerifiedQuoteStore;
  readonly spendLedger: InMemorySpendLedger;
  readonly judgeCalls: JudgeFacts[];
  readonly paymentCalls: Parameters<PaymentPort["execute"]>[0][];
  readonly baseDecisionCalls: number;
  readonly evidenceCalls: number;
  readonly userPrivateKeyPem: string;
  readonly attackerPrivateKeyPem: string;
  readonly merchantSecrets: { novamart: Buffer; peermarket: Buffer; dealdemon: Buffer };
  decisionsByCandidate: Map<string, JudgeRecommendation["recommendation"]>;
  close(): Promise<void>;
};
const activeHarnesses: HostHarness[] = [];

afterEach(async () => {
  await Promise.all(activeHarnesses.splice(0).map((harness) => harness.close()));
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

type Scenario = "novamart" | "peermarket" | "dealdemon";
function makeHarness(): HostHarness {
  const signingKeys = generateKeyPairSync("ed25519");
  const userPrivateKeyPem = signingKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const userPublicKeyPem = signingKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const attackerKeys = generateKeyPairSync("ed25519");
  const attackerPrivateKeyPem = attackerKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const merchantSecrets = { novamart: randomBytes(32), peermarket: randomBytes(32), dealdemon: randomBytes(32) };
  const quoteStore = new InMemoryVerifiedQuoteStore();
  const spendLedger = new InMemorySpendLedger();
  const dirPromise = mkdtemp(join(tmpdir(), "phase7-host-e2e-"));
  let gateway!: GatewayService;
  let db: ReturnType<typeof createRecourseDatabase>;
  let runCounter = 0;
  let eventCounter = 0;
  let baseDecisionCalls = 0;
  let evidenceCalls = 0;
  const judgeCalls: JudgeFacts[] = [];
  const paymentCalls: Parameters<PaymentPort["execute"]>[0][] = [];
  const decisionsByCandidate = new Map<string, JudgeRecommendation["recommendation"]>();
  const psp = new MockPsp();
  const pspAdapter = new MockPspPaymentAdapter(psp);

  const ready = (async () => {
    const dir = await dirPromise;
    tempDirs.push(dir);
    db = createRecourseDatabase({ path: join(dir, "recourse.sqlite") });
    const resolver = new IntentContractResolver({ intents: db.intents, userPublicKeyPem, clock: { now: () => now } });
    const verifier = new HmacQuoteVerifier({ merchantSecrets, quoteStore, clock: { now: () => now } });
    const engine = new EngineDecisionAdapter({ contractResolver: resolver, quoteStore, getSpentCents: (contractId) => spendLedger.getSpentCents(contractId), clock: { now: () => now } });
    const baseDecision: DecisionPort = {
      async decide(input) {
        baseDecisionCalls += 1;
        return engine.decide(input);
      },
    };
    const judgeModel: JudgeModelPort = {
      review(facts) {
        judgeCalls.push(structuredClone(facts));
        return { recommendation: decisionsByCandidate.get(facts.candidate.candidateId) ?? "KEEP" };
      },
    };
    const judge = new TighteningJudge({ baseDecisionPort: baseDecision, judgeModel });
    const payment: PaymentPort = {
      async execute(input) {
        paymentCalls.push({ ...input });
        const result = await pspAdapter.execute(input);
        const run = gateway.store.getRun(input.runId);
        if (result.status === "COMPLETED" && run?.signedIntentId) spendLedger.recordCompleted(run.signedIntentId, input.amountCents);
        return result;
      },
    };
    gateway = new GatewayService({
      quoteVerifier: verifier,
      decision: judge,
      payment,
      evidence: { issue: () => { evidenceCalls += 1; return { evidenceId: "evidence_e2e_1" }; } },
      clock: { now: () => nowIso },
      ids: { runId: () => `run_e2e_${++runCounter}`, eventId: () => `event_e2e_${++eventCounter}` },
    });
  })();

  const harness: HostHarness = {
    ready,
    get db() { return db; },
    get gateway() { return gateway; },
    get psp() { return psp; },
    get quoteStore() { return quoteStore; },
    get spendLedger() { return spendLedger; },
    get judgeCalls() { return judgeCalls; },
    get paymentCalls() { return paymentCalls; },
    get baseDecisionCalls() { return baseDecisionCalls; },
    get evidenceCalls() { return evidenceCalls; },
    userPrivateKeyPem,
    attackerPrivateKeyPem,
    merchantSecrets,
    decisionsByCandidate,
    async close() { await ready; db.close(); },
  };
  activeHarnesses.push(harness);
  return harness;
}

function candidateFor(runId: string, scenario: Scenario): CandidateCard {
  const shared = {
    runId,
    rank: 1,
    status: "PROPOSED" as const,
    quantity: 1,
    currency: "USD" as const,
    hiddenContent: [],
  };
  if (scenario === "novamart") return {
    ...shared,
    id: "cand_nova_1", merchantId: "novamart", merchantDisplayName: "NovaMart Official", sku: "HDP-001", productName: "ANC Headphones",
    advertisedTotalCents: 6774, seller: { id: "NOVA_OFFICIAL", name: "NovaMart", verified: true },
    terms: { condition: "NEW", returnsDays: 30, finalSale: false, warrantyLabel: "One year", subscription: false, giftCard: false },
    quoteId: "quote_nova_e2e",
  };
  if (scenario === "peermarket") return {
    ...shared,
    id: "cand_peer_1", merchantId: "peermarket", merchantDisplayName: "PeerMarket", sku: "HDP-001", productName: "ANC Headphones",
    advertisedTotalCents: 5017, seller: { id: "SEL-TECHTURNOVER", name: "TechTurnover", verified: false },
    terms: { condition: "USED_GOOD", returnsDays: 0, finalSale: true, warrantyLabel: "No warranty", subscription: false, giftCard: false },
    quoteId: "quote_peer_e2e",
  };
  return {
    ...shared,
    id: "cand_dd_1", merchantId: "dealdemon", merchantDisplayName: "DealDemon", sku: "HDP-001", productName: "ANC Headphones",
    advertisedTotalCents: 3834, seller: { id: "DD_OFFICIAL", name: "DealDemon", verified: true },
    terms: { condition: "NEW", returnsDays: 30, finalSale: false, warrantyLabel: "One year", subscription: false, giftCard: false },
    quoteId: "quote_dd_e2e",
  };
}

async function createSelected(h: HostHarness, scenario: Scenario) {
  await h.ready;
  const run = h.gateway.createRun(`Purchase HDP-001 from ${scenario}`);
  h.gateway.beginSearch(run.id);
  const candidate = candidateFor(run.id, scenario);
  h.gateway.registerCandidates(run.id, [candidate]);
  h.gateway.selectCandidate(run.id, candidate.id);
  return { runId: run.id, candidate: candidate as CandidateCard };
}

async function signAndBind(h: HostHarness, runId: string, candidate: CandidateCard, policy: {
  budget?: number;
  perOrderCap?: number;
  allowedPayees?: string[];
  signingKeyPem?: string;
} = {}) {
  const compiled = compileDraftContract({
    prompt: "",
    payer_id: "payer_e2e",
    allowed_payee_ids: policy.allowedPayees ?? [candidate.merchantId],
    ...(policy.budget === undefined ? {} : { budget_max_cents: policy.budget }),
    ...(policy.perOrderCap === undefined ? {} : { per_order_cap_cents: policy.perOrderCap }),
    blocked_categories: ["gift_card"],
    expires_at: contractExpiry,
  });
  if (compiled.status === "NEEDS_CLARIFICATION" || !compiled.draft) return { status: "NEEDS_CLARIFICATION" as const };
  const shipToHash = createHash("sha256").update("phase7-ship-to-not-collected", "utf8").digest("hex");
  const contract = signIntentDraft({ draft: compiled.draft, shipToHash, privateKeyPem: policy.signingKeyPem ?? h.userPrivateKeyPem, now });
  await h.db.intents.saveIntent(contract);
  h.gateway.createDraft(runId, contract.id);
  return { status: "DRAFT" as const, contract };
}

function validQuote(h: HostHarness, scenario: Exclude<Scenario, "dealdemon">) {
  const peer = scenario === "peermarket";
  const merchantId = peer ? "peermarket" : "novamart";
  const sku = "HDP-001";
  const product = peer ? 3900 : 5800;
  const shipping = peer ? 795 : 495;
  const tax = peer ? 322 : 479;
  const seller = peer
    ? { id: "SEL-TECHTURNOVER", name: "TechTurnover", verified: false }
    : { id: "NOVA_OFFICIAL", name: "NovaMart Official", verified: true };
  const terms = peer
    ? { condition: "USED_GOOD" as const, returnsDays: 0, finalSale: true, subscription: false, giftCard: false, warrantyLabel: "No warranty" }
    : { condition: "NEW" as const, returnsDays: 30, finalSale: false, subscription: false, giftCard: false, warrantyLabel: "One year" };
  const lineItems: QuoteLineItem[] = [
    { id: "line_product", kind: "PRODUCT", label: "ANC headphones", sku, quantity: 1, unitAmountCents: product, amountCents: product },
    { id: "line_shipping", kind: "SHIPPING", label: "Shipping", amountCents: shipping },
    { id: "line_tax", kind: "TAX", label: "Tax", amountCents: tax },
  ];
  return buildQuote({
    merchantId,
    merchantName: peer ? "PeerMarket" : "NovaMart",
    cartId: `cart_${scenario}`,
    items: [{ sku, name: "ANC headphones", quantity: 1, unitAmountCents: product, amountCents: product, variant: {} }],
    pricing: { lineItems, merchandiseSubtotalCents: product, shippingCents: shipping, taxCents: tax, computedTotalCents: product + shipping + tax },
    seller,
    terms,
    quoteId: peer ? "quote_peer_e2e" : "quote_nova_e2e",
    issuedAt: now,
    expiresInMs: 86_400_000,
  }, h.merchantSecrets[merchantId]);
}

function signedNonSummingQuote(h: HostHarness) {
  const quote = {
    version: "recourse.store-quote.v1",
    merchantId: "dealdemon",
    merchantName: "DealDemon",
    quoteId: "quote_dd_e2e",
    cartId: "cart_dd",
    currency: "USD" as const,
    issuedAt: nowIso,
    expiresAt: "2030-01-02T00:00:00.000Z",
    items: [{ sku: "HDP-001", name: "ANC headphones", quantity: 1, unitAmountCents: 5800, amountCents: 5800, variant: {} }],
    lineItems: [
      { id: "product", kind: "PRODUCT" as const, label: "Product", sku: "HDP-001", quantity: 1, unitAmountCents: 5800, amountCents: 5800 },
      { id: "shipping", kind: "SHIPPING" as const, label: "Shipping", amountCents: 495 },
      { id: "tax", kind: "TAX" as const, label: "Tax", amountCents: 4576 },
    ],
    subtotalCents: 5800,
    shippingCents: 495,
    taxCents: 4576,
    totalCents: 12871,
    computedTotalCents: 12871,
    seller: { id: "DD_OFFICIAL", name: "DealDemon", verified: true },
    terms: { condition: "NEW" as const, returnsDays: 30, finalSale: false, subscription: false, giftCard: false, warrantyLabel: "One year" },
    signatureAlgorithm: "HMAC-SHA256" as const,
  };
  return { ...quote, signature: signQuotePayload(quote, h.merchantSecrets.dealdemon) };
}

async function submitQuote(h: HostHarness, runId: string, candidate: CandidateCard, quote: unknown, signatureId?: string) {
  return h.gateway.submitSignedQuote(runId, { signedIntentId: signatureId ?? h.gateway.store.getRun(runId)!.draftIntentId!, quoteId: candidate.quoteId!, signedQuote: quote });
}

describe("Phase 7 host gateway end-to-end integration", () => {
  it("completes NovaMart ALLOW at 6774 cents and records receipt, evidence, and spend", async () => {
    const h = makeHarness();
    const { runId, candidate } = await createSelected(h, "novamart");
    h.decisionsByCandidate.set(candidate.id, "KEEP");
    const signing = await signAndBind(h, runId, candidate, { budget: 10000, perOrderCap: 9000 });
    if (signing.status !== "DRAFT") throw new Error("Expected a signed intent draft.");
    expect(signing.status).toBe("DRAFT");
    const quote = validQuote(h, "novamart");
    const result = await submitQuote(h, runId, candidate, quote);
    expect(result.run.status).toBe("COMPLETED");
    expect(result.candidates[0]?.status).toBe("ALLOWED");
    expect(result.run.decision).toMatchObject({ outcome: "ALLOW", computedTotalCents: 6774, receiptId: expect.any(String), evidenceId: "evidence_e2e_1" });
    expect(h.paymentCalls).toHaveLength(1);
    expect(h.paymentCalls[0]).toMatchObject({ runId, candidateId: candidate.id, amountCents: 6774, idempotencyKey: `${runId}:${candidate.id}` });
    expect(h.psp.captureCount()).toBe(1);
    expect(h.psp.totalCapturedCents()).toBe(6774);
    expect(h.spendLedger.getSpentCents(signing.contract.id)).toBe(6774);
    expect(h.evidenceCalls).toBe(1);
    const events = h.gateway.getEvents(runId);
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
    const visible = JSON.stringify({ events, candidates: result.candidates });
    expect(visible).not.toContain(quote.signature);
    expect(visible).not.toContain(h.userPrivateKeyPem);
  });

  it("holds PeerMarket STEP_UP until approval, then captures exactly 5017 cents", async () => {
    const h = makeHarness();
    const { runId, candidate } = await createSelected(h, "peermarket");
    h.decisionsByCandidate.set(candidate.id, "STEP_UP");
    await signAndBind(h, runId, candidate, { budget: 10000, perOrderCap: 9000 });
    const pending = await submitQuote(h, runId, candidate, validQuote(h, "peermarket"));
    expect(pending.run.status).toBe("STEP_UP_REQUIRED");
    expect(pending.run.decision).toMatchObject({ outcome: "STEP_UP", computedTotalCents: 5017 });
    expect(h.paymentCalls).toHaveLength(0);
    expect(h.psp.captureCount()).toBe(0);
    const completed = await h.gateway.decideStepUp(runId, "APPROVE");
    expect(completed.run.status).toBe("COMPLETED");
    expect(completed.candidates[0]?.status).toBe("ALLOWED");
    expect(h.paymentCalls).toHaveLength(1);
    expect(h.paymentCalls[0]?.amountCents).toBe(5017);
    expect(h.psp.captureCount()).toBe(1);
    expect(h.psp.totalCapturedCents()).toBe(5017);
  });

  it("blocks DealDemon's valid non-summing quote in the engine without invoking the Judge or payment", async () => {
    const h = makeHarness();
    const { runId, candidate } = await createSelected(h, "dealdemon");
    const signing = await signAndBind(h, runId, candidate, { budget: 20000, perOrderCap: 15000 });
    const quote = signedNonSummingQuote(h);
    const result = await submitQuote(h, runId, candidate, quote);
    expect(result.run.status).toBe("AWAITING_SELECTION");
    expect(result.candidates[0]?.status).toBe("BLOCKED");
    expect(result.run.decision).toMatchObject({ outcome: "BLOCK", reasonCodes: ["TOTAL_MISMATCH"], computedTotalCents: 10871 });
    expect(h.baseDecisionCalls).toBe(1);
    expect(h.judgeCalls).toHaveLength(0);
    expect(h.paymentCalls).toHaveLength(0);
    expect(h.psp.captureCount()).toBe(0);
    expect(signing.status).toBe("DRAFT");
  });

  it("rejects a tampered quote before the decision adapter and payment", async () => {
    const h = makeHarness();
    const { runId, candidate } = await createSelected(h, "novamart");
    await signAndBind(h, runId, candidate, { budget: 10000, perOrderCap: 9000 });
    const original = validQuote(h, "novamart");
    const result = await submitQuote(h, runId, candidate, { ...original, totalCents: original.totalCents + 1 });
    expect(result.run.status).toBe("AWAITING_SELECTION");
    expect(result.candidates[0]?.status).toBe("TAMPER_REJECTED");
    expect(result.run.decision?.outcome).toBe("TAMPER_REJECT");
    expect(h.baseDecisionCalls).toBe(0);
    expect(h.judgeCalls).toHaveLength(0);
    expect(h.paymentCalls).toHaveLength(0);
    expect(h.psp.captureCount()).toBe(0);
  });

  it("blocks a contract signed by a key other than the configured user's key", async () => {
    const h = makeHarness();
    const { runId, candidate } = await createSelected(h, "novamart");
    await signAndBind(h, runId, candidate, { budget: 10000, perOrderCap: 9000, signingKeyPem: h.attackerPrivateKeyPem });
    const result = await submitQuote(h, runId, candidate, validQuote(h, "novamart"));
    expect(result.run.status).toBe("AWAITING_SELECTION");
    expect(result.candidates[0]?.status).toBe("BLOCKED");
    expect(result.run.decision).toMatchObject({ outcome: "BLOCK", reasonCodes: ["INTENT_CONTRACT_INVALID_SIGNATURE"] });
    expect(h.judgeCalls).toHaveLength(0);
    expect(h.paymentCalls).toHaveLength(0);
  });

  it("enforces the signed payee policy for a PeerMarket selection", async () => {
    const h = makeHarness();
    const { runId, candidate } = await createSelected(h, "peermarket");
    await signAndBind(h, runId, candidate, { budget: 10000, perOrderCap: 9000, allowedPayees: ["novamart"] });
    const result = await submitQuote(h, runId, candidate, validQuote(h, "peermarket"));
    expect(result.run.status).toBe("AWAITING_SELECTION");
    expect(result.candidates[0]?.status).toBe("BLOCKED");
    expect(result.run.decision).toMatchObject({ outcome: "BLOCK", reasonCodes: ["PAYEE_NOT_IN_REGISTRY"] });
    expect(h.judgeCalls).toHaveLength(0);
    expect(h.paymentCalls).toHaveLength(0);
  });

  it("leaves the run awaiting signature when policy compilation needs clarification", async () => {
    const h = makeHarness();
    const { runId, candidate } = await createSelected(h, "novamart");
    const result = await signAndBind(h, runId, candidate, { perOrderCap: 9000 });
    expect(result).toEqual({ status: "NEEDS_CLARIFICATION" });
    expect(await h.db.intents.getIntentById("missing_contract")).toBeNull();
    const snapshot = h.gateway.getRun(runId);
    expect(snapshot.run.status).toBe("AWAITING_SIGNATURE");
    expect(snapshot.run.draftIntentId).toBeUndefined();
    expect(snapshot.run.signedIntentId).toBeUndefined();
  });
});
