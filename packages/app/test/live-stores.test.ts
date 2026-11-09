import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { createNovaMartServer } from "../../stores/novamart/src/server.js";
import { createDealDemonServer } from "../../stores/dealdemon/src/server.js";
import { createPeerMarketServer } from "../../stores/peermarket/src/server.js";
import { createAppServer, type AppServerInstance } from "../src/server.js";

describe("Live Store Integration (HTTP ports 8801, 8802, 8803)", () => {
  let novamartServer: http.Server;
  let dealdemonServer: http.Server;
  let peermarketServer: http.Server;
  let app: AppServerInstance;
  let baseUrl: string;

  const secrets = {
    novamart: process.env.NOVAMART_QUOTE_SECRET ?? "novamart-secret-key-32-bytes-ok!",
    dealdemon: process.env.DEALDEMON_QUOTE_SECRET ?? "dealdemon-secret-key-32-bytes-ok!",
    peermarket: process.env.PEERMARKET_QUOTE_SECRET ?? "peermarket-secret-key-32-bytes-ok!",
  };

  beforeAll(async () => {
    // Start actual HTTP store servers on their canonical ports
    novamartServer = createNovaMartServer({ port: 8801, quoteSecret: secrets.novamart, quoteSigning: "configured" });
    dealdemonServer = createDealDemonServer({ port: 8802, quoteSecret: secrets.dealdemon, quoteSigning: "configured" });
    peermarketServer = createPeerMarketServer({ port: 8803, quoteSecret: secrets.peermarket, quoteSigning: "configured" });

    await new Promise<void>((resolve) => novamartServer.listen(8801, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => dealdemonServer.listen(8802, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => peermarketServer.listen(8803, "127.0.0.1", resolve));

    app = await createAppServer({ port: 0 });
    baseUrl = `http://127.0.0.1:${app.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    await new Promise<void>((resolve) => novamartServer.close(() => resolve()));
    await new Promise<void>((resolve) => dealdemonServer.close(() => resolve()));
    await new Promise<void>((resolve) => peermarketServer.close(() => resolve()));
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
});
