import { describe, expect, it } from "vitest";
import { CandidateCard } from "../src/candidate.js";
import { assertEventDataSafe, Event } from "../src/event.js";
import { EventsQuery, CreateRunRequest, SelectCandidateRequest, StepUpDecisionRequest } from "../src/requests.js";
import { Run } from "../src/run.js";

const stamp = "2026-01-15T12:00:00.000Z";
const validRun = { id: "run_test", status: "CREATED", prompt: "Buy headphones", createdAt: stamp, updatedAt: stamp };
const validEvent = { id: "evt_1", runId: "run_test", seq: 1, type: "RUN_CREATED", actor: "USER", message: "Run created", ts: stamp };
const validCandidate = { id: "cand_test", runId: "run_test", rank: 1, status: "PROPOSED", merchantId: "novamart", merchantDisplayName: "NovaMart Official", sku: "HDP-001", productName: "Headphones", quantity: 1, advertisedTotalCents: 6774, currency: "USD", seller: { id: "seller_1", name: "Seller", verified: true }, terms: { condition: "NEW", returnsDays: 30, finalSale: false, warrantyLabel: "One year", subscription: false, giftCard: false }, hiddenContent: [] };

describe("strict shared schemas", () => {
  it("parses valid Run, Event, CandidateCard, and requests", () => {
    expect(Run.parse(validRun).id).toBe("run_test");
    expect(Event.parse(validEvent).seq).toBe(1);
    expect(CandidateCard.parse(validCandidate).merchantId).toBe("novamart");
    expect(CreateRunRequest.parse({ prompt: "Buy headphones" })).toEqual({ prompt: "Buy headphones" });
    expect(SelectCandidateRequest.parse({ candidateId: "cand_test" }).candidateId).toBe("cand_test");
    expect(StepUpDecisionRequest.parse({ decision: "APPROVE" }).decision).toBe("APPROVE");
    expect(EventsQuery.parse({}).afterSeq).toBe(0);
    expect(EventsQuery.parse({ afterSeq: 4 }).afterSeq).toBe(4);
  });

  it("rejects invalid enums, malformed prompts, invalid cents, and invalid event sequences", () => {
    expect(Run.safeParse({ ...validRun, status: "PAUSED" }).success).toBe(false);
    expect(Run.safeParse({ ...validRun, prompt: "" }).success).toBe(false);
    expect(Run.safeParse({ ...validRun, prompt: "x".repeat(2001) }).success).toBe(false);
    expect(Run.safeParse({ ...validRun, decision: { outcome: "MAYBE", reasonCodes: [] } }).success).toBe(false);
    expect(Run.safeParse({ ...validRun, decision: { outcome: "ALLOW", reasonCodes: [], computedTotalCents: -1 } }).success).toBe(false);
    expect(Run.safeParse({ ...validRun, decision: { outcome: "ALLOW", reasonCodes: [], computedTotalCents: 1.5 } }).success).toBe(false);
    expect(Event.safeParse({ ...validEvent, seq: 0 }).success).toBe(false);
    expect(CandidateCard.safeParse({ ...validCandidate, merchantId: "other" }).success).toBe(false);
    expect(CandidateCard.safeParse({ ...validCandidate, currency: "EUR" }).success).toBe(false);
    expect(CandidateCard.safeParse({ ...validCandidate, advertisedTotalCents: -1 }).success).toBe(false);
    expect(CandidateCard.safeParse({ ...validCandidate, advertisedTotalCents: 1.1 }).success).toBe(false);
  });

  it("rejects unknown fields, including secret-like top-level fields", () => {
    expect(Run.safeParse({ ...validRun, signature: "x" }).success).toBe(false);
    expect(Event.safeParse({ ...validEvent, token: "x" }).success).toBe(false);
    expect(CandidateCard.safeParse({ ...validCandidate, api_key: "x" }).success).toBe(false);
    expect(CandidateCard.safeParse({ ...validCandidate, seller: { ...validCandidate.seller, password: "x" } }).success).toBe(false);
  });

  it("rejects unsafe event data keys recursively", () => {
    expect(() => assertEventDataSafe({ product: { name: "Headphones", count: 2 } })).not.toThrow();
    for (const unsafe of [{ secretValue: "x" }, { nested: { signature: "x" } }, { list: [{ hmac_value: "x" }] }, { apiKey: "x" }, { access_token: "x" }, { credential: "x" }, { password: "x" }]) {
      expect(() => assertEventDataSafe(unsafe)).toThrow();
      expect(Event.safeParse({ ...validEvent, data: unsafe }).success).toBe(false);
    }
  });
});
