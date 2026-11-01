import { describe, it, expect } from "vitest";
import { decidePayment } from "../src/engine";

const makeContract = (overrides: any = {}) =>
  ({
    status: "ACTIVE",
    budget_max_cents: 8000,
    per_order_cap_cents: 8000,
    allowed_payee_ids: ["merchant_trailgear"],
    blocked_categories: ["gift_card"],
    ...overrides,
  }) as any;

const makePayment = (overrides: any = {}) =>
  ({
    id: "pay_1",
    contract_id: "ct_1",
    idempotency_key: "idem_1",
    merchant_id: "merchant_trailgear",
    merchant_order_ref: "ord_1",
    items: [{ sku: "JK-101", qty: 1, unit_price_cents: 7000 }],
    proposed_total_cents: 7000,
    spans: [],
    ...overrides,
  }) as any;

describe("Engine L1", () => {
  it("ALLOW clean purchase", () => {
    const d = decidePayment({
      contract: makeContract(),
      payment: makePayment(),
    });
    expect(d.verdict).toBe("ALLOW");
    expect(d.computed_total_cents).toBe(7000);
  });

  it("BLOCK total mismatch - agent lied about price", () => {
    const d = decidePayment({
      contract: makeContract(),
      payment: makePayment({ proposed_total_cents: 1000 }),
    });
    expect(d.verdict).toBe("BLOCK");
    expect(d.reason_codes).toContain("TOTAL_MISMATCH");
  });

  it("BLOCK payee not in registry", () => {
    const d = decidePayment({
      contract: makeContract(),
      payment: makePayment({ merchant_id: "attacker_shop" }),
    });
    expect(d.verdict).toBe("BLOCK");
    expect(d.reason_codes).toContain("PAYEE_NOT_IN_REGISTRY");
  });

  it("BLOCK over budget including already spent", () => {
    const d = decidePayment({
      contract: makeContract(),
      payment: makePayment(),
      spent_cents: 2000,
    });
    expect(d.verdict).toBe("BLOCK");
    expect(d.reason_codes).toContain("OVER_BUDGET");
  });

  it("BLOCK gift card", () => {
    const payment = makePayment({
      items: [{ sku: "GIFT-99", qty: 1, unit_price_cents: 7000 }],
    });
    const d = decidePayment({ contract: makeContract(), payment });
    expect(d.verdict).toBe("BLOCK");
    expect(d.reason_codes).toContain("BLOCKED_CATEGORY");
  });

  it("STEP_UP line from untrusted_content, not gift card", () => {
    const payment = makePayment({
      spans: [
        {
          id: "span_1",
          source_url: "https://merchant.example/products/jk-101#reviews",
          hash: "sha256:example-span-hash",
        },
      ],
    });
    const d = decidePayment({ contract: makeContract(), payment });
    expect(d.verdict).toBe("STEP_UP");
    expect(d.reason_codes).toContain("LINE_FROM_UNTRUSTED_CONTENT");
  });
});
