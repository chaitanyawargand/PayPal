export interface GuardDecision {
  status: "ALLOWED" | "BLOCKED";
  reason: string;
  paypal_contacted: boolean;
  order?: any;
}

export interface GuardConfig {
  maxAmountUSD: number;
}

export class RecourseGuard {
  private api: { run(method: string, args: unknown): Promise<any> };
  private config: GuardConfig;

  constructor(
    api: { run(method: string, args: unknown): Promise<any> },
    config: GuardConfig = { maxAmountUSD: 5.0 }
  ) {
    this.api = api;
    this.config = config;
  }

  async createOrder(params: {
    itemName: string;
    amount: number;
    description?: string;
  }): Promise<GuardDecision> {
    const { itemName, amount, description } = params;

    if (isNaN(amount) || amount <= 0) {
      return {
        status: "BLOCKED",
        reason: `Invalid purchase amount: $${amount}`,
        paypal_contacted: false,
      };
    }

    if (amount > this.config.maxAmountUSD) {
      return {
        status: "BLOCKED",
        reason: `POLICY VIOLATION: Purchase amount $${amount.toFixed(2)} exceeds strict agent limit of $${this.config.maxAmountUSD.toFixed(2)}`,
        paypal_contacted: false,
      };
    }

    try {
      const payload = {
        currencyCode: "USD" as const,
        items: [
          {
            name: itemName,
            quantity: 1,
            itemCost: amount,
            taxPercent: 0,
            itemTotal: amount,
            description: description || "Approved Recourse Purchase",
          },
        ],
      };

      const result = await this.api.run("create_order", payload);
      const order = typeof result === "string" ? JSON.parse(result) : result;

      return {
        status: "ALLOWED",
        reason: `Purchase approved within spending policy limit ($${amount.toFixed(2)} <= $${this.config.maxAmountUSD.toFixed(2)})`,
        paypal_contacted: true,
        order,
      };
    } catch (err: any) {
      return {
        status: "BLOCKED",
        reason: `PayPal execution failure: ${err.message || err}`,
        paypal_contacted: true,
      };
    }
  }
}

