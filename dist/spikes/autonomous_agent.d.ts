import "dotenv/config";
export interface AutonomousPurchaseRequest {
    itemName: string;
    amount: string;
    receiptId: string;
}
export declare class AutonomousAgentGuard {
    private vaultId;
    private maxAmountUSD;
    constructor(vaultId: string, maxAmountUSD?: number);
    executeAutonomousPurchase(req: AutonomousPurchaseRequest): Promise<{
        status: string;
        reason: string;
        paypal_contacted: boolean;
        orderId?: undefined;
        captureId?: undefined;
        receiptId?: undefined;
        verified?: undefined;
        error?: undefined;
    } | {
        reason?: undefined;
        status: string;
        orderId: string;
        captureId: string | null;
        receiptId: string | null;
        verified: boolean;
        paypal_contacted: boolean;
        error?: undefined;
    } | {
        reason?: undefined;
        orderId?: undefined;
        captureId?: undefined;
        receiptId?: undefined;
        verified?: undefined;
        status: string;
        error: any;
        paypal_contacted: boolean;
    }>;
}
