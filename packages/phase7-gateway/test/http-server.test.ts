import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { RunDecision } from "../../phase7-contracts/src/run.js";
import { GatewayService } from "../src/gateway-service.js";
import { createGatewayHttpServer } from "../src/http-server.js";
import type { GatewayServiceDependencies } from "../src/gateway-service.js";

const at = "2026-02-01T00:00:00.000Z";
function serviceWith(decision: RunDecision) {
  let eventNo = 0;
  const deps: GatewayServiceDependencies = {
    clock: { now: () => at }, ids: { runId: () => `run_http_${++eventNo}`, eventId: () => `evt_${++eventNo}` },
    quoteVerifier: { verify: () => ({ ok: true, merchantId: "novamart", sku: "HDP-001", quoteTotalCents: 6774 }) },
    decision: { decide: () => decision },
    payment: { execute: async () => ({ receiptId: "receipt_http", status: "COMPLETED" }) },
    evidence: { issue: async () => ({ evidenceId: "evidence_http" }) },
  };
  return new GatewayService(deps);
}
const candidate = (runId: string) => ({ id: `cand_${runId}`, runId, rank: 1, status: "PROPOSED", merchantId: "novamart", merchantDisplayName: "NovaMart Official", sku: "HDP-001", productName: "Headphones", quantity: 1, advertisedTotalCents: 6774, currency: "USD", seller: { id: "seller", name: "NovaMart", verified: true }, terms: { condition: "NEW", returnsDays: 30, finalSale: false, warrantyLabel: "One year", subscription: false, giftCard: false }, hiddenContent: [] });

describe("Gateway HTTP API", () => {
  let server: Server;
  let base = "";
  afterEach(async () => { if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve())); });

  it("creates runs, polls later events, selects candidates, and handles step-up", async () => {
    const service = serviceWith({ outcome: "STEP_UP", reasonCodes: [], computedTotalCents: 6774 });
    server = createGatewayHttpServer(service);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No test server address");
    base = `http://127.0.0.1:${address.port}`;
    expect(await fetch(`${base}/health`).then((r) => r.json())).toEqual({ ok: true });
    const createdResponse = await fetch(`${base}/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "Buy headphones" }) });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { run: { id: string } };
    service.beginSearch(created.run.id);
    service.registerCandidates(created.run.id, [candidate(created.run.id)]);
    const polled = await fetch(`${base}/runs/${created.run.id}/events?afterSeq=1`).then((r) => r.json()) as { events: { seq: number }[] };
    expect(polled.events.length).toBeGreaterThan(0);
    expect(polled.events.every((event) => event.seq > 1)).toBe(true);
    const selected = await fetch(`${base}/runs/${created.run.id}/select`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId: `cand_${created.run.id}` }) }).then((r) => r.json()) as { run: { status: string } };
    expect(selected.run.status).toBe("AWAITING_SIGNATURE");

    const stepRun = service.createRun("Another purchase");
    service.beginSearch(stepRun.id);
    service.registerCandidates(stepRun.id, [candidate(stepRun.id)]);
    service.selectCandidate(stepRun.id, `cand_${stepRun.id}`);
    service.createDraft(stepRun.id, "draft_http");
    await service.submitSignedQuote(stepRun.id, { signedIntentId: "intent_http", quoteId: "quote_http", signedQuote: {} });
    const stepped = await fetch(`${base}/runs/${stepRun.id}/step-up`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "APPROVE" }) }).then((r) => r.json()) as { run: { status: string } };
    expect(stepped.run.status).toBe("COMPLETED");
  });

  it("uses the documented error envelope and status codes", async () => {
    server = createGatewayHttpServer(serviceWith({ outcome: "ALLOW", reasonCodes: [], computedTotalCents: 1 }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No test server address");
    base = `http://127.0.0.1:${address.port}`;
    const bad = await fetch(`${base}/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "" }) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    const missing = await fetch(`${base}/runs/run_absent`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "RUN_NOT_FOUND" } });
    const malformed = await fetch(`${base}/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "INVALID_JSON" } });
  });
});
