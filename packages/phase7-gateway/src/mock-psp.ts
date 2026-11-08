import { MockPsp } from "../../psp/src/mock.js";
import type { Payment } from "../../core/src/payment.js";
import type { PaymentPort } from "./ports.js";

export class MockPspPaymentAdapter implements PaymentPort {
  constructor(private readonly psp = new MockPsp()) {}

  async execute(input: Parameters<PaymentPort["execute"]>[0]): Promise<{ receiptId: string; status: "COMPLETED" }> {
    const payment: Payment = {
      id: `payment_${input.runId}_${input.candidateId}`,
      contract_id: `intent_${input.runId}`,
      idempotency_key: input.idempotencyKey,
      merchant_id: "phase7-mock-merchant",
      merchant_order_ref: `order_${input.runId}_${input.candidateId}`,
      items: [{ sku: "phase7-verified-quote", qty: 1, unit_price_cents: input.amountCents }],
      proposed_total_cents: input.amountCents,
      spans: [],
    };
    const result = await this.psp.charge({ payment, verdict: "ALLOW", computed_total_cents: input.amountCents, receipt_id: `receipt_${input.runId}_${input.candidateId}` });
    if (result.status !== "CAPTURED" || !result.capture_id) throw new Error("MockPsp did not complete the verified payment");
    return { receiptId: result.capture_id, status: "COMPLETED" };
  }
}
