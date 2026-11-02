import "dotenv/config";
import { describe, expect, it } from "vitest";
import { executePayment } from "../src/execute";
import { PayPalPsp } from "../../psp/src/paypal";
import type {
  PayPalVaultClient,
  VaultChargeRequest,
  VaultChargeResponse,
} from "../../psp/src/vault-client";
import { LivePayPalVaultClient } from "../../psp/src/paypal-client.js";
import { SignedReceiptLedger } from "../../ledger/src/store";
import { generateSigningKeyPair } from "../../ledger/src/sign";

class FakeVaultClient implements PayPalVaultClient {
  readonly calls: VaultChargeRequest[] = [];

  async chargeVaultedBuyer(
    req: VaultChargeRequest,
  ): Promise<VaultChargeResponse> {
    this.calls.push({ ...req });
    return {
      capture_id: "paypal_capture_123",
      status: "COMPLETED",
      charged_cents: req.amount_cents,
    };
  }
}

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
  const client = new FakeVaultClient();
  const psp = new PayPalPsp({ client, vault_id: "vault_config_123" });

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
      receipt_id: `rcpt_paypal_${i + 1}`,
      psp,
    });
    results.push(result);
    ledger.append(result.receiptBody);
    spent_cents += result.pspResult.money_moved_cents;
  }

  return { client, ledger, results };
}

describe("Phase 4 flow: engine -> PayPalPsp -> signed ledger", () => {
  it("ALLOW reaches the vault client once; BLOCK and STEP_UP never do", async () => {
    const { client, ledger, results } = await runThreePayments();

    expect(results.map((r) => r.decision.verdict)).toEqual([
      "ALLOW",
      "BLOCK",
      "STEP_UP",
    ]);
    expect(results[1].decision.reason_codes).toContain("TOTAL_MISMATCH");
    expect(results[2].decision.reason_codes).toContain(
      "LINE_FROM_UNTRUSTED_CONTENT",
    );

    // Exactly one vault call, for the ALLOW only, carrying the
    // flow's receipt_id and the decision's computed total.
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].receipt_id).toBe("rcpt_paypal_1");
    expect(client.calls[0]).toEqual({
      amount_cents: 7000,
      currency: "USD",
      vault_id: "vault_config_123",
      idempotency_key: "idem_1",
      receipt_id: "rcpt_paypal_1",
    });

    // The real-PSP capture id and tier land in the receipt bodies.
    expect(results.map((r) => r.receiptBody.capture_id)).toEqual([
      "paypal_capture_123",
      null,
      null,
    ]);
    expect(results.map((r) => r.receiptBody.money_moved_cents)).toEqual([
      7000, 0, 0,
    ]);
    expect(results.map((r) => r.receiptBody.psp_tier)).toEqual([
      "B",
      "B",
      "B",
    ]);

    const entries = ledger.entries();
    expect(entries).toHaveLength(3);
    expect(entries[0].receipt.capture_id).toBe("paypal_capture_123");
    expect(entries[1].receipt.capture_id).toBeNull();
    expect(entries[2].receipt.capture_id).toBeNull();

    expect(ledger.verify()).toBe(true);
  });
});

const shouldRunLive = Boolean(
  process.env.RUN_PAYPAL_LIVE === "1" &&
    process.env.PAYPAL_CLIENT_ID &&
    process.env.PAYPAL_CLIENT_SECRET &&
    process.env.PAYPAL_VAULT_ID,
);

