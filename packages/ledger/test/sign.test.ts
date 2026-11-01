import { describe, it, expect } from "vitest";
import { buildChainedReceipt } from "../src/chain";
import {
  generateSigningKeyPair,
  signReceiptHash,
  verifyReceiptSignature,
} from "../src/sign.ts";

const GENESIS_PREV_HASH = "0".repeat(64);

function makeChainedReceipt() {
  return buildChainedReceipt(
    {
      receipt_id: "rcpt_test_001",
      payment_id: "pay_1",
      verdict: "ALLOW",
      amount_cents: 7000,
    },
    GENESIS_PREV_HASH,
  );
}

describe("receipt signing", () => {
  it("generates an Ed25519 key pair in PEM format", () => {
    const keys = generateSigningKeyPair();

    expect(keys.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(keys.privateKeyPem).toContain("BEGIN PRIVATE KEY");
  });

  it("valid signature for a chained receipt hash verifies", () => {
    const keys = generateSigningKeyPair();
    const receipt = makeChainedReceipt();

    const signature = signReceiptHash(receipt.hash, keys.privateKeyPem);

    expect(typeof signature).toBe("string");
    expect(signature.length).toBeGreaterThan(0);
    expect(signature).not.toContain("BEGIN");
    expect(
      verifyReceiptSignature(receipt.hash, signature, keys.publicKeyPem),
    ).toBe(true);
  });

  it("fails when the receipt body is changed, so its hash changes", () => {
    const keys = generateSigningKeyPair();
    const receipt = makeChainedReceipt();

    const signature = signReceiptHash(receipt.hash, keys.privateKeyPem);

    // Same receipt, but amount changed from 7000 to 1.
    // buildChainedReceipt recomputes the hash, so it will be different.
    const tamperedReceipt = buildChainedReceipt(
      {
        receipt_id: "rcpt_test_001",
        payment_id: "pay_1",
        verdict: "ALLOW",
        amount_cents: 1,
      },
      GENESIS_PREV_HASH,
    );

    expect(tamperedReceipt.hash).not.toBe(receipt.hash);
    expect(
      verifyReceiptSignature(
        tamperedReceipt.hash,
        signature,
        keys.publicKeyPem,
      ),
    ).toBe(false);
  });

  it("fails verification with a different public key", () => {
    const signerKeys = generateSigningKeyPair();
    const otherKeys = generateSigningKeyPair();
    const receipt = makeChainedReceipt();

    const signature = signReceiptHash(receipt.hash, signerKeys.privateKeyPem);

    expect(
      verifyReceiptSignature(receipt.hash, signature, otherKeys.publicKeyPem),
    ).toBe(false);
  });

  it("returns false instead of throwing for a malformed signature", () => {
    const keys = generateSigningKeyPair();
    const receipt = makeChainedReceipt();

    expect(
      verifyReceiptSignature(
        receipt.hash,
        "not-a-valid-signature",
        keys.publicKeyPem,
      ),
    ).toBe(false);
  });
});
