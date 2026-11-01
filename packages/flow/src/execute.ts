import { decidePayment } from "../../engine/src/engine.js";

export interface ExecutePaymentInput {
  contract: any;
  payment: any;
  spent_cents: number;
  receipt_id: string;
  psp: {
    charge: (input: any) => Promise<any> | any;
  };
}

export async function executePayment(input: ExecutePaymentInput) {
  const { contract, payment, spent_cents, receipt_id, psp } = input;

  // 1. Engine decides. Engine is the only authority on verdict + total.
  const decision = decidePayment({ contract, payment, spent_cents });

  // 2. PSP is called exactly once, with the DECISION's total —
  //    never payment.proposed_total_cents. PSP itself refuses
  //    anything that isn't ALLOW (second line of defence).
  const pspResult = await psp.charge({
    payment,
    decision,
    payment_id: payment.id,
    idempotency_key: payment.idempotency_key,
    merchant_id: payment.merchant_id,
    merchant_order_ref: payment.merchant_order_ref,
    order_id: payment.merchant_order_ref,
    verdict: decision.verdict,
    reason_codes: decision.reason_codes,
    computed_total_cents: decision.computed_total_cents,
    amount_cents: decision.computed_total_cents,
    proposed_total_cents: payment.proposed_total_cents,
  });

  // 3. Build the receipt body. JSON-safe values only.
  //    No hash / prev_hash / signature — the Ledger adds those later.
  const capture_id =
    pspResult.capture_id ?? (pspResult as any).captureId ?? null;

  const receiptBody = {
    receipt_id,
    payment_id: payment.id,
    contract_id: payment.contract_id,
    merchant_id: payment.merchant_id,
    order_id: payment.merchant_order_ref,
    capture_id,
    verdict: decision.verdict,
    reason_codes: decision.reason_codes,
    computed_total_cents: decision.computed_total_cents,
    money_moved_cents: pspResult.money_moved_cents,
    psp_tier: "C" as const,
  };

  return { decision, pspResult, receiptBody };
}
