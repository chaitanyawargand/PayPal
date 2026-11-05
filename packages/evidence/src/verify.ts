import { verifyReceiptChain } from "../../ledger/src/chain.js";
import { verifyReceiptSignature } from "../../ledger/src/sign.js";
import { verifySignedReceipts } from "../../ledger/src/store.js";
import type { EvidencePack, EvidenceVerifyResult } from "./types.js";

/**
 * Verifies an Evidence Pack according to Phase 6 Contract 1.
 * Never throws — always returns structured verification result.
 * Checks both SHA-256 hash chaining and Ed25519 digital signatures
 * recomputing the chain via the existing verifySignedReceipts.
 * Does not import any database libraries or secrets.
 */
export function verifyEvidencePack(pack: unknown): EvidenceVerifyResult {
  const failures: string[] = [];
  const checks = {
    chain: false,
    signatures: false,
  };

  try {
    if (!pack || typeof pack !== "object") {
      failures.push("Invalid evidence pack: root must be a non-null object");
      return { valid: false, checks, failures };
    }

    const candidate = pack as Partial<EvidencePack>;

    if (!candidate.public_key_pem || typeof candidate.public_key_pem !== "string") {
      failures.push("Missing or invalid public_key_pem string in evidence pack");
    }

    if (!Array.isArray(candidate.signed_entries)) {
      failures.push("Missing or invalid signed_entries array in evidence pack");
    }

    if (failures.length > 0) {
      return { valid: false, checks, failures };
    }

    const publicKeyPem = candidate.public_key_pem!;
    const entries = candidate.signed_entries!;

    // 1. Check receipt hash chain
    const receipts = entries.map((e) => e?.receipt);
    const isChainValid = verifyReceiptChain(receipts as any);
    checks.chain = isChainValid;
    if (!isChainValid) {
      failures.push("Receipt hash chain is invalid or has been tampered with");
    }

    // 2. Check Ed25519 signatures on each receipt
    let allSignaturesValid = entries.length > 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry || !entry.receipt || typeof entry.signature !== "string") {
        allSignaturesValid = false;
        failures.push(`Entry #${i} is missing receipt or signature`);
        continue;
      }

      const receiptId = (entry.receipt as any)?.receipt_id ?? `entry_${i}`;
      const hash = entry.receipt.hash;

      if (!hash || typeof hash !== "string") {
        allSignaturesValid = false;
        failures.push(`Receipt '${receiptId}' has missing or non-string hash`);
        continue;
      }

      let sigOk = false;
      try {
        sigOk = verifyReceiptSignature(hash, entry.signature, publicKeyPem);
      } catch {
        sigOk = false;
      }

      if (!sigOk) {
        allSignaturesValid = false;
        failures.push(`Signature verification failed for receipt '${receiptId}'`);
      }
    }

    checks.signatures = allSignaturesValid;

    // Recompute via the existing ledger verifySignedReceipts
    const ledgerVerifyOk = verifySignedReceipts(entries, publicKeyPem);
    if (!ledgerVerifyOk && failures.length === 0) {
      failures.push("Ledger cryptographic verification failed");
    }

    const valid = checks.chain && checks.signatures && ledgerVerifyOk && failures.length === 0;

    return {
      valid,
      checks,
      failures,
    };
  } catch (err: any) {
    failures.push(`Unexpected error during evidence verification: ${err?.message ?? String(err)}`);
    return {
      valid: false,
      checks: { chain: false, signatures: false },
      failures,
    };
  }
}

