import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createGatewayServer } from "../src/server.js";
import type {
  GatewayDeps,
  ExecutePaymentResult,
  ReceiptBody,
  ReceiptStore,
} from "../src/types.js";

class InMemoryReceiptStore implements ReceiptStore {
  readonly outcomesByIdempotencyKey = new Map<string, ExecutePaymentResult>();
  readonly receiptsById = new Map<string, ReceiptBody>();
  readonly recordCalls: Array<{
    idempotencyKey: string | null;
    result: ExecutePaymentResult;
  }> = [];

  async recordOutcome(input: {
    idempotencyKey: string | null;
    result: ExecutePaymentResult;
  }): Promise<void> {
    this.recordCalls.push(input);
    if (input.idempotencyKey) {
      this.outcomesByIdempotencyKey.set(input.idempotencyKey, input.result);
    }
    if (input.result.receiptBody?.receipt_id) {
      this.receiptsById.set(
        input.result.receiptBody.receipt_id,
        input.result.receiptBody,
      );
    }
  }

  async getOutcomeByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ExecutePaymentResult | null> {
    return this.outcomesByIdempotencyKey.get(idempotencyKey) ?? null;
  }

  async getReceiptById(receiptId: string): Promise<ReceiptBody | null> {
    return this.receiptsById.get(receiptId) ?? null;
  }

  async listReceipts(): Promise<ReceiptBody[]> {
    return Array.from(this.receiptsById.values());
  }
}

type ExecutorBehavior =
  | { type: "ALLOW"; captureId?: string; computedTotalCents?: number }
  | { type: "BLOCK"; reasonCodes?: string[] }
  | { type: "STEP_UP"; reasonCodes?: string[] }
  | { type: "THROW"; error?: Error };

class FakeExecutor {
  readonly calls: any[] = [];
  behavior: ExecutorBehavior = { type: "ALLOW" };

  async execute(input: any): Promise<ExecutePaymentResult> {
    this.calls.push(input);

    if (this.behavior.type === "THROW") {
      throw (
        this.behavior.error ??
        new Error("Executor internal failure: LEAK_SECRET_KEY=secret_val_123")
      );
    }

    if (this.behavior.type === "ALLOW") {
      const computedTotal = this.behavior.computedTotalCents ?? 7000;
      const captureId = this.behavior.captureId ?? "paypal_capture_001";
      return {
        decision: {
          verdict: "ALLOW",
          reason_codes: [],
          computed_total_cents: computedTotal,
        },
        pspResult: {
          status: "CAPTURED",
          tier: "B",
          capture_id: captureId,
          order_id: input.payment?.merchant_order_ref ?? "ord_001",
          money_moved_cents: computedTotal,
        },
        receiptBody: {
          receipt_id: input.receipt_id ?? "rcpt_001",
          payment_id: input.payment?.id ?? "pay_001",
          contract_id: input.payment?.contract_id ?? "ct_001",
          merchant_id: input.payment?.merchant_id ?? "merchant_trailgear",
          order_id: input.payment?.merchant_order_ref ?? "ord_001",
          capture_id: captureId,
          verdict: "ALLOW",
          reason_codes: [],
          computed_total_cents: computedTotal,
          money_moved_cents: computedTotal,
          psp_tier: "B",
        },
      };
    }

    if (this.behavior.type === "BLOCK") {
      const reasons = this.behavior.reasonCodes ?? ["TOTAL_MISMATCH"];
      return {
        decision: {
          verdict: "BLOCK",
          reason_codes: reasons,
          computed_total_cents: 7000,
        },
        pspResult: {
          status: "NOT_CHARGED",
          tier: "B",
          capture_id: null,
          order_id: null,
          money_moved_cents: 0,
        },
        receiptBody: {
          receipt_id: input.receipt_id ?? "rcpt_block_001",
          payment_id: input.payment?.id ?? "pay_001",
          contract_id: input.payment?.contract_id ?? "ct_001",
          merchant_id: input.payment?.merchant_id ?? "merchant_trailgear",
          order_id: input.payment?.merchant_order_ref ?? "ord_001",
          capture_id: null,
          verdict: "BLOCK",
          reason_codes: reasons,
          computed_total_cents: 7000,
          money_moved_cents: 0,
          psp_tier: "B",
        },
      };
    }

    // STEP_UP
    const reasons = this.behavior.reasonCodes ?? [
      "LINE_FROM_UNTRUSTED_CONTENT",
    ];
    return {
      decision: {
        verdict: "STEP_UP",
        reason_codes: reasons,
        computed_total_cents: 7000,
      },
      pspResult: {
        status: "NOT_CHARGED",
        tier: "B",
        capture_id: null,
        order_id: null,
        money_moved_cents: 0,
      },
      receiptBody: {
        receipt_id: input.receipt_id ?? "rcpt_stepup_001",
        payment_id: input.payment?.id ?? "pay_001",
        contract_id: input.payment?.contract_id ?? "ct_001",
        merchant_id: input.payment?.merchant_id ?? "merchant_trailgear",
        order_id: input.payment?.merchant_order_ref ?? "ord_001",
        capture_id: null,
        verdict: "STEP_UP",
        reason_codes: reasons,
        computed_total_cents: 7000,
        money_moved_cents: 0,
        psp_tier: "B",
      },
    };
  }
}

