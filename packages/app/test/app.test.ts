import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import type { AddressInfo } from "node:net";

import { createApp, type RecourseApp } from "../src/index.js";

const GENESIS = "0".repeat(64);

const contract = {
  id: "intent_jk101_v1",
  family_id: "intent_jk101",
  version: 1,
  owner_payer_id: "payer_demo",
  criteria: [
    { id: "c1", type: "structured", field: "merchant_id", expected: "merchant_trailgear" },
  ],
  budget_max_cents: 10000,
  per_order_cap_cents: 10000,
  allowed_payee_ids: ["merchant_trailgear"],
  blocked_categories: ["gift_card"],
  expires_at: "2030-01-01T00:00:00.000Z",
  ship_to_hash: "demo_ship_to_hash",
  status: "ACTIVE",
  hash: "demo_contract_hash",
  signature: "demo_contract_signature",
};

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay_jk101_1",
    contract_id: contract.id,
    idempotency_key: "idem_jk101_allow_1",
    merchant_id: "merchant_trailgear",
    merchant_order_ref: "order_JK101_1",
    items: [{ sku: "JK-101", qty: 1, unit_price_cents: 7000 }],
    proposed_total_cents: 7000,
    spans: [],
    ...overrides,
  };
}

const apps: RecourseApp[] = [];
const tempDirs: string[] = [];

async function makeApp() {
  const dir = await mkdtemp(nodePath.join(tmpdir(), "recourse-app-"));
  tempDirs.push(dir);
  const app = createApp({ dbPath: nodePath.join(dir, "app.test.db") });
  apps.push(app);
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

async function postPayment(baseUrl: string, body: unknown) {
  const res = await fetch(`${baseUrl}/v1/payments/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, json: (await res.json()) as any };
}

afterEach(async () => {
  while (apps.length) await apps.pop()!.close().catch(() => undefined);
  while (tempDirs.length) {
    await rm(tempDirs.pop()!, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("createApp (MockPsp composition)", () => {
  it("ALLOW: captures exactly the computed total and signs a genesis-chained receipt", async () => {
    const { app, baseUrl } = await makeApp();

    const { res, json } = await postPayment(baseUrl, { contract, payment: payment() });

    expect(res.status).toBe(200);
    expect(json.decision.verdict).toBe("ALLOW");
    expect(json.decision.computed_total_cents).toBe(7000);
    expect(json.pspResult.money_moved_cents).toBe(7000);
    expect(json.pspResult.capture_id).toBe("mock_capture_1");
    expect(json.receiptBody.receipt_id).toBe("rcpt_idem_jk101_allow_1");
    expect(app.psp.captureCount()).toBe(1);
    expect(app.psp.totalCapturedCents()).toBe(7000);
    expect(app.ledger.verify()).toBe(true);

    const receiptRes = await fetch(`${baseUrl}/v1/receipts/${json.receiptBody.receipt_id}`);
    const signed = (await receiptRes.json()) as any;
    expect(receiptRes.status).toBe(200);
    expect(signed.receipt.receipt_id).toBe("rcpt_idem_jk101_allow_1");
    expect(signed.receipt.prev_hash).toBe(GENESIS);
    expect(signed.receipt.hash).toHaveLength(64);
    expect(typeof signed.signature).toBe("string");
    expect(signed.signature.length).toBeGreaterThan(0);
  });

  it("BLOCK: total mismatch moves $0", async () => {
    const { app, baseUrl } = await makeApp();

    const { res, json } = await postPayment(baseUrl, {
      contract,
      payment: payment({
        id: "pay_jk101_block_1",
        idempotency_key: "idem_jk101_block_1",
        merchant_order_ref: "order_JK101_block_1",
        proposed_total_cents: 9999,
      }),
    });

    expect(res.status).toBe(422);
    expect(json.decision.verdict).toBe("BLOCK");
    expect(json.decision.reason_codes).toContain("TOTAL_MISMATCH");
    expect(json.pspResult.money_moved_cents).toBe(0);
    expect(json.pspResult.capture_id).toBeNull();
    expect(app.psp.captureCount()).toBe(0);
    expect(app.psp.totalCapturedCents()).toBe(0);
    expect(app.ledger.verify()).toBe(true);
  });

  it("replay: same idempotency_key returns the same receipt, charged once", async () => {
    const { app, baseUrl } = await makeApp();
    const body = { contract, payment: payment() };

    const first = await postPayment(baseUrl, body);
    const second = await postPayment(baseUrl, body);

    expect(first.res.status).toBe(200);
    expect(second.res.status).toBe(200);
    expect(second.res.headers.get("idempotent-replay")).toBe("true");
    expect(second.json.receiptBody.receipt_id).toBe(first.json.receiptBody.receipt_id);
    expect(second.json.pspResult.capture_id).toBe(first.json.pspResult.capture_id);
    expect(app.psp.captureCount()).toBe(1);
    expect(app.psp.totalCapturedCents()).toBe(7000);
  });
});
