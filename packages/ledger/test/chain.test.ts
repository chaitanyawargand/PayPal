import { describe, it, expect } from "vitest";
import {
  computeReceiptHash,
  buildChainedReceipt,
  verifyReceiptChain,
} from "../src/chain.ts";

const GENESIS = "0".repeat(64); // prev_hash of the very first receipt in a chain

describe("receipt hash chain", () => {
  it("same body in different key order gives the same hash", () => {
    const a = computeReceiptHash({ b: 1, a: 2 }, GENESIS);
    const b = computeReceiptHash({ a: 2, b: 1 }, GENESIS);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
  });

  it("different body gives a different hash", () => {
    const a = computeReceiptHash({ verdict: "ALLOW" }, GENESIS);
    const b = computeReceiptHash({ verdict: "BLOCK" }, GENESIS);
    expect(a).not.toBe(b);
  });

  it("builds a 2-receipt chain that verifies", () => {
    const r1 = buildChainedReceipt(
      { receipt_id: "rcpt_1", payment_id: "pay_1", seq: 1, verdict: "ALLOW" },
      GENESIS
    );
    const r2 = buildChainedReceipt(
      { receipt_id: "rcpt_2", payment_id: "pay_2", seq: 2, verdict: "BLOCK" },
      r1.hash
    );

    expect(r1.prev_hash).toBe(GENESIS);
    expect(r2.prev_hash).toBe(r1.hash);
    expect(verifyReceiptChain([r1, r2])).toBe(true);
  });

  it("fails verification when one field is tampered", () => {
    const r1 = buildChainedReceipt(
      { receipt_id: "rcpt_1", payment_id: "pay_1", seq: 1, verdict: "ALLOW" },
      GENESIS
    );
    const r2 = buildChainedReceipt(
      { receipt_id: "rcpt_2", payment_id: "pay_2", seq: 2, verdict: "BLOCK" },
      r1.hash
    );

    const tampered = { ...r2, verdict: "ALLOW" }; // flip one field, keep old hash
    expect(verifyReceiptChain([r1, tampered])).toBe(false);
  });

  it("fails verification when the link to the previous receipt is broken", () => {
    const r1 = buildChainedReceipt(
      { receipt_id: "rcpt_1", payment_id: "pay_1", seq: 1, verdict: "ALLOW" },
      GENESIS
    );
    const r2 = buildChainedReceipt(
      { receipt_id: "rcpt_2", payment_id: "pay_2", seq: 2, verdict: "BLOCK" },
      r1.hash
    );

    const broken = { ...r2, prev_hash: GENESIS }; // wrong previous link
    expect(verifyReceiptChain([r1, broken])).toBe(false);
  });

  it("empty chain verifies, single genesis receipt verifies", () => {
    expect(verifyReceiptChain([])).toBe(true);
    const r1 = buildChainedReceipt(
      { receipt_id: "rcpt_1", payment_id: "pay_1", seq: 1, verdict: "ALLOW" },
      GENESIS
    );
    expect(verifyReceiptChain([r1])).toBe(true);
  });
});