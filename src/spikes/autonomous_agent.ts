// src/spikes/autonomous_agent.ts
// RECOURSE AUTONOMOUS PAYMENT PIPELINE
// Combines Spike A (Vault Pre-authorization) with Spike B (Recourse Guard Policy Engine)
// Result: 100% Unattended, Zero-Click Payment with Strict Guardrails
import "dotenv/config";
import { chargeBuyer, verifyOrder } from "../services/paypal.service.js";

const vaultId = process.env.PAYPAL_VAULT_ID?.trim();

interface AutonomousPurchaseRequest {
  itemName: string;
  amount: string;
  receiptId: string;
}

export class AutonomousAgentGuard {
  private vaultId: string;
  private maxAmountUSD: number;

  constructor(vaultId: string, maxAmountUSD = 5.0) {
    this.vaultId = vaultId;
    this.maxAmountUSD = maxAmountUSD;
  }

  async executeAutonomousPurchase(req: AutonomousPurchaseRequest) {
    const amountNum = parseFloat(req.amount);

    console.log(`\n🤖 Agent Request: Purchase "${req.itemName}" for $${req.amount} USD (Receipt: ${req.receiptId})`);

    // 🛡️ RECOURSE GUARD POLICY CHECK
    if (isNaN(amountNum) || amountNum <= 0) {
      console.log(`❌ GUARD DECISION: REJECTED (Invalid amount: $${req.amount})`);
      return { status: "BLOCKED", reason: "Invalid amount", paypal_contacted: false };
    }

    if (amountNum > this.maxAmountUSD) {
      console.log(`❌ GUARD DECISION: BLOCKED!`);
      console.log(`   Policy violation: $${amountNum.toFixed(2)} exceeds agent spending limit of $${this.maxAmountUSD.toFixed(2)}`);
      console.log(`   PayPal Contacted: NO (0 bytes sent to payment gateway)`);
      return {
        status: "BLOCKED",
        reason: `Exceeds spending limit ($${amountNum.toFixed(2)} > $${this.maxAmountUSD.toFixed(2)})`,
        paypal_contacted: false,
      };
    }

    // ✅ POLICY APPROVED -> EXECUTE AUTONOMOUS VAULT CHARGE (Zero human clicks)
    console.log(`✅ GUARD DECISION: APPROVED ($${amountNum.toFixed(2)} <= $${this.maxAmountUSD.toFixed(2)})`);
    console.log(`⚡ Initiating Unattended Autonomous PayPal Vault Charge using token ${this.vaultId.slice(0, 8)}...`);

    try {
      const order = await chargeBuyer(this.vaultId, req.receiptId, req.amount);
      const verification = await verifyOrder(order.id);

      console.log(`🎉 AUTONOMOUS PAYMENT SUCCESSFUL!`);
      console.log(`   Order ID:       ${verification.orderId}`);
      console.log(`   Order Status:   ${verification.orderStatus} (Direct capture without buyer!)`);
      console.log(`   Capture ID:     ${verification.captureId}`);
      console.log(`   Custom Receipt: ${verification.receiptId}`);
      console.log(`   Verified:       ${verification.verified ? "YES ✅" : "NO ❌"}`);

      return {
        status: "COMPLETED",
        orderId: verification.orderId,
        captureId: verification.captureId,
        receiptId: verification.receiptId,
        paypal_contacted: true,
      };
    } catch (err: any) {
      console.error("❌ Charge failed:", err.message || err);
      return { status: "ERROR", error: err, paypal_contacted: true };
    }
  }
}

async function main() {
  console.log("══════════════════════════════════════════════════════════");
  console.log(" 🚀 RECOURSE AUTONOMOUS AGENT PAYMENT DEMO");
  console.log("══════════════════════════════════════════════════════════");

  if (!vaultId) {
    console.error("\n⚠️  No PAYPAL_VAULT_ID found in your .env!");
    console.log("To enable unattended payments, run the one-time Vault setup first:");
    console.log("1. npx tsx src/spikes/setup_vault.ts");
    console.log("2. Approve once in browser with fake buyer");
    console.log("3. Add the resulting PAYPAL_VAULT_ID=... into your .env file.\n");
    return;
  }

  const agentGuard = new AutonomousAgentGuard(vaultId, 5.0);

  console.log("\n─── SCENARIO 1: Agent tries to buy $10 Jacket at 2 AM ───");
  await agentGuard.executeAutonomousPurchase({
    itemName: "Midnight Leather Jacket",
    amount: "10.00",
    receiptId: "receipt-001",
  });

  console.log("\n─── SCENARIO 2: Agent tries to buy $3 Cloud Server at 2 AM ───");
  await agentGuard.executeAutonomousPurchase({
    itemName: "Micro Cloud Server",
    amount: "3.00",
    receiptId: "receipt-001",
  });
}

main().catch(console.error);