describe.runIf(shouldRunLive)(
  "Phase 4 Joint Live Integration: engine -> Live PayPalPsp -> signed ledger",
  () => {
    it(
      "Joint Live Checklist: ALLOW captures in Sandbox, BLOCK and STEP_UP never reach PayPal, signed ledger verifies",
      async () => {
      const keys = generateSigningKeyPair();
      const ledger = new SignedReceiptLedger(keys);
      const client = new LivePayPalVaultClient();
      const vaultId = process.env.PAYPAL_VAULT_ID!;
      const psp = new PayPalPsp({ client, vault_id: vaultId });

      const nonce = Date.now();
      const payments = [
        // 1. Clean purchase JK-101 -> ALLOW, captures 7000
        makePayment({
          id: `pay_live_1_${nonce}`,
          idempotency_key: `idem_live_1_${nonce}`,
          merchant_order_ref: `ord_live_1_${nonce}`,
          items: [{ sku: "JK-101", qty: 1, unit_price_cents: 7000 }],
          proposed_total_cents: 7000,
        }),
        // 2. Agent lied about total -> BLOCK, $0
        makePayment({
          id: `pay_live_2_${nonce}`,
          idempotency_key: `idem_live_2_${nonce}`,
          merchant_order_ref: `ord_live_2_${nonce}`,
          items: [{ sku: "JK-101", qty: 1, unit_price_cents: 7000 }],
          proposed_total_cents: 1000,
        }),
        // 3. Line came from untrusted merchant-page content -> STEP_UP, $0
        makePayment({
          id: `pay_live_3_${nonce}`,
          idempotency_key: `idem_live_3_${nonce}`,
          merchant_order_ref: `ord_live_3_${nonce}`,
          items: [{ sku: "JK-101", qty: 1, unit_price_cents: 7000 }],
          proposed_total_cents: 7000,
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
          receipt_id: `rcpt_live_joint_${nonce}_${i + 1}`,
          psp,
        });
        results.push(result);
        ledger.append(result.receiptBody);
        spent_cents += result.pspResult.money_moved_cents;
      }

      // 1. ALLOW checks
      expect(results[0].decision.verdict).toBe("ALLOW");
      expect(results[0].pspResult.status).toBe("CAPTURED");
      expect(results[0].pspResult.money_moved_cents).toBe(7000);
      const realCaptureId = results[0].pspResult.capture_id;
      expect(typeof realCaptureId).toBe("string");
      expect(realCaptureId.length).toBeGreaterThan(5);
      expect(results[0].receiptBody.capture_id).toBe(realCaptureId);
      expect(results[0].receiptBody.psp_tier).toBe("B");

      // Independently verify on PayPal
      const captureDetails = await client.getCapture(realCaptureId);
      expect(captureDetails.id).toBe(realCaptureId);
      expect(captureDetails.status).toBe("COMPLETED");
      expect(captureDetails.amount_cents).toBe(7000);

      const iso = new Date().toISOString();
      const last4 = vaultId.slice(-4);
      console.log(
        `\nJOINT LIVE EVIDENCE:\n${iso} / sandbox / ${results[0].pspResult.money_moved_cents} / ${realCaptureId} / ${captureDetails.status} / ...${last4}\n`,
      );

      // 2. BLOCK checks (zero money moved, capture_id is null)
      expect(results[1].decision.verdict).toBe("BLOCK");
      expect(results[1].decision.reason_codes).toContain("TOTAL_MISMATCH");
      expect(results[1].pspResult.status).toBe("NOT_CHARGED");
      expect(results[1].pspResult.money_moved_cents).toBe(0);
      expect(results[1].pspResult.capture_id).toBeNull();
      expect(results[1].receiptBody.capture_id).toBeNull();
      expect(results[1].receiptBody.psp_tier).toBe("B");

      // 3. STEP_UP checks (zero money moved, capture_id is null)
      expect(results[2].decision.verdict).toBe("STEP_UP");
      expect(results[2].decision.reason_codes).toContain(
        "LINE_FROM_UNTRUSTED_CONTENT",
      );
      expect(results[2].pspResult.status).toBe("NOT_CHARGED");
      expect(results[2].pspResult.money_moved_cents).toBe(0);
      expect(results[2].pspResult.capture_id).toBeNull();
      expect(results[2].receiptBody.capture_id).toBeNull();
      expect(results[2].receiptBody.psp_tier).toBe("B");

      // 4. Signed ledger checks
      const entries = ledger.entries();
      expect(entries).toHaveLength(3);
      expect(entries[0].receipt.capture_id).toBe(realCaptureId);
      expect(entries[1].receipt.capture_id).toBeNull();
      expect(entries[2].receipt.capture_id).toBeNull();
      expect(ledger.verify()).toBe(true);
    },
    30000,
  );
});