function makeValidPayment(overrides: any = {}) {
  return {
    id: "pay_valid_001",
    contract_id: "ct_valid_001",
    idempotency_key: "idem_valid_001",
    merchant_id: "merchant_trailgear",
    merchant_order_ref: "ord_valid_001",
    items: [
      {
        sku: "JK-101",
        qty: 1,
        unit_price_cents: 7000,
      },
    ],
    proposed_total_cents: 7000,
    spans: [],
    ...overrides,
  };
}

function makeValidContract(overrides: any = {}) {
  return {
    status: "ACTIVE",
    budget_max_cents: 100_000,
    per_order_cap_cents: 100_000,
    allowed_payee_ids: ["merchant_trailgear"],
    blocked_categories: ["gift_card"],
    ...overrides,
  };
}

describe("Part B - Recourse Gateway HTTP Server", () => {
  let server: http.Server;
  let baseUrl: string;
  let fakeExecutor: FakeExecutor;
  let fakeStore: InMemoryReceiptStore;

  beforeEach(async () => {
    fakeExecutor = new FakeExecutor();
    fakeStore = new InMemoryReceiptStore();

    const deps: GatewayDeps = {
      executor: (input) => fakeExecutor.execute(input),
      receipts: fakeStore,
    };

    server = createGatewayServer(deps);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = server.address() as net.AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    if (server && server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  // Test 1: GET /health -> 200, fake executor never called
  it("1. GET /health -> 200, fake executor never called", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBeDefined();

    const data = await res.json();
    expect(data).toEqual({ status: "ok" });
    expect(fakeExecutor.calls).toHaveLength(0);
  });

  // Test 2: ALLOW -> 200, executor called exactly once, recordOutcome called exactly once, body contains decision/receipt
  it("2. ALLOW -> 200, executor called once, recordOutcome called once, body contains decision/receipt", async () => {
    fakeExecutor.behavior = { type: "ALLOW", captureId: "cap_allow_001" };

    const body = {
      contract: makeValidContract(),
      payment: makeValidPayment(),
      spent_cents: 0,
      receipt_id: "rcpt_flow_001",
    };

    const res = await fetch(`${baseUrl}/v1/payments/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBeDefined();

    const data = await res.json();
    expect(data.decision.verdict).toBe("ALLOW");
    expect(data.pspResult.status).toBe("CAPTURED");
    expect(data.pspResult.capture_id).toBe("cap_allow_001");
    expect(data.receiptBody.capture_id).toBe("cap_allow_001");

    expect(fakeExecutor.calls).toHaveLength(1);
    expect(fakeStore.recordCalls).toHaveLength(1);
    expect(fakeStore.recordCalls[0].idempotencyKey).toBe("idem_valid_001");
  });

  // Test 3: BLOCK -> 422 with the ReasonCode passed through unchanged
  it("3. BLOCK -> 422 with the ReasonCode passed through unchanged", async () => {
    fakeExecutor.behavior = {
      type: "BLOCK",
      reasonCodes: ["TOTAL_MISMATCH"],
    };

    const body = {
      contract: makeValidContract(),
      payment: makeValidPayment({ proposed_total_cents: 1000 }),
    };

    const res = await fetch(`${baseUrl}/v1/payments/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(422);
    const data = await res.json();

    // Normal processed response, not error envelope
    expect(data.error).toBeUndefined();
    expect(data.decision.verdict).toBe("BLOCK");
    expect(data.decision.reason_codes).toEqual(["TOTAL_MISMATCH"]);
    expect(data.pspResult.money_moved_cents).toBe(0);
    expect(data.pspResult.capture_id).toBeNull();
    expect(fakeExecutor.calls).toHaveLength(1);
    expect(fakeStore.recordCalls).toHaveLength(1);
  });

  // Test 4: STEP_UP -> 202
  it("4. STEP_UP -> 202", async () => {
    fakeExecutor.behavior = {
      type: "STEP_UP",
      reasonCodes: ["LINE_FROM_UNTRUSTED_CONTENT"],
    };

    const body = {
      contract: makeValidContract(),
      payment: makeValidPayment(),
    };

    const res = await fetch(`${baseUrl}/v1/payments/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(202);
    const data = await res.json();

    expect(data.error).toBeUndefined();
    expect(data.decision.verdict).toBe("STEP_UP");
    expect(data.decision.reason_codes).toEqual([
      "LINE_FROM_UNTRUSTED_CONTENT",
    ]);
    expect(data.pspResult.money_moved_cents).toBe(0);
    expect(fakeExecutor.calls).toHaveLength(1);
  });

  // Test 5: Malformed JSON -> 400, executor not called
  it("5. Malformed JSON -> 400, executor not called", async () => {
    const res = await fetch(`${baseUrl}/v1/payments/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "this is { not valid json",
    });

    expect(res.status).toBe(400);
    const data = await res.json();

    expect(data.error.code).toBe("BAD_JSON");
    expect(data.error.request_id).toBeDefined();
    expect(fakeExecutor.calls).toHaveLength(0);
  });

  // Test 6: Schema-invalid body -> 400, executor not called, payload not echoed
  it("6. Schema-invalid body -> 400, executor not called, payload not echoed", async () => {
    const secretLeakString = "SECRET_PAYLOAD_LEAK_TOKEN_XYZ";
    const invalidBody = {
      contract: "not-an-object",
      payment: {
        id: "pay_1",
        secret_leak: secretLeakString,
      },
    };

    const res = await fetch(`${baseUrl}/v1/payments/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invalidBody),
    });

    expect(res.status).toBe(400);
    const rawText = await res.text();
    const data = JSON.parse(rawText);

    expect(data.error.code).toBe("VALIDATION_FAILED");
    expect(data.error.issues).toBeDefined();
    expect(Array.isArray(data.error.issues)).toBe(true);
    // Payload must NOT be echoed
    expect(rawText).not.toContain(secretLeakString);
    expect(fakeExecutor.calls).toHaveLength(0);
  });

  // Test 7: Same idempotency key posted twice -> second response is replay (header present), executor call count stays 1
  it("7. Same idempotency key posted twice -> replay header present, executor call count stays 1", async () => {
    const body = {
      contract: makeValidContract(),
      payment: makeValidPayment({ idempotency_key: "idem_dedup_999" }),
    };

    // First POST
    const res1 = await fetch(`${baseUrl}/v1/payments/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res1.status).toBe(200);
    expect(res1.headers.get("idempotent-replay")).toBeNull();
    expect(fakeExecutor.calls).toHaveLength(1);

    // Second POST with identical idempotency key
    const res2 = await fetch(`${baseUrl}/v1/payments/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res2.status).toBe(200);
    expect(res2.headers.get("idempotent-replay")).toBe("true");

    const data2 = await res2.json();
    expect(data2.decision.verdict).toBe("ALLOW");
    // Executor was NOT called a second time
    expect(fakeExecutor.calls).toHaveLength(1);
  });

  // Test 8: GET /v1/receipts/:id -> 200 for stored receipt, 404 for unknown ID
  it("8. GET /v1/receipts/:id -> 200 for stored receipt, 404 for unknown ID", async () => {
    const storedReceipt: ReceiptBody = {
      receipt_id: "rcpt_known_123",
      payment_id: "pay_123",
      contract_id: "ct_123",
      merchant_id: "merchant_trailgear",
      order_id: "ord_123",
      capture_id: "cap_123",
      verdict: "ALLOW",
      reason_codes: [],
      computed_total_cents: 7000,
      money_moved_cents: 7000,
      psp_tier: "B",
    };
    fakeStore.receiptsById.set("rcpt_known_123", storedReceipt);

    // Found
    const resFound = await fetch(`${baseUrl}/v1/receipts/rcpt_known_123`);
    expect(resFound.status).toBe(200);
    const dataFound = await resFound.json();
    expect(dataFound.receipt_id).toBe("rcpt_known_123");
    expect(dataFound.capture_id).toBe("cap_123");

    // Not found
    const resNotFound = await fetch(`${baseUrl}/v1/receipts/rcpt_unknown_999`);
    expect(resNotFound.status).toBe(404);
    const dataNotFound = await resNotFound.json();
    expect(dataNotFound.error.code).toBe("NOT_FOUND");
    expect(dataNotFound.error.message).toContain("rcpt_unknown_999");
  });

  // Test 9: Unknown route -> 404; GET /v1/payments/execute -> 405
  it("9. Unknown route -> 404; GET /v1/payments/execute -> 405", async () => {
    // Unknown route
    const resNotFound = await fetch(`${baseUrl}/unknown/route/path`);
    expect(resNotFound.status).toBe(404);
    const dataNotFound = await resNotFound.json();
    expect(dataNotFound.error.code).toBe("NOT_FOUND");

    // Method not allowed on known route
    const resMethodNotAllowed = await fetch(
      `${baseUrl}/v1/payments/execute`,
      { method: "GET" },
    );
    expect(resMethodNotAllowed.status).toBe(405);
    const dataMethod = await resMethodNotAllowed.json();
    expect(dataMethod.error.code).toBe("METHOD_NOT_ALLOWED");

    // Method not allowed on /health
    const resHealthPost = await fetch(`${baseUrl}/health`, {
      method: "POST",
    });
    expect(resHealthPost.status).toBe(405);
    const dataHealth = await resHealthPost.json();
    expect(dataHealth.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  // Test 10: Body over 1 MiB -> 413, executor not called
  it("10. Body over 1 MiB -> 413, executor not called", async () => {
    // 1 MiB + 100 bytes of padding
    const largePadding = "x".repeat(1024 * 1024 + 100);
    const largeBody = JSON.stringify({
      contract: makeValidContract(),
      payment: makeValidPayment(),
      padding: largePadding,
    });

    const res = await fetch(`${baseUrl}/v1/payments/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: largeBody,
    });

    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(fakeExecutor.calls).toHaveLength(0);
  });

  // Test 11: Executor throws -> 500 INTERNAL, response contains no stack/process.env, executor called once
  it("11. Executor throws -> 500 INTERNAL, response contains no stack/env leak, called once", async () => {
    fakeExecutor.behavior = {
      type: "THROW",
      error: new Error(
        "CRITICAL LEAK: DB_PASSWORD=supersecret! ENV_VAR=prod_val",
      ),
    };

    const res = await fetch(`${baseUrl}/v1/payments/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contract: makeValidContract(),
        payment: makeValidPayment(),
      }),
    });

    expect(res.status).toBe(500);
    const rawText = await res.text();
    const data = JSON.parse(rawText);

    expect(data.error.code).toBe("INTERNAL");
    expect(data.error.message).toBe("Internal payment execution error");
    expect(rawText).not.toContain("CRITICAL LEAK");
    expect(rawText).not.toContain("supersecret");
    expect(rawText).not.toContain("ENV_VAR");
    expect(rawText).not.toContain("at "); // No stack trace traces

    expect(fakeExecutor.calls).toHaveLength(1);
  });

  // Test 12: Boundary test verifying packages/gateway/src imports nothing from PSP and references no PayPal credentials
  it("12. Boundary check: packages/gateway/src imports nothing from PSP and has zero PayPal credentials", () => {
    const srcDir = path.resolve(__dirname, "../src");
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts"));

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = fs.readFileSync(path.join(srcDir, file), "utf-8");

      // No imports from psp
      expect(content).not.toMatch(/from\s+["'].*psp.*["']/i);
      expect(content).not.toMatch(/import\s+.*from\s+.*psp/i);

      // No secrets or PayPal credentials
      expect(content).not.toContain("PAYPAL_CLIENT_ID");
      expect(content).not.toContain("PAYPAL_CLIENT_SECRET");
      expect(content).not.toContain("PAYPAL_VAULT_ID");
      expect(content).not.toContain("process.env");
    }
  });

  // Additional check: Content-Type enforcement
  it("rejects non-JSON Content-Type with 415 UNSUPPORTED_MEDIA_TYPE", async () => {
    const res = await fetch(`${baseUrl}/v1/payments/execute`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "plain text",
    });

    expect(res.status).toBe(415);
    const data = await res.json();
    expect(data.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(fakeExecutor.calls).toHaveLength(0);
  });
});

