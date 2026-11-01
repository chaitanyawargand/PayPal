import { describe, it, expect } from "vitest";
import { MockPsp } from "../src/mock.ts";

// Copied from packages/engine/test/engine.test.ts — do not invent a new payment shape.
const makePayment = (overrides: any = {}) => ({
  id: "pay_1",
  contract_id: "ct_1",
  idempotency_key: "idem_1",
  merchant_id: "merchant_trailgear",
  merchant_order_ref: "ord_1",
  items: [{ sku: "JK-101", qty: 1, unit_price_cents: 7000, origin_zone: "trusted_catalog" }],
  proposed_total_cents: 7000,
  spans: [],
  ...overrides,
} as any);

describe("MockPsp", () => {
  it("ALLOW captures once and returns a fake capture_id", async () => {
    const psp = new MockPsp();
    const result = await psp.charge({
      payment: makePayment(),
      verdict: "ALLOW",
      computed_total_cents: 7000,
      receipt_id: "rcpt_test_001",
    });

    expect(result.status).toBe("CAPTURED");
    expect(result.tier).toBe("C");
    expect(result.capture_id).toMatch(/^mock_capture_/);
    expect(result.order_id).toMatch(/^mock_order_/);
    expect(result.money_moved_cents).toBe(7000);
    expect(psp.captureCount()).toBe(1);
    expect(psp.totalCapturedCents()).toBe(7000);
  });

  it("BLOCK never captures, money moved is $0", async () => {
    const psp = new MockPsp();
    const result = await psp.charge({
      payment: makePayment(),
      verdict: "BLOCK",
      computed_total_cents: 7000,
      receipt_id: "rcpt_test_002",
    });

    expect(result.status).toBe("NOT_CHARGED");
    expect(result.capture_id).toBeNull();
    expect(result.order_id).toBeNull();
    expect(result.money_moved_cents).toBe(0);
    expect(psp.captureCount()).toBe(0);
  });

  it("STEP_UP never captures, money moved is $0", async () => {
    const psp = new MockPsp();
    const result = await psp.charge({
      payment: makePayment(),
      verdict: "STEP_UP",
      computed_total_cents: 7000,
      receipt_id: "rcpt_test_003",
    });

    expect(result.status).toBe("NOT_CHARGED");
    expect(result.capture_id).toBeNull();
    expect(result.order_id).toBeNull();
    expect(result.money_moved_cents).toBe(0);
    expect(psp.captureCount()).toBe(0);
  });

  it("same idempotency_key twice returns same capture and charges only once", async () => {
    const psp = new MockPsp();
    const input = {
      payment: makePayment(),
      verdict: "ALLOW" as const,
      computed_total_cents: 7000,
      receipt_id: "rcpt_test_004",
    };

    const first = await psp.charge(input);
    const second = await psp.charge(input);

    expect(first.status).toBe("CAPTURED");
    expect(second.status).toBe("CAPTURED");
    expect(second.capture_id).toBe(first.capture_id);
    expect(second.order_id).toBe(first.order_id);
    expect(second.money_moved_cents).toBe(0);
    expect(psp.captureCount()).toBe(1);
    expect(psp.totalCapturedCents()).toBe(7000);
  });

  it("ALLOW with mismatched total still refuses to capture", async () => {
    const psp = new MockPsp();
    const result = await psp.charge({
      payment: makePayment(),
      verdict: "ALLOW",
      computed_total_cents: 6999,
      receipt_id: "rcpt_test_005",
    });

    expect(result.status).toBe("NOT_CHARGED");
    expect(result.capture_id).toBeNull();
    expect(result.money_moved_cents).toBe(0);
    expect(psp.captureCount()).toBe(0);
  });
});