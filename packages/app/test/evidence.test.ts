import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import type { AddressInfo } from "node:net";

import { createApp, type RecourseApp } from "../src/index.js";
import { generateSigningKeyPair } from "../../ledger/src/sign.js";

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
  const dir = await mkdtemp(nodePath.join(tmpdir(), "recourse-evidence-"));
  tempDirs.push(dir);
  const app = createApp({ dbPath: nodePath.join(dir, "app.test.db") });
  apps.push(app);
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

async function postJson(baseUrl: string, route: string, body: unknown) {
  const res = await fetch(`${baseUrl}${route}`, {
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

describe("POST /v1/evidence/verify", () => {
  it("verifies a real signed receipt pack", async () => {
    const { app, baseUrl } = await makeApp();

    const paid = await postJson(baseUrl, "/v1/payments/execute", { contract, payment });
    expect(paid.res.status).toBe(200);

    const entries = await app.db.receipts.listReceipts();
    expect(entries).toHaveLength(1);

    const { res, json } = await postJson(baseUrl, "/v1/evidence/verify", {
      entries,
      public_key_pem: app.publicKeyPem,
    });

    expect(res.status).toBe(200);
    expect(json).toEqual({
      valid: true,
      checks: { chain: true, signatures: true },
      failures: [],
    });
  });

  it("rejects a tampered receipt body", async () => {
    const { app, baseUrl } = await makeApp();

    const paid = await postJson(baseUrl, "/v1/payments/execute", { contract, payment });
    expect(paid.res.status).toBe(200);

    const entries = structuredClone(await app.db.receipts.listReceipts()) as any[];
    entries[0].receipt.money_moved_cents = 1;

    const { res, json } = await postJson(baseUrl, "/v1/evidence/verify", {
      entries,
      public_key_pem: app.publicKeyPem,
    });

    expect(res.status).toBe(200);
    expect(json.valid).toBe(false);
    expect(json.checks.chain).toBe(false);
    expect(json.failures).toContain("CHAIN_INVALID");
  });

  it("rejects the wrong public key while keeping the chain check true", async () => {
    const { app, baseUrl } = await makeApp();

    const paid = await postJson(baseUrl, "/v1/payments/execute", { contract, payment });
    expect(paid.res.status).toBe(200);

    const entries = await app.db.receipts.listReceipts();
    const otherKeys = generateSigningKeyPair();

    const { res, json } = await postJson(baseUrl, "/v1/evidence/verify", {
      entries,
      public_key_pem: otherKeys.publicKeyPem,
    });

    expect(res.status).toBe(200);
    expect(json.valid).toBe(false);
    expect(json.checks).toEqual({ chain: true, signatures: false });
    expect(json.failures).toContain("SIGNATURE_INVALID");
  });

  it("fails closed on malformed evidence", async () => {
    const { app, baseUrl } = await makeApp();

    const { res, json } = await postJson(baseUrl, "/v1/evidence/verify", {
      entries: "not-an-array",
      public_key_pem: app.publicKeyPem,
    });

    expect(res.status).toBe(400);
    expect(json.valid).toBe(false);
    expect(json.checks).toEqual({ chain: false, signatures: false });
    expect(json.failures).toContain("MALFORMED_EVIDENCE");
  });
});
