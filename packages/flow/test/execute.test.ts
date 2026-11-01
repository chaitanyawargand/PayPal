import { describe, it, expect } from "vitest";
import { MockPsp } from "../../psp/src/mock";
import { executePayment } from "../src/execute";

const makeContract = (overrides: any = {}) => ({
  status: "ACTIVE",
  budget_max_cents: 8000,
  per_order_cap_cents: 8000,
  allowed_payee_ids: ["merchant_trailgear"],
  blocked_categories: ["gift_card"],
  ...overrides,
} as any);

const makePayment = (overrides: any = {}) => ({
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
} as any);

describe("executePayment", () => {
  it("clean ALLOW captures 7000 and builds receiptBody", async () => {
    const psp = new MockPsp();

    const result = await executePayment({
      contract: makeContract(),
      payment: makePayment(),
      spent_cents: 0,
      receipt_id: "rcpt_flow_001",
      psp,
    });

    expect(result.decision.verdict).toBe("ALLOW");
    expect(result.decision.computed_total_cents).toBe(7000);

    expect(result.pspResult.status).toBe("CAPTURED");
    expect(result.pspResult.money_moved_cents).toBe(7000);

    expect(result.receiptBody).toMatchObject({
      receipt_id: "rcpt_flow_001",
      payment_id: "pay_1",
      contract_id: "ct_1",
      merchant_id: "merchant_trailgear",
      order_id: "ord_1",
      capture_id: expect.any(String),
      verdict: "ALLOW",
      computed_total_cents: 7000,
      money_moved_cents: 7000,
      psp_tier: "C",
    });

    expect(result.receiptBody.reason_codes).toEqual(result.decision.reason_codes);
    expect(psp.captureCount()).toBe(1);
    expect(psp.totalCapturedCents()).toBe(7000);
  });

  it("over-budget BLOCK moves no money and builds receiptBody with null capture_id", async () => {
    const psp = new MockPsp();

    const result = await executePayment({
      contract: makeContract(),
      payment: makePayment(),
      spent_cents: 2000,
      receipt_id: "rcpt_flow_002",
      psp,
    });

    expect(result.decision.verdict).toBe("BLOCK");
    expect(result.decision.reason_codes).toContain("OVER_BUDGET");

    expect(result.pspResult.status).toBe("NOT_CHARGED");
    expect(result.pspResult.money_moved_cents).toBe(0);

    expect(result.receiptBody).toMatchObject({
      receipt_id: "rcpt_flow_002",
      payment_id: "pay_1",
      contract_id: "ct_1",
      merchant_id: "merchant_trailgear",
      order_id: "ord_1",
      capture_id: null,
      verdict: "BLOCK",
      computed_total_cents: 7000,
      money_moved_cents: 0,
      psp_tier: "C",
    });

    expect(result.receiptBody.reason_codes).toEqual(result.decision.reason_codes);
    expect(psp.captureCount()).toBe(0);
    expect(psp.totalCapturedCents()).toBe(0);
  });

  it("total-mismatch BLOCK moves no money", async () => {
    const psp = new MockPsp();

    const result = await executePayment({
      contract: makeContract(),
      payment: makePayment({ proposed_total_cents: 1000 }),
      spent_cents: 0,
      receipt_id: "rcpt_flow_003",
      psp,
    });

    expect(result.decision.verdict).toBe("BLOCK");
    expect(result.decision.reason_codes).toContain("TOTAL_MISMATCH");

    expect(result.pspResult.status).toBe("NOT_CHARGED");
    expect(result.pspResult.money_moved_cents).toBe(0);

    expect(result.receiptBody.capture_id).toBeNull();
    expect(result.receiptBody.verdict).toBe("BLOCK");
    expect(result.receiptBody.computed_total_cents).toBe(7000);
    expect(result.receiptBody.money_moved_cents).toBe(0);

    expect(psp.captureCount()).toBe(0);
  });

  it("untrusted-content STEP_UP moves no money", async () => {
    const psp = new MockPsp();

        const payment = makePayment({
      spans: [
        {
          id: "span_1",
          source_url: "https://merchant.example/products/jk-101#reviews",
          hash: "sha256:example-span-hash",
        },
      ],
    });

    const result = await executePayment({
      contract: makeContract(),
      payment,
      spent_cents: 0,
      receipt_id: "rcpt_flow_004",
      psp,
    });

    expect(result.decision.verdict).toBe("STEP_UP");
    expect(result.decision.reason_codes).toContain("LINE_FROM_UNTRUSTED_CONTENT");

    expect(result.pspResult.status).toBe("NOT_CHARGED");
    expect(result.pspResult.money_moved_cents).toBe(0);

    expect(result.receiptBody.capture_id).toBeNull();
    expect(result.receiptBody.verdict).toBe("STEP_UP");
    expect(result.receiptBody.money_moved_cents).toBe(0);

    expect(psp.captureCount()).toBe(0);
  });

  it("same payment twice with same PSP instance captures only once", async () => {
    const psp = new MockPsp();

    const first = await executePayment({
      contract: makeContract(),
      payment: makePayment(),
      spent_cents: 0,
      receipt_id: "rcpt_flow_005a",
      psp,
    });

    const second = await executePayment({
      contract: makeContract(),
      payment: makePayment(),
      spent_cents: 0,
      receipt_id: "rcpt_flow_005b",
      psp,
    });

    expect(first.receiptBody.capture_id).not.toBeNull();
    expect(second.receiptBody.capture_id).toBe(first.receiptBody.capture_id);
    expect(second.receiptBody.money_moved_cents).toBe(0);

    expect(psp.captureCount()).toBe(1);
    expect(psp.totalCapturedCents()).toBe(7000);
  });
});