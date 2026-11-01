import {
  buildChainedReceipt,
  verifyReceiptChain,
  type ChainedReceipt,
} from "./chain.js";
import { signReceiptHash, verifyReceiptSignature } from "./sign.js";
import type { JsonValue } from "../../core/src/canonical.js";

const GENESIS_PREV_HASH = "0".repeat(64);

export type SignedReceiptEntry<
  TBody extends Record<string, JsonValue> = Record<string, JsonValue>,
> = {
  receipt: ChainedReceipt<TBody>;
  signature: string;
};

export class SignedReceiptLedger {
  private readonly publicKeyPem: string;
  private readonly privateKeyPem: string;
  private readonly _entries: SignedReceiptEntry[] = [];

  constructor({
    publicKeyPem,
    privateKeyPem,
  }: {
    publicKeyPem: string;
    privateKeyPem: string;
  }) {
    this.publicKeyPem = publicKeyPem;
    this.privateKeyPem = privateKeyPem;
  }

  append<TBody extends Record<string, JsonValue>>(
    body: TBody,
  ): SignedReceiptEntry<TBody> {
    const prevHash =
      this._entries.length === 0
        ? GENESIS_PREV_HASH
        : this._entries[this._entries.length - 1].receipt.hash;

    const receipt = buildChainedReceipt(body, prevHash);
    const signature = signReceiptHash(receipt.hash, this.privateKeyPem);

    const entry: SignedReceiptEntry<TBody> = {
      receipt,
      signature,
    };

    this._entries.push(entry as unknown as SignedReceiptEntry);
    return entry;
  }

  entries(): SignedReceiptEntry[] {
    return [...this._entries];
  }

  verify(): boolean {
    return verifySignedReceipts(this._entries, this.publicKeyPem);
  }
}

export function verifySignedReceipts(
  entries: ReadonlyArray<SignedReceiptEntry>,
  publicKeyPem: string,
): boolean {
  try {
    if (!Array.isArray(entries)) {
      return false;
    }

    const receipts = entries.map((entry) => entry.receipt);
    if (!verifyReceiptChain(receipts)) {
      return false;
    }

    for (const entry of entries) {
      if (!entry || !entry.receipt || typeof entry.signature !== "string") {
        return false;
      }

      const isValid = verifyReceiptSignature(
        entry.receipt.hash,
        entry.signature,
        publicKeyPem,
      );

      if (!isValid) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

