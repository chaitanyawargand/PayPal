import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import { createNovaMartServer } from "../../stores/novamart/src/server.js";
import { createDealDemonServer } from "../../stores/dealdemon/src/server.js";
import { createPeerMarketServer } from "../../stores/peermarket/src/server.js";
import { createAppServer, type AppServerInstance } from "../src/server.js";
import { DataAdapter } from "../src/adapter.js";
import { verifySignedQuote } from "../../stores/store-core/src/quote.js";
import { HmacQuoteVerifier, InMemoryVerifiedQuoteStore } from "../../phase7-host/src/quote-verifier.js";
import { NovaMartStorefront } from "../../stores/novamart/src/storefront.js";
import { DealDemonStorefront } from "../../stores/dealdemon/src/storefront.js";
import { PeerMarketStorefront } from "../../stores/peermarket/src/storefront.js";
import { AgentBrainService } from "../../phase7-agent/src/agent-brain.js";
import { HttpMerchantToolTransport } from "../../phase7-agent/src/merchant-tools.js";

describe("Live Store Integration (real HTTP store servers on ephemeral ports)", () => {
  let novamartServer: http.Server;
  let dealdemonServer: http.Server;
  let peermarketServer: http.Server;
  let app: AppServerInstance;
  let baseUrl: string;
  let merchantBaseUrls: { novamart: string; dealdemon: string; peermarket: string };

  async function listenEphemeral(server: http.Server): Promise<string> {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Store server did not bind a TCP port.");
    return `http://127.0.0.1:${address.port}`;
  }

  const secrets = {
    novamart: "test-only-novamart-quote-key-32-bytes",
    dealdemon: "test-only-dealdemon-quote-key-32-bytes",
    peermarket: "test-only-peermarket-quote-key-32-bytes",
  };

  beforeAll(async () => {
    vi.stubEnv("NOVAMART_QUOTE_SECRET", secrets.novamart);
    vi.stubEnv("DEALDEMON_QUOTE_SECRET", secrets.dealdemon);
    vi.stubEnv("PEERMARKET_QUOTE_SECRET", secrets.peermarket);
    novamartServer = createNovaMartServer({ port: 0, quoteSecret: secrets.novamart, quoteSigning: "configured" });
    dealdemonServer = createDealDemonServer({ port: 0, quoteSecret: secrets.dealdemon, quoteSigning: "configured" });
    peermarketServer = createPeerMarketServer({ port: 0, quoteSecret: secrets.peermarket, quoteSigning: "configured" });

    merchantBaseUrls = {
      novamart: await listenEphemeral(novamartServer),
      dealdemon: await listenEphemeral(dealdemonServer),
      peermarket: await listenEphemeral(peermarketServer),
    };

    const brain = new AgentBrainService({ RECOURSE_AGENT_BRAIN: "deterministic" }, async () => { throw new Error("unexpected network call"); });
    app = await createAppServer({ port: 0, adapter: new DataAdapter(brain, { merchantBaseUrls }) });
    baseUrl = `http://127.0.0.1:${app.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    await new Promise<void>((resolve) => novamartServer.close(() => resolve()));
    await new Promise<void>((resolve) => dealdemonServer.close(() => resolve()));
    await new Promise<void>((resolve) => peermarketServer.close(() => resolve()));
    vi.unstubAllEnvs();
  });

  it("discovers live candidates from all 3 running stores via HTTP, finding NovaMart HDP-001", async () => {
    const res = await fetch(`${baseUrl}/api/discovery/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Cheapest wireless headphones, max $70 all-in, no subscriptions or gift cards, ask me about unverified sellers.",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.run.status).toBe("AWAITING_SELECTION");
    expect(data.candidates.length).toBeGreaterThan(0);

    // Verify NovaMart HDP-001 is present
    const novaHdp = data.candidates.find((c: any) => c.merchantId === "novamart" && c.sku === "HDP-001");
    expect(novaHdp).toBeDefined();
    expect(novaHdp.productName).toContain("Headphones");
    expect(novaHdp.status).toBe("PROPOSED");
    expect(novaHdp.quoteTotalCents).toBe(6774); // Exact expected: $67.74!

    // Verify DealDemon candidate is present
    const ddCand = data.candidates.find((c: any) => c.merchantId === "dealdemon");
    expect(ddCand).toBeDefined();

    // Verify PeerMarket candidate is present
    const peerCand = data.candidates.find((c: any) => c.merchantId === "peermarket");
    expect(peerCand).toBeDefined();

    // Select NovaMart HDP-001 and execute full purchase
    const selectRes = await fetch(`${baseUrl}/api/run/${data.run.id}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: novaHdp.id }),
    });
    expect(selectRes.status).toBe(200);

    const signRes = await fetch(`${baseUrl}/api/run/${data.run.id}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        limits: {
          maxBudgetCents: 7000,
          perOrderCapCents: 7000,
          noSubscriptions: true,
          noGiftCards: true,
        },
      }),
    });
    expect(signRes.status).toBe(200);
    const execution = await signRes.json();
    expect(execution.run.status).toBe("COMPLETED");
    expect(execution.run.decision.outcome).toBe("ALLOW");
    expect(execution.run.decision.computedTotalCents).toBe(6774); // $67.74 captured!
  });

  it("verifies real quotes from all three merchant signers with the real HMAC verifier", () => {
    const stores = [
      ["novamart", secrets.novamart, new NovaMartStorefront(secrets.novamart)],
      ["dealdemon", secrets.dealdemon, new DealDemonStorefront(secrets.dealdemon)],
      ["peermarket", secrets.peermarket, new PeerMarketStorefront(secrets.peermarket)],
    ] as const;
    const verifier = new HmacQuoteVerifier({ merchantSecrets: secrets, quoteStore: new InMemoryVerifiedQuoteStore(), clock: { now: () => new Date() } });
    for (const [merchantId, secret, store] of stores) {
      const cart = store.getCart();
      store.addCartItem(cart.id, "HDP-001", 1);
      const signedAtIssue = store.createQuote(cart.id);
      expect(verifySignedQuote(signedAtIssue, secret)).toBe(true);
      expect(verifier.verify({ runId: `run_${merchantId}`, candidateId: `candidate_${merchantId}`, quoteId: signedAtIssue.quoteId, signedQuote: signedAtIssue })).toMatchObject({ ok: true, merchantId, sku: "HDP-001" });
    }
  });

  it("keeps an unset-secret app on its same-process signer/verifier instead of accepting an unrelated store process key", async () => {
    vi.stubEnv("NOVAMART_QUOTE_SECRET", "");
    vi.stubEnv("DEALDEMON_QUOTE_SECRET", "");
    vi.stubEnv("PEERMARKET_QUOTE_SECRET", "");
    const brain = new AgentBrainService({ RECOURSE_AGENT_BRAIN: "deterministic" }, async () => { throw new Error("unexpected network call"); });
    const localAdapter = new DataAdapter(brain, { merchantBaseUrls });
    try {
      const remoteTransport = new HttpMerchantToolTransport(globalThis.fetch.bind(globalThis), 2500, merchantBaseUrls);
      const externalSummary = await remoteTransport.requestQuote({ merchantId: "novamart", sku: "HDP-001", quantity: 1 });
      const externalResponse = await fetch(`${merchantBaseUrls.novamart}/api/quotes/${encodeURIComponent(externalSummary.quoteId)}`);
      const externalQuote = await externalResponse.json();
      expect(verifySignedQuote(externalQuote, (localAdapter as any).merchantSecrets.novamart)).toBe(false);
      expect((localAdapter as any).remoteQuoteAccess.novamart).toBe(false);

      const result = await localAdapter.startMission("Cheapest new wireless headphones, max $70 all-in, no subscriptions or gift cards");
      expect(result.status).toBe("COMPLETED");
      expect(result.capturedCents).toBe(6774);
      expect(result.evidenceValid).toBe(true);
      expect(localAdapter.getPspStats()).toEqual({ captureCount: 1, capturedCents: 6774 });
    } finally {
      localAdapter.close();
      vi.stubEnv("NOVAMART_QUOTE_SECRET", secrets.novamart);
      vi.stubEnv("DEALDEMON_QUOTE_SECRET", secrets.dealdemon);
      vi.stubEnv("PEERMARKET_QUOTE_SECRET", secrets.peermarket);
    }
  });

  it("runs the autonomous $70 NovaMart mission with the untouched real merchant quote pair", async () => {
    const adapter = app.adapter as any;
    expect(adapter.remoteQuoteAccess.novamart).toBe(true);
    const transport = adapter.toolTransport;
    const gateway = adapter.getGateway();
    const originalRequestQuote = transport.requestQuote.bind(transport);
    const originalSubmitSignedQuote = gateway.submitSignedQuote.bind(gateway);
    const issuedQuotes = new Map<string, unknown>();
    const verifiedBeforeSubmit: unknown[] = [];
    transport.requestQuote = async (input: any) => {
      const summary = await originalRequestQuote(input);
      const quote = transport.getCachedQuote(summary.quoteId);
      expect(verifySignedQuote(quote, secrets[input.merchantId as keyof typeof secrets])).toBe(true);
      issuedQuotes.set(summary.quoteId, structuredClone(quote));
      return summary;
    };
    gateway.submitSignedQuote = async (runId: string, input: any) => {
      expect(input.signedQuote).toEqual(issuedQuotes.get(input.quoteId));
      expect(verifySignedQuote(input.signedQuote, secrets[input.signedQuote.merchantId as keyof typeof secrets])).toBe(true);
      verifiedBeforeSubmit.push(structuredClone(input.signedQuote));
      return originalSubmitSignedQuote(runId, input);
    };
    try {
      const before = app.adapter.getPspStats();
      const prompt = "Cheapest new wireless headphones, max $70 all-in, no subscriptions or gift cards";
      const draftRes = await fetch(`${baseUrl}/api/missions/drafts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const draft = await draftRes.json();
      expect(draft.status).toBe("DRAFT_READY_FOR_REVIEW");
      const startRes = await fetch(`${baseUrl}/api/missions/drafts/${draft.draftId}/sign-start`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productQuery: "headphones", quantity: 1, condition: "new", maxAllInCapDollars: "70.00",
          requiredAttributes: ["wireless"], preferredAttributes: ["cheapest"], exclusions: ["subscription", "gift card"],
          confirmHardCap: true, revision: draft.revision,
        }),
      });
      expect(startRes.status).toBe(200);
      const result = await startRes.json();
      expect(result.status).toBe("COMPLETED");
      expect(result.attempts).toBe(1);
      expect(result.capturedCents).toBe(6774);
      expect(result.evidenceValid).toBe(true);
      expect(result.runId).toBeTruthy();
      expect(verifiedBeforeSubmit).toHaveLength(1);
      expect((verifiedBeforeSubmit[0] as any).merchantId).toBe("novamart");
      expect((verifiedBeforeSubmit[0] as any).items[0].sku).toBe("HDP-001");
      expect((verifiedBeforeSubmit[0] as any).totalCents).toBe(6774);
      expect((await app.adapter.getPspStats()).captureCount - before.captureCount).toBe(1);
      expect((await app.adapter.getPspStats()).capturedCents - before.capturedCents).toBe(6774);
      expect(adapter.missionService.missions.size).toBe(1);
      const events = app.adapter.getEvents(result.runId);
      expect(events.map((event: any) => event.type)).toContain("QUOTE_SIGNATURE_VERIFIED");
      expect(events.map((event: any) => event.type)).not.toContain("QUOTE_SIGNATURE_FAILED");
    } finally {
      transport.requestQuote = originalRequestQuote;
      gateway.submitSignedQuote = originalSubmitSignedQuote;
    }
  });

  it("refreshes an expired NovaMart quote by obtaining and submitting a new signed quote pair", async () => {
    const adapter = app.adapter as any;
    const transport = adapter.toolTransport;
    const gateway = adapter.getGateway();
    const missionService = adapter.missionService;
    const ports = missionService.ports;
    const originalRequestQuote = transport.requestQuote.bind(transport);
    const originalSubmit = gateway.submitSignedQuote.bind(gateway);
    const originalGetSignedQuote = adapter.getSignedQuote.bind(adapter);
    const originalRefresh = ports.refresh.bind(ports);
    const issuedQuotes = new Map<string, unknown>();
    const submitted: unknown[] = [];
    let markDiscoveredQuotesExpired = true;
    transport.requestQuote = async (input: any) => {
      const summary = await originalRequestQuote(input);
      issuedQuotes.set(summary.quoteId, structuredClone(transport.getCachedQuote(summary.quoteId)));
      return summary;
    };
    adapter.getSignedQuote = async (merchantId: string, quoteId: string) => {
      const quote = await originalGetSignedQuote(merchantId, quoteId);
      return markDiscoveredQuotesExpired ? { ...quote, expiresAt: "2000-01-01T00:00:00.000Z" } : quote;
    };
    ports.refresh = async (...args: any[]) => {
      markDiscoveredQuotesExpired = false;
      return originalRefresh(...args);
    };
    gateway.submitSignedQuote = async (runId: string, input: any) => {
      expect(input.signedQuote).toEqual(issuedQuotes.get(input.quoteId));
      submitted.push(structuredClone(input.signedQuote));
      return originalSubmit(runId, input);
    };
    try {
      const before = app.adapter.getPspStats();
      const result = await app.adapter.startMission("Cheapest new wireless headphones, max $70 all-in, no subscriptions or gift cards");
      expect(result.status).toBe("COMPLETED");
      expect(result.attempts).toBe(1);
      expect(result.capturedCents).toBe(6774);
      expect(result.evidenceValid).toBe(true);
      expect(issuedQuotes.size).toBeGreaterThan(1);
      expect(submitted).toHaveLength(1);
      expect((submitted[0] as any).quoteId).not.toBe([...issuedQuotes.keys()][0]);
      expect(verifySignedQuote(submitted[0], secrets.novamart)).toBe(true);
      expect(app.adapter.getPspStats().captureCount - before.captureCount).toBe(1);
    } finally {
      transport.requestQuote = originalRequestQuote;
      adapter.getSignedQuote = originalGetSignedQuote;
      ports.refresh = originalRefresh;
      gateway.submitSignedQuote = originalSubmit;
    }
  });

  it.each(["quote-A-with-B-signature", "totalCents", "merchantId", "sku"] as const)("rejects genuine merchant quote tampering (%s) without retry or capture", async (tamper) => {
    const adapter = app.adapter as any;
    const gateway = adapter.getGateway();
    const originalSubmit = gateway.submitSignedQuote.bind(gateway);
    const signer = new NovaMartStorefront(secrets.novamart);
    const cart = signer.getCart(); signer.addCartItem(cart.id, "HDP-001", 1);
    const quoteB = signer.createQuote(cart.id);
    gateway.submitSignedQuote = async (runId: string, input: any) => {
      const quote = structuredClone(input.signedQuote);
      if (tamper === "quote-A-with-B-signature") quote.signature = quoteB.signature;
      if (tamper === "totalCents") quote.totalCents += 1;
      if (tamper === "merchantId") quote.merchantId = "dealdemon";
      if (tamper === "sku") quote.items[0].sku = "JKT-001";
      return originalSubmit(runId, { ...input, signedQuote: quote });
    };
    try {
      const before = app.adapter.getPspStats();
      const prompt = "Cheapest new wireless headphones, max $70 all-in, no subscriptions or gift cards";
      const draftRes = await fetch(`${baseUrl}/api/missions/drafts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const draft = await draftRes.json();
      const resultRes = await fetch(`${baseUrl}/api/missions/drafts/${draft.draftId}/sign-start`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productQuery: "headphones", quantity: 1, condition: "new", maxAllInCapDollars: "70.00",
          requiredAttributes: ["wireless"], preferredAttributes: ["cheapest"], exclusions: ["subscription", "gift card"],
          confirmHardCap: true, revision: draft.revision,
        }),
      });
      expect(resultRes.status).toBe(200);
      const result = await resultRes.json();
      expect(result.status).toBe("ABORTED");
      expect(result.attempts).toBe(1);
      expect(result.capturedCents).toBe(0);
      expect(result.securityAlert).toMatch(/quote signature validation failed/i);
      expect(app.adapter.getPspStats()).toEqual(before);
      expect(app.adapter.getEvents(result.runId).map((event: any) => event.type)).toContain("QUOTE_SIGNATURE_FAILED");
    } finally {
      gateway.submitSignedQuote = originalSubmit;
    }
  });
});
