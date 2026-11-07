import { randomUUID } from "node:crypto";
import { paypalConfig } from "../config/paypal.js";
const BASE_URL = paypalConfig.baseUrl;
let cachedAccessToken = null;
// 1. Get PayPal OAuth access token
async function getAccessToken() {
    const credentials = Buffer.from(`${paypalConfig.clientId}:${paypalConfig.clientSecret}`).toString("base64");
    const response = await fetch(`${BASE_URL}/v1/oauth2/token`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(JSON.stringify(data));
    }
    cachedAccessToken = data.access_token;
    return cachedAccessToken;
}
// Generic PayPal API helper
async function paypalRequest(path, method = "GET", body) {
    const accessToken = await getAccessToken();
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
    };
    if (method === "POST") {
        headers["PayPal-Request-Id"] = randomUUID();
    }
    const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(JSON.stringify(data, null, 2));
    }
    return data;
}
// STEP 1: Create setup token
export async function createSetupToken() {
    const result = await paypalRequest("/v3/vault/setup-tokens", "POST", {
        payment_source: {
            paypal: {
                description: "Recourse saved payment",
                usage_pattern: "IMMEDIATE",
                usage_type: "MERCHANT",
                customer_type: "CONSUMER",
                experience_context: {
                    brand_name: "Recourse",
                    locale: "en-US",
                    return_url: `${paypalConfig.appUrl}/paypal/return`,
                    cancel_url: `${paypalConfig.appUrl}/paypal/cancel`,
                },
            },
        },
    });
    const approvalLink = result.links.find((link) => link.rel === "approve");
    if (!approvalLink) {
        throw new Error("PayPal approval URL not found");
    }
    return {
        setupTokenId: result.id,
        approvalUrl: approvalLink.href,
    };
}
// STEP 2A: Exchange setup token for payment token
export async function createPaymentToken(setupTokenId) {
    return paypalRequest("/v3/vault/payment-tokens", "POST", {
        payment_source: {
            token: {
                id: setupTokenId,
                type: "SETUP_TOKEN",
            },
        },
    });
}
// STEP 2B: Charge using saved payment token
export async function chargeBuyer(vaultId, receiptId, amount = "10.00") {
    return paypalRequest("/v2/checkout/orders", "POST", {
        intent: "CAPTURE",
        payment_source: {
            paypal: {
                vault_id: vaultId,
            },
        },
        purchase_units: [
            {
                custom_id: receiptId,
                amount: {
                    currency_code: "USD",
                    value: amount,
                },
            },
        ],
    });
}
// STEP 3: Retrieve and verify order
export async function verifyOrder(orderId) {
    const order = await paypalRequest(`/v2/checkout/orders/${orderId}`);
    const purchaseUnit = order.purchase_units?.[0];
    const capture = purchaseUnit?.payments?.captures?.[0];
    return {
        orderId: order.id,
        orderStatus: order.status,
        receiptId: purchaseUnit?.custom_id ?? null,
        captureId: capture?.id ?? null,
        captureStatus: capture?.status ?? null,
        verified: purchaseUnit?.custom_id === "receipt-001" &&
            capture?.status === "COMPLETED" &&
            Boolean(capture?.id),
    };
}
//# sourceMappingURL=paypal.service.js.map