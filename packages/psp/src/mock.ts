import type { Payment } from "../../core/src/payment.js";
import type { Verdict } from "../../core/src/verdict.js";

export interface MockPspChargeInput {
  payment: Payment;
  verdict: Verdict;
  computed_total_cents: number;
  receipt_id: string;
}

export interface MockPspChargeResult {
  status: "CAPTURED" | "NOT_CHARGED";
  tier: "C";
  capture_id: string | null;
  order_id: string | null;
  money_moved_cents: number;
}

type StoredCapture = {
  capture_id: string;
  order_id: string;
  amount_cents: number;
  receipt_id: string;
};

export class MockPsp {
  private readonly capturesByIdempotencyKey = new Map<string, StoredCapture>();
  private captureSequence = 0;
  private capturedTotalCents = 0;

  async charge(input: MockPspChargeInput): Promise<MockPspChargeResult> {
    // Rule 1: only ALLOW can ever move money.
    if (input.verdict !== "ALLOW") {
      return {
        status: "NOT_CHARGED",
        tier: "C",
        capture_id: null,
        order_id: null,
        money_moved_cents: 0,
      };
    }

    // Rule 2: same idempotency_key = same capture, never charged twice.
    const existing = this.capturesByIdempotencyKey.get(
      input.payment.idempotency_key,
    );
    if (existing) {
      return {
        status: "CAPTURED",
        tier: "C",
        capture_id: existing.capture_id,
        order_id: existing.order_id,
        money_moved_cents: 0,
      };
    }

    // Rule 3: even on ALLOW, disagreeing totals means refuse.
    if (input.computed_total_cents !== input.payment.proposed_total_cents) {
      return {
        status: "NOT_CHARGED",
        tier: "C",
        capture_id: null,
        order_id: null,
        money_moved_cents: 0,
      };
    }

    // All rules passed: create the one fake capture.
    this.captureSequence += 1;
    const capture: StoredCapture = {
      capture_id: `mock_capture_${this.captureSequence}`,
      order_id: `mock_order_${this.captureSequence}`,
      amount_cents: input.computed_total_cents,
      receipt_id: input.receipt_id,
    };

    this.capturesByIdempotencyKey.set(input.payment.idempotency_key, capture);
    this.capturedTotalCents += capture.amount_cents;

    return {
      status: "CAPTURED",
      tier: "C",
      capture_id: capture.capture_id,
      order_id: capture.order_id,
      money_moved_cents: capture.amount_cents,
    };
  }

  captureCount(): number {
    return this.capturesByIdempotencyKey.size;
  }

  totalCapturedCents(): number {
    return this.capturedTotalCents;
  }
}
