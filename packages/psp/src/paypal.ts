import type { MockPspChargeInput } from "./mock.js";
import type { PayPalVaultClient } from "./vault-client.js";

export interface PayPalPspOptions {
  client: PayPalVaultClient;
  vault_id: string;
}

export interface PayPalPspChargeResult {
  status: "CAPTURED" | "NOT_CHARGED";
  tier: "B";
  capture_id: string | null;
  order_id: string | null;
  money_moved_cents: number;
}

function notCharged(): PayPalPspChargeResult {
  return {
    status: "NOT_CHARGED",
    tier: "B",
    capture_id: null,
    order_id: null,
    money_moved_cents: 0,
  };
}

export class PayPalPsp {
  private readonly client: PayPalVaultClient;
  private readonly vault_id: string;

  constructor(options: PayPalPspOptions) {
    this.client = options.client;
    this.vault_id = options.vault_id;
  }

  async charge(
    input: MockPspChargeInput,
  ): Promise<PayPalPspChargeResult> {
    // Rule 1: only ALLOW can ever reach the client.
    if (input.verdict !== "ALLOW") {
      return notCharged();
    }

    // Rule 2: refuse non-integer or non-positive amounts before any call.
    if (
      !Number.isInteger(input.computed_total_cents) ||
      input.computed_total_cents <= 0
    ) {
      return notCharged();
    }

    // Rule 3: exactly one client call, built only from the decision's
    // computed total and server-config vault_id. Nothing else from the
    // payment object crosses into the vault request.
    let response;
    try {
      response = await this.client.chargeVaultedBuyer({
        amount_cents: input.computed_total_cents,
        currency: "USD",
        vault_id: this.vault_id,
        idempotency_key: input.payment.idempotency_key,
        receipt_id: input.receipt_id,
      });
    } catch {
      // Fail closed. The caught error is deliberately discarded so no
      // token, secret, or upstream message can leak into the result.
      return notCharged();
    }

    // Rule 4: trust but verify — only a COMPLETED status, a non-empty
    // capture id, and an exactly matching charged amount count as a capture.
    if (
      !response ||
      response.status !== "COMPLETED" ||
      typeof response.capture_id !== "string" ||
      response.capture_id.length === 0 ||
      response.charged_cents !== input.computed_total_cents
    ) {
      return notCharged();
    }

    return {
      status: "CAPTURED",
      tier: "B",
      capture_id: response.capture_id,
      order_id: null,
      money_moved_cents: response.charged_cents,
    };
  }
}