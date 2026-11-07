import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import type { AddressInfo } from "node:net";

import { createApp, type RecourseApp } from "../src/index.js";

const apps: RecourseApp[] = [];
const tempDirs: string[] = [];

async function makeApp() {
  const dir = await mkdtemp(nodePath.join(tmpdir(), "recourse-ui-"));
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

describe("Recourse UI", () => {
  it("serves the Mock-labelled UI shell at GET /", async () => {
    const { baseUrl } = await makeApp();

    const res = await fetch(`${baseUrl}/`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("Recourse");
    expect(body).toContain("MOCK/SANDBOX - NO REAL MONEY");
    expect(body).toContain('id="refresh-status"');
    expect(body).toContain('id="status-mode"');
    expect(body).toContain('id="status-psp"');
    expect(body).toContain('id="status-judge"');
    expect(body).toContain('id="status-receipt-count"');
    expect(body).toContain('id="status-chain-verified"');
    expect(body).toContain('id="signing-public-key"');
    expect(body).toContain("/v1/app/status");
    expect(body).not.toContain("BEGIN PRIVATE KEY");
  });

  it("exposes an interactive ALLOW demo wired to the payment endpoint", async () => {
    const { baseUrl } = await makeApp();

    const res = await fetch(`${baseUrl}/`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("Run ALLOW demo");
    expect(body).toContain('id="run-allow"');
    expect(body).toContain('id="allow-result"');
    expect(body).toContain('id="allow-output"');
    expect(body).toContain("/v1/payments/execute");
    expect(body).toContain("merchant_trailgear");
    expect(body).toContain("JK-101");
  });
  it("keeps API routes working alongside the UI", async () => {
    const { baseUrl } = await makeApp();

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);

    const status = await fetch(`${baseUrl}/v1/app/status`);
    expect(status.status).toBe(200);
  });
});

describe("Recourse UI ALLOW payload", () => {
  it("builds a payment request that executes as ALLOW", async () => {
    const { baseUrl } = await makeApp();

    const pageRes = await fetch(`${baseUrl}/`);
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();

    const start = html.indexOf("var demoContract");
    const end = html.indexOf("async function runAllowDemo");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const script = html.slice(start, end);
    const factory = new Function(
      `${script}\nreturn buildAllowRequest;`,
    ) as unknown as () => () => unknown;
    const buildAllowRequest = factory();

    const payload = buildAllowRequest();
    const executeRes = await fetch(`${baseUrl}/v1/payments/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result: unknown = await executeRes.json();
    const serialized = JSON.stringify(result);

    expect(executeRes.status).toBe(200);
    expect(serialized).toContain("ALLOW");
    expect(serialized).toContain("7000");

    const statusRes = await fetch(`${baseUrl}/v1/app/status`);
    const status = (await statusRes.json()) as {
      receipt_count?: unknown;
      chain_verified?: unknown;
    };

    expect(status.receipt_count).toBe(1);
    expect(status.chain_verified).toBe(true);
  });
});

describe("Recourse UI BLOCK demo", () => {
  it("exposes an interactive BLOCK demo wired to the payment endpoint", async () => {
    const { baseUrl } = await makeApp();

    const res = await fetch(`${baseUrl}/`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("Run BLOCK demo");
    expect(body).toContain('id="run-block"');
    expect(body).toContain('id="block-result"');
    expect(body).toContain('id="block-output"');
    expect(body).toContain("buildBlockRequest");
    expect(body).toContain("proposed_total_cents: 12000");
    expect(body).toContain("res.status === 422");
    expect(body).toContain("decision.verdict");
    expect(body).toContain("decision.reason_codes");
    expect(body).toContain("money_moved_cents");
  });
});

describe("Recourse UI BLOCK payload", () => {
  it("builds a tampered payment request that executes as BLOCK", async () => {
    const { baseUrl } = await makeApp();

    const pageRes = await fetch(`${baseUrl}/`);
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();

    const start = html.indexOf("var demoContract");
    const end = html.indexOf("async function runBlockDemo");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const script = html.slice(start, end);
    const factory = new Function(
      `${script}\nreturn buildBlockRequest;`,
    ) as unknown as () => () => unknown;
    const buildBlockRequest = factory();

    const payload = buildBlockRequest();
    const executeRes = await fetch(`${baseUrl}/v1/payments/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result: unknown = await executeRes.json();
    const serialized = JSON.stringify(result);

    expect(executeRes.status).toBe(422);
    expect(serialized).toContain("BLOCK");
    expect(serialized).toContain("TOTAL_MISMATCH");
    expect(serialized).toContain('"money_moved_cents":0');
    expect(serialized).toContain('"capture_id":null');
    expect(serialized).toContain("7000");
    expect(serialized).toContain("12000");
    expect(serialized).not.toMatch(/"capture_id"\s*:\s*"[^"]+"/);
    expect(serialized).not.toMatch(/"captureId"\s*:\s*"[^"]+"/);

    const statusRes = await fetch(`${baseUrl}/v1/app/status`);
    const status = (await statusRes.json()) as {
      receipt_count?: unknown;
      chain_verified?: unknown;
    };

    expect(status.receipt_count).toBe(1);
    expect(status.chain_verified).toBe(true);
  });
});

describe("Recourse UI Evidence demo", () => {
  it("exposes an interactive Evidence demo wired to signed receipts", async () => {
    const { baseUrl } = await makeApp();

    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain("Run Evidence demo");
    expect(body).toContain('id="run-evidence"');
    expect(body).toContain('id="evidence-result"');
    expect(body).toContain('id="evidence-output"');
    expect(body).toContain("demoReceiptIds");
    expect(body).toContain("buildEvidenceRequest");
    expect(body).toContain("async function runEvidenceDemo()");
    expect(body).toContain("rememberReceipt(result)");
    expect(body).toContain('fetch("/v1/app/status"');
    expect(body).toContain('fetch("/v1/receipts/"');
    expect(body).toContain("encodeURIComponent(receiptId)");
    expect(body).toContain('fetch("/v1/evidence/verify"');
    expect(body).toContain("public_key_pem");
    expect(body).toContain("checks.chain");
    expect(body).toContain("checks.signatures");
    expect(body).toContain("failures");
    expect(body).toContain('addEventListener("click", runEvidenceDemo)');
  });
});

describe("Recourse UI Evidence payload", () => {
  it("builds an evidence request that verifies a real signed receipt", async () => {
    const { baseUrl } = await makeApp();

    const pageRes = await fetch(`${baseUrl}/`);
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();

    const start = html.indexOf("var demoContract");
    const end = html.indexOf("async function runEvidenceDemo");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const script = html.slice(start, end);
    const factory = new Function(
      `${script}\nreturn { buildAllowRequest, buildEvidenceRequest };`,
    ) as unknown as () => {
      buildAllowRequest: () => unknown;
      buildEvidenceRequest: (entries: unknown, publicKeyPem: string) => unknown;
    };
    const { buildAllowRequest, buildEvidenceRequest } = factory();

    const executeRes = await fetch(`${baseUrl}/v1/payments/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildAllowRequest()),
    });
    expect(executeRes.status).toBe(200);

    const executeResult = (await executeRes.json()) as any;
    const receiptId = executeResult.receiptBody.receipt_id;
    expect(typeof receiptId).toBe("string");

    const receiptRes = await fetch(
      `${baseUrl}/v1/receipts/${encodeURIComponent(receiptId)}`,
    );
    expect(receiptRes.status).toBe(200);
    const signedEntry = await receiptRes.json();

    const statusRes = await fetch(`${baseUrl}/v1/app/status`);
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as any;
    expect(typeof status.signing_public_key_pem).toBe("string");

    const verifyPayload = buildEvidenceRequest(
      [signedEntry],
      status.signing_public_key_pem,
    );
    expect(verifyPayload).toEqual({
      entries: [signedEntry],
      public_key_pem: status.signing_public_key_pem,
    });

    const verifyRes = await fetch(`${baseUrl}/v1/evidence/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(verifyPayload),
    });
    const verifyResult = (await verifyRes.json()) as any;

    expect(verifyRes.status).toBe(200);
    expect(verifyResult).toEqual({
      valid: true,
      checks: { chain: true, signatures: true },
      failures: [],
    });
  });
});
