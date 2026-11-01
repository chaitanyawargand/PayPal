import { describe, expect, it } from "vitest";
import { PayPalPsp } from "../src/paypal.js";
import type {
  PayPalVaultClient,
  VaultChargeRequest,
  VaultChargeResponse,
} from "../src/vault-client.js";

type Handler = (
  req: VaultChargeRequest,
  callNumber: number,
) => Promise<any> | any;

class FakeVaultClient implements PayPalVaultClient {
  readonly calls: VaultChargeRequest[] = [];

  constructor(private readonly handler: Handler) {}

  async chargeVaultedBuyer(
    req: VaultChargeRequest,
  ): Promise<VaultChargeResponse> {
    this.calls.push({ ...req });
    return this.handler(req, this.calls.length);
  }
}

function okClient(overrides: Record<string, unknown> = {}) {
  return new FakeVaultClient(async () => ({
    capture_id: "capture_123",
    status: "COMPLETED",
    charged_cents: 7000,
    ...overrides,
  }));
}

function makePsp(client: PayPalVaultClient) {
  return new PayPalPsp({ client, vault_id: "vault_config_123" });
}

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay_1",
    contract_id: "contract_1",
    merchant_id: "merchant_trailgear",
    merchant_order_ref: "order_jk101",
    idempotency_key: "idem_1",
    proposed_total_cents: 7000,
    ...overrides,
  };
}

function chargeInput(overrides: Record<string, unknown> = {}) {
  return {
    payment: makePayment(),
    verdict: "ALLOW",
    computed_total_cents: 7000,
    receipt_id: "receipt_1",
    ...overrides,
  } as any;
}

describe("PayPalPsp", () => {
  it("ALLOW charges exactly once at computed_total_cents, never the proposed total", async () => {
    const client = okClient();
    const psp = makePsp(client);

    const result = await psp.charge(
      chargeInput({ payment: makePayment({ proposed_total_cents: 9999 }) }),
    );

    expect(result.status).toBe("CAPTURED");
    expect(result.capture_id).toBe("capture_123");
    expect(result.order_id).toBeNull();
    expect(result.money_moved_cents).toBe(7000);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      amount_cents: 7000,
      currency: "USD",
      vault_id: "vault_config_123",
      idempotency_key: "idem_1",
      receipt_id: "receipt_1",
    });
  });

  it("BLOCK makes zero client calls and moves no money", async () => {
    const client = okClient();
    const psp = makePsp(client);

    const result = await psp.charge(chargeInput({ verdict: "BLOCK" }));

    expect(result.status).toBe("NOT_CHARGED");
    expect(result.capture_id).toBeNull();
    expect(result.money_moved_cents).toBe(0);
    expect(client.calls).toHaveLength(0);
  });

  it("STEP_UP makes zero client calls and moves no money", async () => {
    const client = okClient();
    const psp = makePsp(client);

    const result = await psp.charge(chargeInput({ verdict: "STEP_UP" }));

    expect(result.status).toBe("NOT_CHARGED");
    expect(result.capture_id).toBeNull();
    expect(result.money_moved_cents).toBe(0);
    expect(client.calls).toHaveLength(0);
  });

  it("client throwing fails closed and never leaks the error into the result", async () => {
    const client = new FakeVaultClient(async () => {
      throw new Error("access_token=secret-token-value");
    });
    const psp = makePsp(client);

    const result = await psp.charge(chargeInput());

    expect(result.status).toBe("NOT_CHARGED");
    expect(result.capture_id).toBeNull();
    expect(result.money_moved_cents).toBe(0);
    expect(JSON.stringify(result)).not.toContain("secret-token-value");
  });

  it("non-COMPLETED status is not a capture", async () => {
    const client = new FakeVaultClient(async () => ({
      capture_id: "capture_pending",
      status: "PENDING",
      charged_cents: 7000,
    }));
    const psp = makePsp(client);

    const result = await psp.charge(chargeInput());

    expect(result.status).toBe("NOT_CHARGED");
    expect(result.capture_id).toBeNull();
    expect(result.money_moved_cents).toBe(0);
  });

  it("charged_cents that disagrees with the request is treated as failure", async () => {
    const client = okClient({ charged_cents: 6999 });
    const psp = makePsp(client);

    const result = await psp.charge(chargeInput());

    expect(result.status).toBe("NOT_CHARGED");
    expect(result.capture_id).toBeNull();
    expect(result.money_moved_cents).toBe(0);
  });

  it("passes the same idempotency_key through unchanged on retry", async () => {
    const client = okClient();
    const psp = makePsp(client);

    await psp.charge(chargeInput());
    const retry = await psp.charge(chargeInput());

    expect(client.calls).toHaveLength(2);
    expect(client.calls[0].idempotency_key).toBe("idem_1");
    expect(client.calls[1].idempotency_key).toBe("idem_1");
    expect(retry.status).toBe("CAPTURED");
    expect(retry.capture_id).toBe("capture_123");
  });

  it("ignores a vault_id smuggled into the payment and uses config", async () => {
    const client = okClient();
    const psp = makePsp(client);

    const result = await psp.charge(
      chargeInput({ payment: makePayment({ vault_id: "vault_attacker" }) }),
    );

    expect(result.status).toBe("CAPTURED");
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].vault_id).toBe("vault_config_123");
  });
});