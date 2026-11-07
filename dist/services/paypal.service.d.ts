interface PayPalPaymentToken {
    id: string;
    customer?: {
        id: string;
    };
}
interface PayPalOrder {
    id: string;
    status: string;
    purchase_units?: Array<{
        custom_id?: string;
        payments?: {
            captures?: Array<{
                id: string;
                status: string;
            }>;
        };
    }>;
}
export declare function createSetupToken(): Promise<{
    setupTokenId: string;
    approvalUrl: string;
}>;
export declare function createPaymentToken(setupTokenId: string): Promise<PayPalPaymentToken>;
export declare function chargeBuyer(vaultId: string, receiptId: string, amount?: string): Promise<PayPalOrder>;
export declare function verifyOrder(orderId: string): Promise<{
    orderId: string;
    orderStatus: string;
    receiptId: string | null;
    captureId: string | null;
    captureStatus: string | null;
    verified: boolean;
}>;
export {};
