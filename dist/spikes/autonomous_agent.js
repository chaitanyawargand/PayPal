import "dotenv/config";
import { chargeBuyer, verifyOrder } from "../services/paypal.service.js";
const vaultId = process.env.PAYPAL_VAULT_ID?.trim();
export class AutonomousAgentGuard {
    vaultId;
    maxAmountUSD;
    constructor(vaultId, maxAmountUSD = 5.0) {
        this.vaultId = vaultId;
        this.maxAmountUSD = maxAmountUSD;
    }
    async executeAutonomousPurchase(req) {
        const amountNum = parseFloat(req.amount);
        if (isNaN(amountNum) || amountNum <= 0) {
            return { status: "BLOCKED", reason: "Invalid amount", paypal_contacted: false };
        }
        if (amountNum > this.maxAmountUSD) {
            return {
                status: "BLOCKED",
                reason: `Exceeds spending limit ($${amountNum.toFixed(2)} > $${this.maxAmountUSD.toFixed(2)})`,
                paypal_contacted: false,
            };
        }
        try {
            const order = await chargeBuyer(this.vaultId, req.receiptId, req.amount);
            const verification = await verifyOrder(order.id);
            return {
                status: "COMPLETED",
                orderId: verification.orderId,
                captureId: verification.captureId,
                receiptId: verification.receiptId,
                verified: verification.verified,
                paypal_contacted: true,
            };
        }
        catch (err) {
            return { status: "ERROR", error: err.message || err, paypal_contacted: true };
        }
    }
}
async function main() {
    if (!vaultId) {
        console.error("Missing PAYPAL_VAULT_ID in .env. Run setup_vault.ts first.");
        process.exit(1);
    }
    const guard = new AutonomousAgentGuard(vaultId, 5.0);
    // Scenario 1: Attempt to purchase over limit
    const res1 = await guard.executeAutonomousPurchase({
        itemName: "Jacket",
        amount: "10.00",
        receiptId: "receipt-001",
    });
    console.log(`Purchase $10: status=${res1.status}, paypal_contacted=${res1.paypal_contacted}`);
    // Scenario 2: Permitted autonomous purchase
    const res2 = await guard.executeAutonomousPurchase({
        itemName: "Cloud Server",
        amount: "3.00",
        receiptId: "receipt-001",
    });
    console.log(`Purchase $3:  status=${res2.status}, orderId=${res2.orderId}, captureId=${res2.captureId}`);
}
main().catch((err) => {
    console.error("Execution failed:", err.message || err);
    process.exit(1);
});
//# sourceMappingURL=autonomous_agent.js.map