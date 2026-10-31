// src/spikes/setup_vault.ts
// Step 1 of Vault: Generate the one-time approval link to get a vault_id
import "dotenv/config";
import { createSetupToken, createPaymentToken } from "../services/paypal.service.js";

async function main() {
  const arg = process.argv[2];

  if (arg) {
    // If the user passes setupTokenId as argument: npx tsx src/spikes/setup_vault.ts <setupTokenId>
    console.log(`Exchanging setup token "${arg}" for permanent vault_id...`);
    const paymentToken = await createPaymentToken(arg);
    console.log("\n🎉 VAULT ID CREATED SUCCESSFULLY!");
    console.log(`VAULT_ID: ${paymentToken.id}`);
    console.log("\nAdd this to your .env file:");
    console.log(`PAYPAL_VAULT_ID=${paymentToken.id}`);
    return;
  }

  console.log("══════════════════════════════════════════════════════════");
  console.log(" 🔑 ONE-TIME VAULT SETUP (Delegated Payment Authority)");
  console.log("══════════════════════════════════════════════════════════\n");

  console.log("Requesting Setup Token from PayPal Vault API...");
  const setup = await createSetupToken();

  console.log(`\n✅ Setup Token ID: ${setup.setupTokenId}`);
  console.log("\n👉 OPEN THIS URL IN INCOGNITO BROWSER TO APPROVE ONCE:");
  console.log(setup.approvalUrl);
  console.log("\nLog in with fake buyer:");
  console.log(`Email:    ${process.env.PAYPAL_BUYER_EMAIL}`);
  console.log(`Password: ${process.env.PAYPAL_BUYER_PASSWORD}`);
  console.log("Click 'Agree & Continue' or 'Approve'.");
  console.log("\nAfter clicking Approve in browser, run this command to get your vault_id:");
  console.log(`npx tsx src/spikes/setup_vault.ts ${setup.setupTokenId}\n`);
}

main().catch((err) => {
  console.error("Setup failed:", err);
});

