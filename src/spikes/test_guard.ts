// src/spikes/test_guard.ts
// Spike B Step 3: THE MOST IMPORTANT TEST
// Proves the Recourse Guard blocks $10 before PayPal ever sees it,
// while allowing valid purchases under the threshold ($3).
import "dotenv/config";
import { PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
import { ALL_TOOLS_ENABLED } from "@paypal/agent-toolkit/ai-sdk";
import { RecourseGuard } from "./guard.js";

const clientId = process.env.PAYPAL_CLIENT_ID!;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET!;
const baseUrl = process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com";

async function getAccessToken(): Promise<string> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data.access_token;
}

async function main() {
  console.log("══════════════════════════════════════════════════════════");
  console.log(" 🛡️  SPIKE B STEP 3: RECOURSE GUARD VERIFICATION");
  console.log("══════════════════════════════════════════════════════════\n");

  console.log("1. Authenticating with PayPal Sandbox...");
  const accessToken = await getAccessToken();
  console.log("✅ Authenticated with PayPal Sandbox\n");

  console.log("2. Initializing PayPal MCP Toolkit...");
  const toolkit = new PayPalMCPToolkit({
    accessToken,
    configuration: {
      actions: ALL_TOOLS_ENABLED,
      context: { sandbox: true },
    },
  });

  const api = toolkit.getPaypalAPIService();

  // Instantiate Recourse Guard with policy limit: $5.00
  const guard = new RecourseGuard(api, { maxAmountUSD: 5.0 });
  console.log("🛡️  Recourse Guard activated with POLICY LIMIT = $5.00 USD\n");

  let passed = 0;
  let total = 0;

  // ─── TEST 1: Agent attempts unauthorized $10.00 purchase ───
  total++;
  console.log("──────────────────────────────────────────────────────────");
  console.log("🧪 TEST 1: Agent attempts to purchase $10.00 Jacket");
  console.log("   Expected: BLOCKED, paypal_contacted: false");
  console.log("──────────────────────────────────────────────────────────");

  const test1 = await guard.createOrder({
    itemName: "Autonomous Jacket",
    amount: 10.0,
    description: "Agent purchase without human approval",
  });

  console.log("Guard Output:", JSON.stringify(test1, null, 2));

  if (test1.status === "BLOCKED" && test1.paypal_contacted === false) {
    console.log("✅ PASS: Guard stopped the $10.00 call BEFORE PayPal saw it!");
    passed++;
  } else {
    console.error("❌ FAIL: Guard allowed or leaked the request!");
  }

  // ─── TEST 2: Agent attempts permitted $3.00 purchase ───
  total++;
  console.log("\n──────────────────────────────────────────────────────────");
  console.log("🧪 TEST 2: Agent attempts to purchase $3.00 Coffee Mug");
  console.log("   Expected: ALLOWED, paypal_contacted: true");
  console.log("──────────────────────────────────────────────────────────");

  const test2 = await guard.createOrder({
    itemName: "Coffee Mug",
    amount: 3.0,
    description: "Allowed small purchase",
  });

  console.log("Guard Output:", JSON.stringify(test2, null, 2));

  if (test2.status === "ALLOWED" && test2.paypal_contacted === true && test2.order?.id) {
    console.log(`✅ PASS: Guard allowed $3.00 call. PayPal Order ID: ${test2.order.id}`);
    passed++;
  } else {
    console.error("❌ FAIL: Permitted order was not completed!");
  }

  // ─── TEST 3: Negative amount input validation ───
  total++;
  console.log("\n──────────────────────────────────────────────────────────");
  console.log("🧪 TEST 3: Malicious Agent attempts negative amount -$10.00");
  console.log("   Expected: BLOCKED, paypal_contacted: false");
  console.log("──────────────────────────────────────────────────────────");

  const test3 = await guard.createOrder({
    itemName: "Exploit Attempt",
    amount: -10.0,
  });

  console.log("Guard Output:", JSON.stringify(test3, null, 2));

  if (test3.status === "BLOCKED" && test3.paypal_contacted === false) {
    console.log("✅ PASS: Guard rejected invalid negative amount safely.");
    passed++;
  } else {
    console.error("❌ FAIL: Guard did not block negative amount!");
  }

  // ─── SUMMARY ───
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(` 📊 GUARD RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log("══════════════════════════════════════════════════════════");

  if (passed === total) {
    console.log("🎉 SUCCESS: Recourse Guard proved functional!");
    console.log("   - Intercepts calls locally before network transfer");
    console.log("   - Zero PayPal ledger footprint on blocked transactions");
  } else {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Test crashed:", err);
  process.exit(1);
});

