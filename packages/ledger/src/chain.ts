import { createHash } from "node:crypto";
import { canonicalJson, type JsonValue } from "../../core/src/canonical.js";

export type ChainedReceipt<TBody extends Record<string, JsonValue>> = TBody & {
  prev_hash: string;
  hash: string;
};

export function computeReceiptHash(body: JsonValue, prevHash: string): string {
  return createHash("sha256")
    .update(canonicalJson(body) + prevHash, "utf8")
    .digest("hex");
}

export function buildChainedReceipt<TBody extends Record<string, JsonValue>>(
  body: TBody,
  prevHash: string,
): ChainedReceipt<TBody> {
  const hash = computeReceiptHash(body, prevHash);
  return {
    ...body,
    prev_hash: prevHash,
    hash,
  };
}

export function verifyReceiptChain(
  receipts: ReadonlyArray<{
    prev_hash: string;
    hash: string;
    [key: string]: JsonValue;
  }>,
): boolean {
  for (let i = 0; i < receipts.length; i++) {
    const receipt = receipts[i];

    // Link check: this receipt must point at the previous receipt's hash.
    if (i > 0 && receipt.prev_hash !== receipts[i - 1].hash) {
      return false;
    }

    // Fingerprint check: recompute the hash from the body and compare.
    const { hash, prev_hash, ...body } = receipt;
    const expected = computeReceiptHash(body, prev_hash);
    if (expected !== hash) {
      return false;
    }
  }

  return true;
}
