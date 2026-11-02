import type {
  PayPalVaultClient,
  VaultChargeRequest,
  VaultChargeResponse,
} from "./vault-client.js";

export class PayPalApiError extends Error {
  public readonly status: number;
  public readonly paypalErrorName: string;

  constructor(status: number, paypalErrorName: string, message?: string) {
    super(message || `PayPal API Error [${status}]: ${paypalErrorName}`);
    this.name = "PayPalApiError";
    this.status = status;
    this.paypalErrorName = paypalErrorName;
  }
}

/**
 * Converts integer cents to PayPal decimal amount string using pure integer math.
 * Examples: 7000 -> "70.00", 5 -> "0.05", 100000 -> "1000.00"
 * Throws on negative, non-integer, or non-finite values.
 */
export function formatCentsToAmountString(cents: number): string {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error(`Invalid amount_cents: ${cents}. Must be a positive integer.`);
  }

  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  const remainderStr = remainder < 10 ? `0${remainder}` : `${remainder}`;

  return `${dollars}.${remainderStr}`;
}

/**
 * Converts PayPal decimal amount string back to integer cents.
 * Example: "70.00" -> 7000, "0.05" -> 5
 */
export function parseAmountStringToCents(amountStr: string): number {
  const parts = amountStr.split(".");
  const dollars = parseInt(parts[0], 10);
  const centsPart = (parts[1] || "00").padEnd(2, "0").slice(0, 2);
  const cents = parseInt(centsPart, 10);

  if (isNaN(dollars) || isNaN(cents)) {
    throw new Error(`Invalid amount string: ${amountStr}`);
  }

  return dollars * 100 + cents;
}

export interface LivePayPalClientConfig {
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

export class LivePayPalVaultClient implements PayPalVaultClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private cachedToken: CachedToken | null = null;

  constructor(config: LivePayPalClientConfig = {}) {
    this.clientId =
      config.clientId !== undefined
        ? config.clientId
        : process.env.PAYPAL_CLIENT_ID || "";
    this.clientSecret =
      config.clientSecret !== undefined
        ? config.clientSecret
        : process.env.PAYPAL_CLIENT_SECRET || "";

    const env = process.env.PAYPAL_ENV || "sandbox";
    this.baseUrl =
      config.baseUrl ||
      (env === "production"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com");
  }

  /**
   * Fetches or returns cached OAuth access token.
   * Caches token until 60 seconds before expiration.
   */
  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAtMs) {
      return this.cachedToken.token;
    }

    if (!this.clientId || !this.clientSecret) {
      throw new PayPalApiError(
        401,
        "MISSING_CREDENTIALS",
        "PayPal client credentials are not configured",
      );
    }

    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");

    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorName = data.error || data.name || "AUTHENTICATION_FAILURE";
      throw new PayPalApiError(response.status, errorName, "Failed to authenticate with PayPal");
    }

    const expiresInSeconds = typeof data.expires_in === "number" ? data.expires_in : 3600;
    // Cache with a 60-second safety window
    this.cachedToken = {
      token: data.access_token,
      expiresAtMs: Date.now() + Math.max(expiresInSeconds - 60, 60) * 1000,
    };

    return this.cachedToken.token;
  }

  /**
   * Executes an unattended charge on a vaulted buyer.
   */
  async chargeVaultedBuyer(req: VaultChargeRequest): Promise<VaultChargeResponse> {
    const amountStr = formatCentsToAmountString(req.amount_cents);
    const token = await this.getAccessToken();

    const response = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": req.idempotency_key,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        payment_source: {
          paypal: {
            vault_id: req.vault_id,
          },
        },
        purchase_units: [
          {
            custom_id: req.receipt_id,
            amount: {
              currency_code: req.currency,
              value: amountStr,
            },
          },
        ],
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorName = data.name || data.error || "CHARGE_FAILED";
      throw new PayPalApiError(
        response.status,
        errorName,
        `PayPal charge failed with status ${response.status}`,
      );
    }

    const purchaseUnit = data.purchase_units?.[0];
    const capture = purchaseUnit?.payments?.captures?.[0];

    if (!capture || capture.status !== "COMPLETED" || !capture.id) {
      throw new PayPalApiError(
        422,
        "UNEXPECTED_CAPTURE_STATUS",
        `Order was not captured as COMPLETED (capture status: ${capture?.status || "NONE"})`,
      );
    }

    const chargedCents = parseAmountStringToCents(capture.amount?.value || "0.00");

    if (chargedCents !== req.amount_cents) {
      throw new PayPalApiError(
        422,
        "AMOUNT_MISMATCH",
        `Charged amount ${chargedCents} does not match requested ${req.amount_cents}`,
      );
    }

    return {
      capture_id: capture.id,
      status: "COMPLETED",
      charged_cents: chargedCents,
    };
  }

  /**
   * Independently retrieves capture details to verify amount and status.
   */
  async getCapture(captureId: string): Promise<{
    id: string;
    status: string;
    amount_cents: number;
    currency: string;
  }> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.baseUrl}/v2/payments/captures/${captureId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorName = data.name || data.error || "GET_CAPTURE_FAILED";
      throw new PayPalApiError(response.status, errorName);
    }

    const amountCents = parseAmountStringToCents(data.amount?.value || "0.00");

    return {
      id: data.id,
      status: data.status,
      amount_cents: amountCents,
      currency: data.amount?.currency_code || "USD",
    };
  }
}
