import { beforeEach, describe, expect, it, vi } from "vitest";
import { phase7Fixtures } from "../../phase7-contracts/src/fixtures.js";
import type { CandidateCard } from "../../phase7-contracts/src/candidate.js";
import type { RunDecision } from "../../phase7-contracts/src/run.js";
import type { PaymentPort } from "../src/ports.js";
import { GatewayService, type GatewayServiceDependencies } from "../src/gateway-service.js";
import { GatewayError } from "../src/errors.js";
import { MockPspPaymentAdapter } from "../src/mock-psp.js";

const at = "2026-02-01T00:00:00.000Z";
const newCandidate = (runId: string, id: string, rank: number): CandidateCard => ({
  id, runId, rank, status: "PROPOSED", merchantId: "novamart", merchantDisplayName: "NovaMart Official", sku: "HDP-001", productName: "X200 Wireless Noise-Cancelling Headphones", quantity: 1, advertisedTotalCents: 6774, currency: "USD", seller: { id: "NOVAMART_OFFICIAL", name: "NovaMart Official", verified: true }, terms: { condition: "NEW", returnsDays: 30, finalSale: false, warrantyLabel: "One year", subscription: false, giftCard: false }, hiddenContent: [],
});
function harness(decisionResult: RunDecision = { outcome: "ALLOW", reasonCodes: [], computedTotalCents: 4321 }) {
  let seq = 0;
  let runSeq = 0;
  const paymentCalls: Parameters<PaymentPort["execute"]>[0][] = [];
  const deps: GatewayServiceDependencies = {
    clock: { now: () => at },
    ids: { runId: () => `run_test_${++runSeq}`, eventId: () => `evt_${++seq}` },
    quoteVerifier: { verify: vi.fn(({ quoteId }) => quoteId === "quote_tampered" ? ({ ok: false as const, reason: "Signature invalid" }) : ({ ok: true as const, merchantId: "novamart", sku: "HDP-001", quoteTotalCents: 8888 })) },
    decision: { decide: vi.fn(() => decisionResult) },
    payment: { execute: vi.fn(async (input) => { paymentCalls.push(input); return { receiptId: "receipt_mock_1", status: "COMPLETED" as const }; }) },
    evidence: { issue: vi.fn(async () => ({ evidenceId: "evidence_mock_1" })) },
  };
  return { service: new GatewayService(deps), deps, paymentCalls };
}
async function selected(service: GatewayService, count = 1) {
  const run = service.createRun("Buy the listed headphones");
  service.beginSearch(run.id);
  const candidates = Array.from({ length: count }, (_, index) => newCandidate(run.id, `cand_${index + 1}`, index + 1));
  service.registerCandidates(run.id, candidates);
  service.selectCandidate(run.id, candidates[0]!.id);
  service.createDraft(run.id, "draft_intent_1");
  return { runId: run.id, candidates };
}

