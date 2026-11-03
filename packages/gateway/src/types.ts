export interface ReceiptBody {
  receipt_id: string;
  payment_id: string;
  contract_id: string;
  merchant_id: string;
  order_id: string;
  capture_id: string | null;
  verdict: string;
  reason_codes: string[];
  computed_total_cents: number;
  money_moved_cents: number;
  psp_tier: "A" | "B" | "C";
  [key: string]: unknown;
}

export interface DecisionResult {
  verdict: "ALLOW" | "BLOCK" | "STEP_UP" | string;
  reason_codes: string[];
  computed_total_cents: number;
  [key: string]: unknown;
}

export interface PspResult {
  status: "CAPTURED" | "NOT_CHARGED" | string;
  tier?: "A" | "B" | "C" | string;
  capture_id: string | null;
  order_id: string | null;
  money_moved_cents: number;
  [key: string]: unknown;
}

export interface ExecutePaymentResult {
  decision: DecisionResult;
  pspResult: PspResult;
  receiptBody: ReceiptBody;
}

export interface ReceiptStore {
  recordOutcome(input: {
    idempotencyKey: string | null;
    result: ExecutePaymentResult;
  }): Promise<void>;

  getOutcomeByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ExecutePaymentResult | null>;

  getReceiptById(receiptId: string): Promise<ReceiptBody | null>;

  listReceipts?(): Promise<ReceiptBody[]>;
}

export interface GatewayDeps {
  executor: (input: any) => Promise<ExecutePaymentResult>;
  receipts: ReceiptStore;
}

export type GatewayErrorCode =
  | "BAD_JSON"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INTERNAL";

export interface GatewayErrorResponse {
  error: {
    code: GatewayErrorCode;
    message: string;
    request_id: string;
    issues?: Array<{ path: (string | number)[]; message: string }>;
  };
}

