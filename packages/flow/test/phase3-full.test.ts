import { describe, it, expect } from "vitest";
import { MockPsp } from "../../psp/src/mock";
import { executePayment } from "../src/execute";
import { SignedReceiptLedger, verifySignedReceipts } from "../../ledger/src/store";
import { generateSigningKeyPair } from "../../ledger/src/sign";

const GENESIS = "0".repeat(64);

const makeContract = (overrides: any = {}) =>
  ({
    status: "ACTIVE",
    budget_max_cents: 100_000,
    per_order_cap_cents: 100_000,
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

async function runThreePayments() {
  const keys = generateSigningKeyPair();
  const ledger = new SignedReceiptLedger(keys);
  const psp = new MockPsp();

  const payments = [
    // 1. Clean purchase -> ALLOW, captures 7000
    makePayment(),
    // 2. Agent lied about the total -> BLOCK, $0
    makePayment({
      id: "pay_2",
      idempotency_key: "idem_2",
      merchant_order_ref: "ord_2",
      proposed_total_cents: 1000,
    }),
    // 3. Line came from untrusted merchant-page content -> STEP_UP, $0
    makePayment({
      id: "pay_3",
      idempotency_key: "idem_3",
      merchant_order_ref: "ord_3",
      spans: [
        {
          id: "span_1",
          source_url: "https://merchant.example/products/jk-101#reviews",
          hash: "sha256:example-span-hash",
        },
      ],
    }),
  ];

  const results: any[] = [];
  let spent_cents = 0;

  for (let i = 0; i < payments.length; i++) {
    const result = await executePayment({
      contract: makeContract(),
      payment: payments[i],
      spent_cents,
      receipt_id: `rcpt_phase3_${i + 1}`,
      psp,
    });
    results.push(result);
    ledger.append(result.receiptBody);
    spent_cents += result.pspResult.money_moved_cents;
  }

  return { keys, ledger, psp, results };
}

describe("Phase 3 full connection: engine -> PSP -> signed ledger", () => {
  it("ALLOW + BLOCK + STEP_UP land in one signed ledger, only 7000 captured", async () => {
    const { ledger, psp, results } = await runThreePayments();

    expect(results.map((r) => r.decision.verdict)).toEqual([
      "ALLOW",
      "BLOCK",
      "STEP_UP",
    ]);
    expect(results[1].decision.reason_codes).toContain("TOTAL_MISMATCH");
    expect(results[2].decision.reason_codes).toContain(
      "LINE_FROM_UNTRUSTED_CONTENT",
    );

    expect(psp.captureCount()).toBe(1);
    expect(
      results.reduce((sum, r) => sum + r.pspResult.money_moved_cents, 0),
    ).toBe(7000);

    const entries = ledger.entries();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.receipt.money_moved_cents)).toEqual([
      7000, 0, 0,
    ]);

    expect(entries[0].receipt.prev_hash).toBe(GENESIS);
    expect(entries[1].receipt.prev_hash).toBe(entries[0].receipt.hash);
    expect(entries[2].receipt.prev_hash).toBe(entries[1].receipt.hash);

    expect(entries[0].receipt.capture_id).not.toBeNull();
    expect(entries[1].receipt.capture_id).toBeNull();
    expect(entries[2].receipt.capture_id).toBeNull();

    expect(ledger.verify()).toBe(true);
  });

  it("tampering with a receipt in the chain fails verification", async () => {
    const { keys, ledger } = await runThreePayments();

    const copy = ledger.entries().map((entry) => ({
      ...entry,
      receipt: { ...entry.receipt },
    }));
    copy[0].receipt.money_moved_cents = 1;

    expect(verifySignedReceipts(copy, keys.publicKeyPem)).toBe(false);
  });
});