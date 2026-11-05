export type CompileDraftStatus = "DRAFT" | "NEEDS_CLARIFICATION";

export interface UnsignedDraftContract {
  id: string;
  family_id: string;
  version: number;
  owner_payer_id: string;
  budget_max_cents: number;
  per_order_cap_cents: number;
  allowed_payee_ids: string[];
  blocked_categories: string[];
  criteria: Array<{
    id: string;
    type: "structured" | "prose";
    field: string;
    expected: unknown;
  }>;
  expires_at: string;
  status: "ACTIVE";
  [key: string]: unknown;
}

export interface CompileDraftResult {
  status: CompileDraftStatus;
  draft: UnsignedDraftContract | null;
  warnings: string[];
}

export interface CompilerInput {
  prompt?: string;
  payer_id?: string;
  budget_max_cents?: number;
  per_order_cap_cents?: number;
  allowed_payee_ids?: string[];
  blocked_categories?: string[];
  expires_at?: string;
  [key: string]: unknown;
}

