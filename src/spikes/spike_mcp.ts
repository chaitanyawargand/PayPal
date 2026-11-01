import "dotenv/config";
import { PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
import { ALL_TOOLS_ENABLED } from "@paypal/agent-toolkit/ai-sdk";
import { getAccessToken } from "./get_token.js";

async function main() {
  const accessToken = await getAccessToken();

  const toolkit = new PayPalMCPToolkit({
    accessToken,
    configuration: {
      actions: ALL_TOOLS_ENABLED,
      context: { sandbox: true },
    },
  });

  const api = toolkit.getPaypalAPIService();

  const createResult = await api.run("create_order", {
    currencyCode: "USD" as const,
    items: [
      {
        name: "Recourse Leather Jacket",
        quantity: 1,
        itemCost: 10.0,
        taxPercent: 0,
        itemTotal: 10.0,
      },
    ],
  });

  const orderData = typeof createResult === "string" ? JSON.parse(createResult) : createResult;

  const getResult = await api.run("get_order", { id: orderData.id });
  const verifiedOrder = typeof getResult === "string" ? JSON.parse(getResult) : getResult;

  console.log(`Order ID: ${verifiedOrder.id}`);
  console.log(`Status: ${verifiedOrder.status}`);
}

main().catch((err) => {
  console.error("Spike B execution failed:", err.message || err);
  process.exit(1);
});
