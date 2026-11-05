import type { SignedReceiptEntry } from "../../ledger/src/store.js";

export interface EvidencePack {
  intent_contract: Record<string, unknown>;
  public_key_pem: string;
  signed_entries: SignedReceiptEntry[];
  created_at: string;
}

export interface EvidenceVerifyChecks {
  chain: boolean;
  signatures: boolean;
}

export interface EvidenceVerifyResult {
  valid: boolean;
  checks: EvidenceVerifyChecks;
  failures: string[];
}

