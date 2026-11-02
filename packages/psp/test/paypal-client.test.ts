import "dotenv/config";
import { describe, it, expect } from "vitest";
import {
  formatCentsToAmountString,
  parseAmountStringToCents,
  LivePayPalVaultClient,
  PayPalApiError,
} from "../src/paypal-client.js";

describe("LivePayPalVaultClient - Unit Tests", () => {
  describe("formatCentsToAmountString (pure integer arithmetic)", () => {
    it("converts standard amounts accurately", () => {
      expect(formatCentsToAmountString(7000)).toBe("70.00");
      expect(formatCentsToAmountString(5)).toBe("0.05");
      expect(formatCentsToAmountString(100000)).toBe("1000.00");
      expect(formatCentsToAmountString(1)).toBe("0.01");
      expect(formatCentsToAmountString(99)).toBe("0.99");
      expect(formatCentsToAmountString(105)).toBe("1.05");
      expect(formatCentsToAmountString(5000)).toBe("50.00");
    });

    it("rejects non-integer, zero, and negative cents", () => {
      expect(() => formatCentsToAmountString(0)).toThrow(/positive integer/);
      expect(() => formatCentsToAmountString(-50)).toThrow(/positive integer/);
      expect(() => formatCentsToAmountString(12.5)).toThrow(/positive integer/);
      expect(() => formatCentsToAmountString(NaN)).toThrow(/positive integer/);
    });
  });

  describe("parseAmountStringToCents", () => {
    it("parses decimal strings to integer cents accurately", () => {
      expect(parseAmountStringToCents("70.00")).toBe(7000);
      expect(parseAmountStringToCents("0.05")).toBe(5);
      expect(parseAmountStringToCents("1000.00")).toBe(100000);
      expect(parseAmountStringToCents("1.05")).toBe(105);
    });
  });

  describe("Missing-env safety check", () => {
    it("throws typed PayPalApiError when credentials are missing", async () => {
      const unconfiguredClient = new LivePayPalVaultClient({
        clientId: "",
        clientSecret: "",
      });

      await expect(unconfiguredClient.getAccessToken()).rejects.toThrow(PayPalApiError);
      try {
        await unconfiguredClient.getAccessToken();
      } catch (err: any) {
        expect(err.status).toBe(401);
        expect(err.paypalErrorName).toBe("MISSING_CREDENTIALS");
      }
    });
  });
});

// Live integration suite: only runs when RUN_PAYPAL_LIVE=1 AND credentials exist.
// Keeps standard `npx vitest run` 100% green on CI/machines without secrets.
const shouldRunLive = Boolean(
  process.env.RUN_PAYPAL_LIVE === "1" &&
    process.env.PAYPAL_CLIENT_ID &&
    process.env.PAYPAL_CLIENT_SECRET &&
    process.env.PAYPAL_VAULT_ID,
);

describe.runIf(shouldRunLive)("LivePayPalVaultClient - Sandbox Live Suite", () => {
  const client = new LivePayPalVaultClient();
  const vaultId = process.env.PAYPAL_VAULT_ID!;

  it("1. Token fetch succeeds and caches properly", async () => {
    const token1 = await client.getAccessToken();
    expect(typeof token1).toBe("string");
    expect(token1.length).toBeGreaterThan(10);

    const token2 = await client.getAccessToken();
    expect(token2).toBe(token1); // Confirms cached token reuse
  });

  it("2. One live charge captures with status COMPLETED and matching amount", async () => {
    const idempotencyKey = `idem_live_${Date.now()}`;
    const receiptId = `rcpt_live_${Date.now()}`;

    const res = await client.chargeVaultedBuyer({
      amount_cents: 7000,
      currency: "USD",
      vault_id: vaultId,
      idempotency_key: idempotencyKey,
      receipt_id: receiptId,
    });

    expect(res.status).toBe("COMPLETED");
    expect(res.capture_id).toBeDefined();
    expect(typeof res.capture_id).toBe("string");
    expect(res.capture_id.length).toBeGreaterThan(5);
    expect(res.charged_cents).toBe(7000);

    const iso = new Date().toISOString();
    const last4 = vaultId.slice(-4);
    console.log(`\nEVIDENCE DELIVERABLE:\n${iso} / sandbox / ${res.charged_cents} / ${res.capture_id} / ${res.status} / ...${last4}\n`);

    // Follow-up GET confirms independently
    const verified = await client.getCapture(res.capture_id);
    expect(verified.id).toBe(res.capture_id);
    expect(verified.status).toBe("COMPLETED");
    expect(verified.amount_cents).toBe(7000);
  });

  it("3. Follow-up GET on capture independently confirms amount and status", async () => {
    const idempotencyKey = `idem_live_get_${Date.now()}`;
    const receiptId = `rcpt_live_get_${Date.now()}`;

    const chargeRes = await client.chargeVaultedBuyer({
      amount_cents: 500,
      currency: "USD",
      vault_id: vaultId,
      idempotency_key: idempotencyKey,
      receipt_id: receiptId,
    });

    const captureDetails = await client.getCapture(chargeRes.capture_id);
    expect(captureDetails.status).toBe("COMPLETED");
    expect(captureDetails.amount_cents).toBe(500);
    expect(captureDetails.currency).toBe("USD");
  });

  it("4. Invalid vault id throws typed failure with no capture claimed", async () => {
    const idempotencyKey = `idem_live_fail_${Date.now()}`;

    await expect(
      client.chargeVaultedBuyer({
        amount_cents: 500,
        currency: "USD",
        vault_id: "INVALID_VAULT_ID_9999",
        idempotency_key: idempotencyKey,
        receipt_id: "rcpt_fail_001",
      }),
    ).rejects.toThrow(PayPalApiError);
  });
});
