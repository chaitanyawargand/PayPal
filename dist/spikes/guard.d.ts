export interface GuardDecision {
    status: "ALLOWED" | "BLOCKED";
    reason: string;
    paypal_contacted: boolean;
    order?: any;
}
export interface GuardConfig {
    maxAmountUSD: number;
}
export declare class RecourseGuard {
    private api;
    private config;
    constructor(api: {
        run(method: string, args: unknown): Promise<any>;
    }, config?: GuardConfig);
    createOrder(params: {
        itemName: string;
        amount: number;
        description?: string;
    }): Promise<GuardDecision>;
}
