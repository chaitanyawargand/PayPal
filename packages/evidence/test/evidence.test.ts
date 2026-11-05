import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { generateSigningKeyPair } from "../../ledger/src/sign.js";
import { SignedReceiptLedger } from "../../ledger/src/store.js";
import { buildEvidencePack } from "../src/pack.js";
import { verifyEvidencePack } from "../src/verify.js";

function setupFixture() {
  const keys = generateSigningKeyPair();
  const ledger = new SignedReceiptLedger(keys);

  const contract = {
    id: "ct_trailgear_001",
    budget_max_cents: 100000,
    per_order_cap_cents: 100000,
    allowed_payee_ids: ["merchant_trailgear"],
    blocked_categories: ["gift_card"],
    status: "ACTIVE",
  };

  const entry1 = ledger.append({
    receipt_id: "rcpt_001",
    payment_id: "pay_001",
    contract_id: "ct_trailgear_001",
    merchant_id: "merchant_trailgear",
    order_id: "ord_001",
    capture_id: "paypal_cap_001",
    verdict: "ALLOW",
    reason_codes: [],
    computed_total_cents: 7000,
    money_moved_cents: 7000,
    psp_tier: "B",
  });

  const entry2 = ledger.append({
    receipt_id: "rcpt_002",
    payment_id: "pay_002",
    contract_id: "ct_trailgear_001",
    merchant_id: "merchant_trailgear",
    order_id: "ord_002",
    capture_id: null,
    verdict: "BLOCK",
    reason_codes: ["TOTAL_MISMATCH"],
    computed_total_cents: 7000,
    money_moved_cents: 0,
    psp_tier: "B",
  });

  const entry3 = ledger.append({
    receipt_id: "rcpt_003",
    payment_id: "pay_003",
    contract_id: "ct_trailgear_001",
    merchant_id: "merchant_trailgear",
    order_id: "ord_003",
    capture_id: null,
    verdict: "STEP_UP",
    reason_codes: ["LINE_FROM_UNTRUSTED_CONTENT"],
    computed_total_cents: 7000,
    money_moved_cents: 0,
    psp_tier: "B",
  });

  const pack = buildEvidencePack({
    intentContract: contract,
    publicKeyPem: keys.publicKeyPem,
    signedEntries: ledger.entries(),
  });

  return { keys, ledger, contract, pack, entries: [entry1, entry2, entry3] };
}

describe("packages/evidence - Evidence Pack Builder & Verifier", () => {
  it("1. Valid evidence pack passes all checks matching Contract 1", () => {
    const { pack } = setupFixture();
    const result = verifyEvidencePack(pack);

    expect(result).toEqual({
      valid: true,
      checks: {
        chain: true,
        signatures: true,
      },
      failures: [],
    });
  });

  it("2. Tampering amount_cents fails verification", () => {
    const { pack } = setupFixture();
    const tampered = JSON.parse(JSON.stringify(pack));
    tampered.signed_entries[0].receipt.computed_total_cents = 99999;

    const result = verifyEvidencePack(tampered);
    expect(result.valid).toBe(false);
    expect(result.checks.chain).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("3. Tampering verdict fails verification", () => {
    const { pack } = setupFixture();
    const tampered = JSON.parse(JSON.stringify(pack));
    tampered.signed_entries[1].receipt.verdict = "ALLOW";

    const result = verifyEvidencePack(tampered);
    expect(result.valid).toBe(false);
    expect(result.checks.chain).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("4. Tampering capture_id fails verification", () => {
    const { pack } = setupFixture();
    const tampered = JSON.parse(JSON.stringify(pack));
    tampered.signed_entries[0].receipt.capture_id = "forged_capture_id";

    const result = verifyEvidencePack(tampered);
    expect(result.valid).toBe(false);
    expect(result.checks.chain).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("4b. Tampering body and recomputing hash fails signature check", () => {
    const { pack } = setupFixture();
    const tampered = JSON.parse(JSON.stringify(pack));
    // Recompute hash after tampering to fake the chain
    tampered.signed_entries[0].receipt.computed_total_cents = 99999;
    tampered.signed_entries[0].receipt.hash = "0123456789abcdef".repeat(4);

    const result = verifyEvidencePack(tampered);
    expect(result.valid).toBe(false);
    expect(result.checks.signatures).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("5. Tampering signature fails signature verification", () => {
    const { pack } = setupFixture();
    const tampered = JSON.parse(JSON.stringify(pack));
    // Corrupt one character in the base64 signature
    tampered.signed_entries[0].signature =
      "A" + tampered.signed_entries[0].signature.slice(1);

    const result = verifyEvidencePack(tampered);
    expect(result.valid).toBe(false);
    expect(result.checks.signatures).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([expect.stringContaining("Signature verification failed")]),
    );
  });

  it("6. Tampering entry order fails chain verification", () => {
    const { pack } = setupFixture();
    const tampered = JSON.parse(JSON.stringify(pack));
    // Reverse entry order
    tampered.signed_entries = [
      tampered.signed_entries[2],
      tampered.signed_entries[1],
      tampered.signed_entries[0],
    ];

    const result = verifyEvidencePack(tampered);
    expect(result.valid).toBe(false);
    expect(result.checks.chain).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([expect.stringContaining("hash chain")]),
    );
  });

  it("7. Verifying against a wrong public key fails signature check", () => {
    const { pack } = setupFixture();
    const wrongKeys = generateSigningKeyPair();
    const tampered = {
      ...pack,
      public_key_pem: wrongKeys.publicKeyPem,
    };

    const result = verifyEvidencePack(tampered);
    expect(result.valid).toBe(false);
    expect(result.checks.chain).toBe(true); // Chain structure is intact
    expect(result.checks.signatures).toBe(false); // Signatures fail
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("8. Malformed or invalid input returns structured failure without throwing", () => {
    expect(verifyEvidencePack(null)).toEqual({
      valid: false,
      checks: { chain: false, signatures: false },
      failures: expect.arrayContaining([expect.stringContaining("non-null object")]),
    });

    expect(verifyEvidencePack({})).toEqual({
      valid: false,
      checks: { chain: false, signatures: false },
      failures: expect.arrayContaining([
        expect.stringContaining("public_key_pem"),
        expect.stringContaining("signed_entries"),
      ]),
    });
  });

  it("9. Architectural Boundary: packages/evidence has zero database imports", () => {
    const srcDir = path.resolve(__dirname, "../src");
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts"));

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = fs.readFileSync(path.join(srcDir, file), "utf-8");
      expect(content).not.toMatch(/from\s+["'].*db.*["']/i);
      expect(content).not.toMatch(/sqlite/i);
      expect(content).not.toMatch(/process\.env/i);
    }
  });
});
