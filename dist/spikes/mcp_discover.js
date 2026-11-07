import "dotenv/config";
import { PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
import { ALL_TOOLS_ENABLED } from "@paypal/agent-toolkit/ai-sdk";
export function discoverMcpTools() {
    const toolkit = new PayPalMCPToolkit({
        accessToken: "discovery_mode",
        configuration: {
            actions: ALL_TOOLS_ENABLED,
            context: { sandbox: true },
        },
    });
    return toolkit.getTools().map((t) => t.method);
}
const tools = discoverMcpTools();
console.log(`Discovered ${tools.length} MCP tools:`);
console.log(tools.join(", "));
//# sourceMappingURL=mcp_discover.js.map