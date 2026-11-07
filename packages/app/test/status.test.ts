import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import type { AddressInfo } from "node:net";

import { createApp, type RecourseApp } from "../src/index.js";

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

const payment = {
  id: "pay_jk101_1",
  contract_id: contract.id,
  idempotency_key: "idem_jk101_allow_1",
  merchant_id: "merchant_trailgear",
  merchant_order_ref: "order_JK101_1",
  items: [{ sku: "JK-101", qty: 1, unit_price_cents: 7000 }],
  proposed_total_cents: 7000,
  spans: [],
};

const apps: RecourseApp[] = [];
const tempDirs: string[] = [];

async function makeApp() {
  const dir = await mkdtemp(nodePath.join(tmpdir(), "recourse-status-"));
  tempDirs.push(dir);
  const app = createApp({ dbPath: nodePath.join(dir, "app.test.db") });
  apps.push(app);
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

afterEach(async () => {
  while (apps.length) await apps.pop()!.close().catch(() => undefined);
  while (tempDirs.length) {
    await rm(tempDirs.pop()!, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("GET /v1/app/status", () => {
  it("reports Mock mode, disconnected judge, and no private key", async () => {
    const { baseUrl } = await makeApp();

    const res = await fetch(`${baseUrl}/v1/app/status`);
    const json = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(json).toEqual(
      expect.objectContaining({
        service: "recourse-app",
        mode: "MOCK",
        real_money: false,
        safety_label: "MOCK/SANDBOX - NO REAL MONEY",
        psp: "MockPsp",
        psp_tier: "C",
        judge: "DISCONNECTED",
        receipt_count: 0,
        chain_verified: true,
      }),
    );
    expect(json.signing_public_key_pem).toContain("BEGIN PUBLIC KEY");
    expect(JSON.stringify(json)).not.toContain("PRIVATE KEY");

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
  });

  it("updates receipt count after a signed payment", async () => {
    const { baseUrl } = await makeApp();

    const paid = await fetch(`${baseUrl}/v1/payments/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contract, payment }),
    });
    expect(paid.status).toBe(200);

    const res = await fetch(`${baseUrl}/v1/app/status`);
    const json = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(json.receipt_count).toBe(1);
    expect(json.chain_verified).toBe(true);
  });
});
