export interface VaultChargeRequest {
  amount_cents: number;
  currency: "USD";
  vault_id: string;
  idempotency_key: string;
  receipt_id: string;
}

export interface VaultChargeResponse {
  capture_id: string;
  status: "COMPLETED";
  charged_cents: number;
}

export interface PayPalVaultClient {
  chargeVaultedBuyer(
    req: VaultChargeRequest,
  ): Promise<VaultChargeResponse>;
}