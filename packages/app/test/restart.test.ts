import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import type { AddressInfo } from "node:net";

import { createApp, type RecourseApp } from "../src/index.js";
import { generateSigningKeyPair } from "../../ledger/src/sign.js";
import { verifySignedReceipts } from "../../ledger/src/store.js";
import { MockPsp } from "../../psp/src/mock.js";

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

async function startApp(
  dbPath: string,
  psp: MockPsp,
  signingKeyPair: ReturnType<typeof generateSigningKeyPair>,
) {
  const app = createApp({ dbPath, psp, signingKeyPair });
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

describe("createApp signer restart", () => {
  it("extends the persisted signed chain instead of restarting at genesis", async () => {
    const dir = await mkdtemp(nodePath.join(tmpdir(), "recourse-app-restart-"));
    tempDirs.push(dir);
    const dbPath = nodePath.join(dir, "app.test.db");

    // Signing keys and PSP are external/persisted across a process restart.
    const keys = generateSigningKeyPair();
    const psp = new MockPsp();

    const firstRun = await startApp(dbPath, psp, keys);
    const first = await postPayment(firstRun.baseUrl, { contract, payment: payment() });
    expect(first.res.status).toBe(200);

    const firstReceiptRes = await fetch(
      `${firstRun.baseUrl}/v1/receipts/${first.json.receiptBody.receipt_id}`,
    );
    const firstSigned = (await firstReceiptRes.json()) as any;
    expect(firstReceiptRes.status).toBe(200);

    await firstRun.app.close();

    const secondRun = await startApp(dbPath, psp, keys);
    const second = await postPayment(secondRun.baseUrl, {
      contract,
      payment: payment({
        id: "pay_jk101_2",
        idempotency_key: "idem_jk101_allow_2",
        merchant_order_ref: "order_JK101_2",
      }),
    });
    expect(second.res.status).toBe(200);

    const secondReceiptRes = await fetch(
      `${secondRun.baseUrl}/v1/receipts/${second.json.receiptBody.receipt_id}`,
    );
    const secondSigned = (await secondReceiptRes.json()) as any;
    expect(secondReceiptRes.status).toBe(200);
    expect(secondSigned.receipt.prev_hash).toBe(firstSigned.receipt.hash);

    const stored = await secondRun.app.db.receipts.listReceipts();
    expect(stored).toHaveLength(2);
    expect(verifySignedReceipts(stored, keys.publicKeyPem)).toBe(true);
    expect(secondRun.app.ledger.verify()).toBe(true);
    expect(psp.captureCount()).toBe(2);
    expect(psp.totalCapturedCents()).toBe(14000);
  });
});
