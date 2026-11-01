import "dotenv/config";
import { createSetupToken, createPaymentToken } from "../services/paypal.service.js";

async function main() {
  const setupTokenId = process.argv[2];

  if (setupTokenId) {
    const paymentToken = await createPaymentToken(setupTokenId);
    console.log(`PAYPAL_VAULT_ID=${paymentToken.id}`);
    return;
  }

  const setup = await createSetupToken();
  console.log(`Setup Token ID: ${setup.setupTokenId}`);
  console.log(`Approval URL:   ${setup.approvalUrl}`);
  console.log(`Exchange command: npx tsx src/spikes/setup_vault.ts ${setup.setupTokenId}`);
}

main().catch((err) => {
  console.error("Setup failed:", err.message || err);
  process.exit(1);
});
