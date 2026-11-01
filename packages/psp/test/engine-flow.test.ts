import { describe, it, expect } from "vitest";
import { decidePayment } from "../../engine/src/engine";
import { MockPsp } from "../src/mock";

// Copied from packages/engine/test/engine.test.ts
const makeContract = (overrides: any = {}) =>
  ({
    status: "ACTIVE",
    budget_max_cents: 8000,
    per_order_cap_cents: 8000,
    allowed_payee_ids: ["merchant_trailgear"],
    blocked_categories: ["gift_card"],
    ...overrides,
  }) as any;

// Copied from packages/engine/test/engine.test.ts
const makePayment = (overrides: any = {}) =>
  ({
    id: "pay_1",
    contract_id: "ct_1",
    idempotency_key: "idem_1",
    merchant_id: "merchant_trailgear",
    merchant_order_ref: "ord_1",
    items: [
      {
        sku: "JK-101",
        qty: 1,
        unit_price_cents: 7000,
      },
    ],
    proposed_total_cents: 7000,
    spans: [],
    ...overrides,
  }) as any;

async function runThroughPsp(payment: any, spent_cents = 0) {
  const psp = new MockPsp();

  const decision = decidePayment({
    contract: makeContract(),
    payment,
    spent_cents,
  });

  const pspResult = await psp.charge({
    payment,
    verdict: decision.verdict,
    computed_total_cents: decision.computed_total_cents,
    receipt_id: "rcpt_flow_001",
  });

  return { psp, decision, pspResult };
}

describe("Engine -> MockPsp flow", () => {
  it("clean ALLOW decision captures 7000 cents", async () => {
    const { psp, decision, pspResult } = await runThroughPsp(makePayment());

    expect(decision.verdict).toBe("ALLOW");
    expect(decision.computed_total_cents).toBe(7000);

    expect(pspResult.status).toBe("CAPTURED");
    expect(pspResult.money_moved_cents).toBe(7000);
    expect(psp.captureCount()).toBe(1);
    expect(psp.totalCapturedCents()).toBe(7000);
  });

  it("over-budget BLOCK decision moves no money", async () => {
    const { psp, decision, pspResult } = await runThroughPsp(
      makePayment(),
      2000,
    );

    expect(decision.verdict).toBe("BLOCK");
    expect(decision.reason_codes).toContain("OVER_BUDGET");

    expect(pspResult.status).toBe("NOT_CHARGED");
    expect(pspResult.money_moved_cents).toBe(0);
    expect(psp.captureCount()).toBe(0);
    expect(psp.totalCapturedCents()).toBe(0);
  });

  it("total-mismatch BLOCK decision moves no money", async () => {
    const { psp, decision, pspResult } = await runThroughPsp(
      makePayment({ proposed_total_cents: 1000 }),
    );

    expect(decision.verdict).toBe("BLOCK");
    expect(decision.reason_codes).toContain("TOTAL_MISMATCH");

    expect(pspResult.status).toBe("NOT_CHARGED");
    expect(pspResult.money_moved_cents).toBe(0);
    expect(psp.captureCount()).toBe(0);
  });

  it("untrusted-content STEP_UP decision moves no money", async () => {
    const payment = makePayment({
      spans: [
        {
          id: "span_1",
          source_url: "https://merchant.example/products/jk-101#reviews",
          hash: "sha256:example-span-hash",
        },
      ],
    });

    const { psp, decision, pspResult } = await runThroughPsp(payment);

    expect(decision.verdict).toBe("STEP_UP");
    expect(decision.reason_codes).toContain("LINE_FROM_UNTRUSTED_CONTENT");

    expect(pspResult.status).toBe("NOT_CHARGED");
    expect(pspResult.money_moved_cents).toBe(0);
    expect(psp.captureCount()).toBe(0);
  });
});
