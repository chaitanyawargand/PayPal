// src/spikes/spike_mcp.ts
// Spike B Step 2: Agent creates an order through official PayPal MCP toolkit
import "dotenv/config";
import { PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
import { ALL_TOOLS_ENABLED } from "@paypal/agent-toolkit/ai-sdk";

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
  console.log(" 🚀 SPIKE B STEP 2: AGENT CREATES ORDER VIA MCP");
  console.log("══════════════════════════════════════════════════════════\n");

  console.log("1. Authenticating with PayPal Sandbox...");
  const accessToken = await getAccessToken();
  console.log(`✅ Access Token obtained (prefix: ${accessToken.slice(0, 15)}...)`);
  console.log(`   Merchant App Client ID prefix: ${clientId.slice(0, 5)}...\n`);

  console.log("2. Initializing PayPal MCP Toolkit...");
  const toolkit = new PayPalMCPToolkit({
    accessToken,
    configuration: {
      actions: ALL_TOOLS_ENABLED,
      context: { sandbox: true },
    },
  });

  const api = toolkit.getPaypalAPIService();

  console.log("3. Agent presses 'create_order' button for $10.00 jacket...");
  const createOrderPayload = {
    currencyCode: "USD" as const,
    items: [
      {
        name: "Recourse Leather Jacket",
        quantity: 1,
        itemCost: 10.0,
        taxPercent: 0,
        itemTotal: 10.0,
        description: "2 AM Autonomous Agent Test Purchase",
      },
    ],
  };

  const createResult = await api.run("create_order", createOrderPayload);
  const orderData = typeof createResult === "string" ? JSON.parse(createResult) : createResult;

  console.log("\n✅ PayPal Order Created via MCP Toolkit!");
  console.log(`   Order ID: ${orderData.id}`);
  console.log(`   Status:   ${orderData.status}`);
  if (orderData.links) {
    const approveLink = orderData.links.find((l: any) => l.rel === "approve");
    if (approveLink) {
      console.log(`   Buyer Approval URL: ${approveLink.href}`);
    }
  }

  console.log("\n4. Agent presses 'get_order' button to verify state...");
  const getResult = await api.run("get_order", { id: orderData.id });
  const verifiedOrder = typeof getResult === "string" ? JSON.parse(getResult) : getResult;

  console.log(`✅ Order Verified in PayPal:`);
  console.log(`   ID:     ${verifiedOrder.id}`);
  console.log(`   Status: ${verifiedOrder.status}`);
  console.log(`   Gross:  ${verifiedOrder.purchase_units?.[0]?.amount?.value} ${verifiedOrder.purchase_units?.[0]?.amount?.currency_code}`);

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" 📋 RECORD THIS IN docs/spikes/MCP.md:");
  console.log(`   Order ID: ${orderData.id}`);
  console.log(`   Status:   ${orderData.status}`);
  console.log("══════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("❌ Spike B Step 2 failed:", err);
  process.exit(1);
});

