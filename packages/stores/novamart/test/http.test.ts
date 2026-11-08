import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_PRODUCTS } from "../../store-core/src/index.js";
import { createNovaMartServer } from "../src/server.js";

let server: http.Server;
let origin: string;
beforeEach(async () => {
  server = createNovaMartServer({
    port: 0,
    quoteSecret: "http-test-secret",
    quoteSigning: "configured",
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected TCP server address");
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  if (server?.listening)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});
async function json(path: string, init?: RequestInit) {
  const response = await fetch(origin + path, init);
  return { response, data: (await response.json()) as any };
}
function cookie(response: Response): string {
  const raw = response.headers.get("set-cookie");
  if (!raw) throw new Error("Expected cart cookie");
  return raw.split(";")[0]!;
}
const post = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("NovaMart HTTP API", () => {
  it("reports health identity, bound port, and quote signing mode", async () => {
    const { response, data } = await json("/health");
    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      ok: true,
      service: "novamart",
      merchantId: "novamart",
      port: Number(new URL(origin).port),
      quoteSigning: "configured",
    });
  });
  it("serves the home page with four categories and every product link", async () => {
    const response = await fetch(origin + "/");
    const html = await response.text();
    expect(response.status).toBe(200);
    for (const heading of [
      "Waterproof Jackets",
      "Wireless Headphones",
      "Running Shoes",
      "Travel Backpacks",
    ])
      expect(html).toContain(heading);
    for (const p of CANONICAL_PRODUCTS)
      expect(html).toContain(`/products/${p.slug}`);
    expect(html.match(/class="card"/g) ?? []).toHaveLength(20);
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(cookie(response)).toContain("novamart_cart_id=");
  });
  it("serves local CSS and client JavaScript", async () => {
    const css = await fetch(origin + "/assets/app.css");
    const js = await fetch(origin + "/assets/client.js");
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(await css.text()).toContain(".grid{display:grid");
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(await js.text()).toContain("/api/checkout/handoff");
  });
  it("returns HDP-001 first for the ANC headphones API search", async () => {
    const { response, data } = await json("/api/search?q=ANC%20headphones");
    expect(response.status).toBe(200);
    expect(data.results[0].sku).toBe("HDP-001");
    expect(data.results[0].estimatedTotalForOneCents).toBe(6774);
  });
  it("returns complete product API data with only visible content", async () => {
    const { response, data } = await json("/api/products/hdp-001");
    expect(response.status).toBe(200);
    expect(data.sku).toBe("HDP-001");
    expect(data.contentBlocks.length).toBeGreaterThan(0);
    expect(
      data.contentBlocks.every((b: any) => b.visibility === "VISIBLE"),
    ).toBe(true);
    expect(data.hiddenContent).toEqual([]);
    expect(data.reviews.length).toBeGreaterThanOrEqual(3);
  });
  it("includes advertised terms for every product detail response", async () => {
    for (const product of CANONICAL_PRODUCTS) {
      const { response, data } = await json(`/api/products/${product.sku}`);
      expect(response.status).toBe(200);
      expect(data.advertisedTerms).toMatchObject({ subscription: false, giftCard: false });
    }
  });
  it("returns 404 for an unknown product SKU", async () => {
    const { response, data } = await json("/api/products/not-a-product");
    expect(response.status).toBe(404);
    expect(data.error.code).toBe("PRODUCT_NOT_FOUND");
  });
  it("creates a cart cookie and returns the exact HDP-001 total", async () => {
    const { response, data } = await json(
      "/api/cart/items",
      post({ sku: "HDP-001", quantity: 1 }),
    );
    expect(response.status).toBe(200);
    expect(cookie(response)).toContain("novamart_cart_id=");
    expect(data.pricing).toMatchObject({
      merchandiseSubtotalCents: 5800,
      shippingCents: 495,
      taxCents: 479,
      computedTotalCents: 6774,
    });
  });
  it("patches cart quantity and deletes the line", async () => {
    const added = await fetch(
      origin + "/api/cart/items",
      post({ sku: "HDP-001", quantity: 1 }),
    );
    const c = cookie(added);
    const cart = (await added.json()) as any;
    const lineId = cart.cart.lines[0].id;
    const patched = await json("/api/cart/items", {
      ...post({ lineId, quantity: 2 }, "PATCH"),
      headers: { "content-type": "application/json", cookie: c },
    });
    expect(patched.response.status).toBe(200);
    expect(patched.data.cart.lines[0].quantity).toBe(2);
    const removed = await json(
      `/api/cart/items?lineId=${encodeURIComponent(lineId)}`,
      { method: "DELETE", headers: { cookie: c } },
    );
    expect(removed.response.status).toBe(200);
    expect(removed.data.cart.lines).toEqual([]);
  });
  it("rejects unknown products, illegal variants, and stock overflow", async () => {
    for (const body of [
      { sku: "bad", quantity: 1 },
      { sku: "JKT-001", quantity: 1, variant: { size: "XXL" } },
      { sku: "HDP-001", quantity: 999 },
    ]) {
      const { response, data } = await json("/api/cart/items", post(body));
      expect([400, 404]).toContain(response.status);
      expect(data.error.code).toBeTruthy();
    }
  });
  it("returns safe JSON for malformed request bodies", async () => {
    const response = await fetch(origin + "/api/cart/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_JSON",
        message: "Request body must be valid JSON",
      },
    });
  });
  it("renders product detail with product name and customer reviews", async () => {
    const response = await fetch(origin + "/products/hdp-001");
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("X200 Wireless Noise-Cancelling Headphones");
    expect(html).toContain("Customer reviews");
    expect(html).toContain("Showing 4 recent reviews");
  });
  it("renders safe checkout language and does not claim payment success", async () => {
    const add = await fetch(
      origin + "/api/cart/items",
      post({ sku: "HDP-001", quantity: 1 }),
    );
    const response = await fetch(origin + "/checkout", {
      headers: { cookie: cookie(add) },
    });
    const html = await response.text();
    expect(html).toContain("PayPal Sandbox via Recourse");
    expect(html).toContain("Continue to Recourse Secure Checkout");
    expect(html).not.toContain("Payment successful");
    expect(html).toContain("do not enter real personal information");
  });
  it("returns a styled 404 for unknown product pages and paths", async () => {
    for (const path of ["/products/missing", "/unrecognized"]) {
      const response = await fetch(origin + path);
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain("couldn’t find that page");
    }
  });
  it("serves a handoff page only for an issued quote", async () => {
    const missing = await fetch(origin + "/checkout/handoff?quoteId=missing");
    expect(missing.status).toBe(404);
    const add = await fetch(
      origin + "/api/cart/items",
      post({ sku: "HDP-001", quantity: 1 }),
    );
    const c = cookie(add);
    const created = await json("/api/checkout/handoff", {
      ...post({}),
      headers: { "content-type": "application/json", cookie: c },
    });
    expect(created.data.payment.orderCreated).toBe(false);
    const page = await fetch(
      origin +
        `/checkout/handoff?quoteId=${encodeURIComponent(created.data.quote.quoteId)}`,
      { headers: { cookie: c } },
    );
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("Quote locked and ready for Recourse");
    expect(html).toContain("PayPal order created: No");
    expect(html).toContain("Captured amount: $0 so far");
    expect(html).not.toContain("Payment successful");
  });
  it("keeps provider SDKs, credentials, and direct order/capture endpoints out of source", async () => {
    const srcDir = fileURLToPath(new URL("../src", import.meta.url));
    const files = await walk(srcDir);
    const source = (
      await Promise.all(files.map((file) => readFile(file, "utf8")))
    )
      .join("\n")
      .toLowerCase();
    for (const forbidden of [
      "paypal_novamart_client_id",
      "paypal_novamart_secret",
      "api-m.sandbox.paypal.com",
      "api-m.paypal.com",
      "/v2/checkout/orders",
      "capturepayment",
      "@paypal",
    ])
      expect(source).not.toContain(forbidden);
  });
});
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return files.flat();
}
