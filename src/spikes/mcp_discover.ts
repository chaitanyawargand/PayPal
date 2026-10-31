// src/spikes/mcp_discover.ts
// Spike B Step 1: Discover all MCP tool names from @paypal/agent-toolkit
import "dotenv/config";
import { PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
import { ALL_TOOLS_ENABLED } from "@paypal/agent-toolkit/ai-sdk";

const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
const baseUrl = process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com";

async function main() {
  console.log("══════════════════════════════════════════════════════════");
  console.log(" 🔍 SPIKE B: DISCOVERING PAYPAL MCP TOOLS");
  console.log("══════════════════════════════════════════════════════════\n");

  console.log("1. Initializing PayPal MCP Toolkit with ALL_TOOLS_ENABLED...");

  // Discovering tools does NOT require a network call — the toolkit builds tools locally.
  const toolkit = new PayPalMCPToolkit({
    accessToken: "temporary_discovery_token",
    configuration: {
      actions: ALL_TOOLS_ENABLED,
      context: { sandbox: true },
    },
  });

  const tools = toolkit.getTools();
  console.log(`✅ Successfully loaded ${tools.length} MCP tools!\n`);

  console.log("─".repeat(60));
  for (const tool of tools) {
    console.log(`📦 [${tool.method}] - ${tool.name}`);
    console.log(`   ${tool.description.slice(0, 90)}...`);
  }
  console.log("─".repeat(60));

  console.log("\n📋 Exact MCP Tool Methods (Buttons for AI Agent):");
  const toolMethods = tools.map((t) => t.method);
  console.log(toolMethods.join(", "));

  console.log("\n2. Checking PayPal OAuth Connection...");
  if (!clientId || !clientSecret) {
    console.warn("⚠️  PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET missing in .env");
    return;
  }

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    console.log(`   Connecting to ${baseUrl}/v1/oauth2/token ...`);

    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(" OAuth Error from PayPal:", data);
    } else {
      console.log(`✅ Sandbox OAuth Access Token received! (length: ${data.access_token.length})`);
      console.log(`   Client ID prefix: ${clientId.slice(0, 5)}...`);
    }
  } catch (err: any) {
    console.warn(`⚠️  OAuth network check: ${err.message || err}`);
    console.log("   (Tool discovery succeeded regardless, because tool definitions are local!)");
  }

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" 🎉 SPIKE B STEP 1 COMPLETE: Ready to fill docs/spikes/MCP.md");
  console.log("══════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
});
