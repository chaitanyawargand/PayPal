import { describe, it, expect } from "vitest";
import { SignedReceiptLedger, verifySignedReceipts } from "../src/store";
import { generateSigningKeyPair, verifyReceiptSignature } from "../src/sign";
import { buildChainedReceipt } from "../src/chain";

const GENESIS = "0".repeat(64);

describe("SignedReceiptLedger and verifySignedReceipts", () => {
  it("first appended receipt has genesis prev_hash and valid signature", () => {
    const keys = generateSigningKeyPair();
    const ledger = new SignedReceiptLedger(keys);
    const entry = ledger.append({
      receipt_id: "rcpt_1",
      payment_id: "pay_1",
      verdict: "ALLOW",
      amount_cents: 7000,
    });

    expect(entry.receipt.prev_hash).toBe(GENESIS);
    expect(
      verifyReceiptSignature(entry.receipt.hash, entry.signature, keys.publicKeyPem),
    ).toBe(true);
  });

  it("second appended receipt prev_hash equals first receipt hash and entries length 2", () => {
    const keys = generateSigningKeyPair();
    const ledger = new SignedReceiptLedger(keys);
    const e1 = ledger.append({
      receipt_id: "rcpt_1",
      payment_id: "pay_1",
      verdict: "ALLOW",
      amount_cents: 7000,
    });
    const e2 = ledger.append({
      receipt_id: "rcpt_2",
      payment_id: "pay_2",
      verdict: "ALLOW",
      amount_cents: 3000,
    });

    expect(e2.receipt.prev_hash).toBe(e1.receipt.hash);
    expect(ledger.entries()).toHaveLength(2);
  });

  it("ledger.verify() is true after 2 appends", () => {
    const keys = generateSigningKeyPair();
    const ledger = new SignedReceiptLedger(keys);
    ledger.append({
      receipt_id: "rcpt_1",
      payment_id: "pay_1",
      verdict: "ALLOW",
      amount_cents: 7000,
    });
    ledger.append({
      receipt_id: "rcpt_2",
      payment_id: "pay_2",
      verdict: "ALLOW",
      amount_cents: 3000,
    });

    expect(ledger.verify()).toBe(true);
  });

  it("fails verification when amount_cents is tampered in a copy", () => {
    const keys = generateSigningKeyPair();
    const ledger = new SignedReceiptLedger(keys);
    ledger.append({
      receipt_id: "rcpt_1",
      payment_id: "pay_1",
      verdict: "ALLOW",
      amount_cents: 7000,
    });
    ledger.append({
      receipt_id: "rcpt_2",
      payment_id: "pay_2",
      verdict: "ALLOW",
      amount_cents: 3000,
    });

    const copy = ledger.entries().map((entry) => ({
      ...entry,
      receipt: { ...entry.receipt },
    }));
    copy[0].receipt.amount_cents = 1;

    expect(verifySignedReceipts(copy, keys.publicKeyPem)).toBe(false);
  });

  it("re-chain attack with rebuilt valid links fails signature verification", () => {
    const keys = generateSigningKeyPair();
    const ledger = new SignedReceiptLedger(keys);
    const e1 = ledger.append({
      receipt_id: "rcpt_1",
      payment_id: "pay_1",
      verdict: "ALLOW",
      amount_cents: 7000,
    });
    const e2 = ledger.append({
      receipt_id: "rcpt_2",
      payment_id: "pay_2",
      verdict: "ALLOW",
      amount_cents: 3000,
    });

    const { hash: _h1, prev_hash: _p1, ...b1 } = e1.receipt;
    const { hash: _h2, prev_hash: _p2, ...b2 } = e2.receipt;

    const tamperedB1 = { ...b1, amount_cents: 1 };
    const tamperedB2 = { ...b2, amount_cents: 1 };

    const rebuiltR1 = buildChainedReceipt(tamperedB1, GENESIS);
    const rebuiltR2 = buildChainedReceipt(tamperedB2, rebuiltR1.hash);

    const reChainedEntries = [
      { receipt: rebuiltR1, signature: e1.signature },
      { receipt: rebuiltR2, signature: e2.signature },
    ];

    expect(verifySignedReceipts(reChainedEntries, keys.publicKeyPem)).toBe(false);
  });

  it("fails verification with a different keypair public key", () => {
    const keys = generateSigningKeyPair();
    const otherKeys = generateSigningKeyPair();
    const ledger = new SignedReceiptLedger(keys);
    ledger.append({
      receipt_id: "rcpt_1",
      payment_id: "pay_1",
      verdict: "ALLOW",
      amount_cents: 7000,
    });

    expect(verifySignedReceipts(ledger.entries(), otherKeys.publicKeyPem)).toBe(false);
  });

  it("fails verification and does not throw with invalid signature string", () => {
    const keys = generateSigningKeyPair();
    const ledger = new SignedReceiptLedger(keys);
    ledger.append({
      receipt_id: "rcpt_1",
      payment_id: "pay_1",
      verdict: "ALLOW",
      amount_cents: 7000,
    });

    const entriesWithBadSig = [
      {
        receipt: ledger.entries()[0].receipt,
        signature: "not-a-valid-signature",
      },
    ];

    expect(() => verifySignedReceipts(entriesWithBadSig, keys.publicKeyPem)).not.toThrow();
    expect(verifySignedReceipts(entriesWithBadSig, keys.publicKeyPem)).toBe(false);
  });
});

