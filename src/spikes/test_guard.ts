import "dotenv/config";
import { PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
import { ALL_TOOLS_ENABLED } from "@paypal/agent-toolkit/ai-sdk";
import { getAccessToken } from "./get_token.js";
import { RecourseGuard } from "./guard.js";

async function main() {
  const accessToken = await getAccessToken();

  const toolkit = new PayPalMCPToolkit({
    accessToken,
    configuration: {
      actions: ALL_TOOLS_ENABLED,
      context: { sandbox: true },
    },
  });

  const guard = new RecourseGuard(toolkit.getPaypalAPIService(), { maxAmountUSD: 5.0 });

  // Test 1: $10 order must be blocked without contacting PayPal
  const t1 = await guard.createOrder({ itemName: "Jacket", amount: 10.0 });
  if (t1.status !== "BLOCKED" || t1.paypal_contacted !== false) {
    throw new Error("Test 1 Failed: $10 order was not blocked properly");
  }

  // Test 2: $3 order must be allowed and forwarded to PayPal
  const t2 = await guard.createOrder({ itemName: "Mug", amount: 3.0 });
  if (t2.status !== "ALLOWED" || t2.paypal_contacted !== true || !t2.order?.id) {
    throw new Error("Test 2 Failed: $3 order was not approved");
  }

  // Test 3: Negative amount must be rejected safely
  const t3 = await guard.createOrder({ itemName: "Invalid", amount: -5.0 });
  if (t3.status !== "BLOCKED" || t3.paypal_contacted !== false) {
    throw new Error("Test 3 Failed: Negative amount was not rejected");
  }

  // Test 4: $5 exact limit must be allowed
  const t4 = await guard.createOrder({ itemName: "AtLimit", amount: 5.0 });
  if (t4.status !== "ALLOWED" || t4.paypal_contacted !== true) {
    throw new Error("Test 4 Failed: $5 boundary amount was not allowed");
  }

  console.log("Recourse Guard Tests: 4/4 passed (all policies verified)");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