describe("GatewayService run orchestration", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  it("runs the ALLOW path and pays only the decision's computed total", async () => {
    const { runId, candidates } = await selected(h.service);
    const signedQuote = { signature: "do-not-store-this", nested: { api_key: "never-persist" } };
    const snapshot = await h.service.submitSignedQuote(runId, { signedIntentId: "intent_signed_1", quoteId: "quote_1", signedQuote });
    expect(snapshot.run.status).toBe("COMPLETED");
    expect(snapshot.run.decision).toMatchObject({ outcome: "ALLOW", computedTotalCents: 4321, evidenceId: "evidence_mock_1", receiptId: "receipt_mock_1" });
    expect(snapshot.candidates[0]).toMatchObject({ id: candidates[0]!.id, status: "ALLOWED" });
    expect(h.paymentCalls).toEqual([{ runId, candidateId: candidates[0]!.id, amountCents: 4321, currency: "USD", idempotencyKey: `${runId}:${candidates[0]!.id}` }]);
    expect(h.paymentCalls[0]?.amountCents).not.toBe(snapshot.candidates[0]?.advertisedTotalCents);
    expect(h.paymentCalls[0]?.amountCents).not.toBe(snapshot.candidates[0]?.quoteTotalCents);
    expect(h.service.getEvents(runId).map((event) => event.seq)).toEqual(h.service.getEvents(runId).map((_, index) => index + 1));
    const persisted = JSON.stringify({ snapshot: h.service.getRun(runId), events: h.service.getEvents(runId) });
    expect(persisted).not.toContain("do-not-store-this");
    expect(persisted).not.toContain("never-persist");
    expect(persisted).not.toContain("do-not-store-this");
  });

  it("returns BLOCK to selection and makes the next ranked candidate selectable", async () => {
    h = harness({ outcome: "BLOCK", reasonCodes: ["TOTAL_MISMATCH"], computedTotalCents: 9000 });
    const { runId, candidates } = await selected(h.service, 2);
    const result = await h.service.submitSignedQuote(runId, { signedIntentId: "intent_1", quoteId: "quote_1", signedQuote: {} });
    expect(result.run.status).toBe("AWAITING_SELECTION");
    expect(result.run.selectedCandidateId).toBeUndefined();
    expect(result.run.decision?.outcome).toBe("BLOCK");
    expect(result.candidates[0]?.status).toBe("BLOCKED");
    expect(h.paymentCalls).toHaveLength(0);
    expect(h.service.getEvents(runId).at(-1)).toMatchObject({ type: "NEXT_CANDIDATE", candidateId: candidates[1]!.id });
    expect(h.service.selectCandidate(runId, candidates[1]!.id).run.status).toBe("AWAITING_SIGNATURE");
  });

  it("treats quote-verification failure as TAMPER_REJECT without payment", async () => {
    const { runId } = await selected(h.service);
    const result = await h.service.submitSignedQuote(runId, { signedIntentId: "intent_1", quoteId: "quote_tampered", signedQuote: { secret: "private" } });
    expect(result.run.status).toBe("AWAITING_SELECTION");
    expect(result.run.decision?.outcome).toBe("TAMPER_REJECT");
    expect(result.candidates[0]?.status).toBe("TAMPER_REJECTED");
    expect(h.paymentCalls).toHaveLength(0);
  });

  it("pays once after STEP_UP approval and returns to selection on rejection", async () => {
    h = harness({ outcome: "STEP_UP", reasonCodes: [], computedTotalCents: 4321 });
    const { runId } = await selected(h.service);
    expect((await h.service.submitSignedQuote(runId, { signedIntentId: "intent_1", quoteId: "quote_1", signedQuote: {} })).run.status).toBe("STEP_UP_REQUIRED");
    expect(h.paymentCalls).toHaveLength(0);
    const approved = await h.service.decideStepUp(runId, "APPROVE");
    expect(approved.run.status).toBe("COMPLETED");
    expect(h.paymentCalls).toHaveLength(1);

    h = harness({ outcome: "STEP_UP", reasonCodes: [], computedTotalCents: 4321 });
    const rejectedSetup = await selected(h.service);
    await h.service.submitSignedQuote(rejectedSetup.runId, { signedIntentId: "intent_1", quoteId: "quote_1", signedQuote: {} });
    const rejected = await h.service.decideStepUp(rejectedSetup.runId, "REJECT");
    expect(rejected.run.status).toBe("AWAITING_SELECTION");
    expect(rejected.candidates[0]?.status).toBe("DISCARDED");
    expect(h.paymentCalls).toHaveLength(0);
  });

  it("fails closed when ALLOW omits computedTotalCents", async () => {
    h = harness({ outcome: "ALLOW", reasonCodes: [] });
    const { runId } = await selected(h.service);
    const result = await h.service.submitSignedQuote(runId, { signedIntentId: "intent_1", quoteId: "quote_1", signedQuote: {} });
    expect(result.run.status).toBe("FAILED");
    expect(h.paymentCalls).toHaveLength(0);
    expect(h.service.getEvents(runId).at(-1)?.type).toBe("RUN_FAILED");
  });

  it("rejects invalid transitions and unknown candidates without attempting payment", async () => {
    expect(() => h.service.selectCandidate("run_missing", "cand_x")).toThrow(GatewayError);
    const run = h.service.createRun("Buy headphones");
    expect(() => h.service.selectCandidate(run.id, "cand_unknown")).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
    h.service.beginSearch(run.id);
    expect(() => h.service.selectCandidate(run.id, "cand_unknown")).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
    h.service.registerCandidates(run.id, [newCandidate(run.id, "cand_1", 1)]);
    expect(() => h.service.selectCandidate(run.id, "cand_unknown")).toThrowError(expect.objectContaining({ code: "CANDIDATE_NOT_FOUND" }));
    await expect(h.service.decideStepUp(run.id, "APPROVE")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const { runId } = await selected(h.service);
    await h.service.submitSignedQuote(runId, { signedIntentId: "intent_1", quoteId: "quote_1", signedQuote: {} });
    await expect(h.service.decideStepUp(runId, "APPROVE")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(h.paymentCalls).toHaveLength(1);
  });

  it("returns cloned snapshots and rejects duplicate candidate ranks", () => {
    const run = h.service.createRun("Buy headphones");
    h.service.beginSearch(run.id);
    const duplicateRanks = [newCandidate(run.id, "cand_a", 1), newCandidate(run.id, "cand_b", 1)];
    expect(() => h.service.registerCandidates(run.id, duplicateRanks)).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    h.service.registerCandidates(run.id, [newCandidate(run.id, "cand_a", 1)]);
    const snapshot = h.service.getRun(run.id);
    snapshot.candidates[0]!.hiddenContent.push("mutated outside store");
    snapshot.run.prompt = "changed";
    expect(h.service.getRun(run.id).run.prompt).toBe("Buy headphones");
    expect(h.service.getRun(run.id).candidates[0]?.hiddenContent).toEqual([]);
    const events = h.service.getEvents(run.id);
    events[0]!.message = "changed outside store";
    expect(h.service.getEvents(run.id)[0]?.message).toBe("Purchase request created.");
  });

  it("integrates the existing MockPsp adapter without network access", async () => {
    const psp = new MockPspPaymentAdapter();
    const result = await psp.execute({ runId: "run_mock", candidateId: "cand_mock", amountCents: 2500, currency: "USD", idempotencyKey: "run_mock:cand_mock" });
    expect(result.status).toBe("COMPLETED");
    expect(result.receiptId).toBe("mock_capture_1");
  });

  it("leaves shared fixtures untouched and parseable", () => {
    expect(phase7Fixtures).toHaveLength(4);
  });
});
