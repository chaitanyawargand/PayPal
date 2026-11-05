import type { SignedReceiptEntry } from "../../ledger/src/store.js";
import type { EvidencePack } from "./types.js";

export interface BuildEvidencePackOptions {
  intentContract: Record<string, unknown>;
  publicKeyPem: string;
  signedEntries: SignedReceiptEntry[];
  createdAt?: string;
}

export function buildEvidencePack(options: BuildEvidencePackOptions): EvidencePack {
  if (!options || typeof options !== "object") {
    throw new Error("Invalid options for buildEvidencePack");
  }
  if (!options.intentContract || typeof options.intentContract !== "object") {
    throw new Error("intentContract must be a valid object");
  }
  if (!options.publicKeyPem || typeof options.publicKeyPem !== "string") {
    throw new Error("publicKeyPem must be a non-empty string");
  }
  if (!Array.isArray(options.signedEntries)) {
    throw new Error("signedEntries must be an array");
  }

  return {
    intent_contract: options.intentContract,
    public_key_pem: options.publicKeyPem,
    signed_entries: [...options.signedEntries],
    created_at: options.createdAt ?? new Date().toISOString(),
  };
}

