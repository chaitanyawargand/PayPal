import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRecourseDatabase, type RecourseDatabase } from "../src/index.js";
import type { Contract } from "../../core/src/contract.js";
import type { ReasonCode, Verdict } from "../../core/src/verdict.js";
import { generateSigningKeyPair } from "../../ledger/src/sign.js";
import {
  SignedReceiptLedger,
  verifySignedReceipts,
  type SignedReceiptEntry,
} from "../../ledger/src/store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function memoryDb(): RecourseDatabase {
  return createRecourseDatabase({ path: ":memory:" });
}

function fileDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "recourse-db-"));
  tempDirs.push(dir);
  return join(dir, "recourse.db");
}
async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code !== "string") {
      throw error;
    }
    return code;
  }
  throw new Error("Expected promise to reject, but it resolved");
}

const contract: Contract = {
  id: "contract_1",
  family_id: "family_1",
  version: 1,
  owner_payer_id: "payer_1",
  criteria: [
    {
      id: "crit_1",
      type: "structured",
      field: "merchant_id",
      expected: "merchant_trailgear",
    },
  ],
  budget_max_cents: 10000,
  per_order_cap_cents: 7000,
  allowed_payee_ids: ["merchant_trailgear"],
  blocked_categories: ["gambling"],
  expires_at: "2027-01-01T00:00:00.000Z",
  ship_to_hash: "ship_hash_1",
  status: "ACTIVE",
  hash: "contract_hash_1",
  signature: "contract_sig_1",
};

function makeOutcome(n: number, verdict: Verdict = "ALLOW") {
  const reason_codes: ReasonCode[] =
    verdict === "BLOCK"
      ? ["TOTAL_MISMATCH"]
      : verdict === "STEP_UP"
        ? ["LINE_FROM_UNTRUSTED_CONTENT"]
        : [];
  const capture_id = verdict === "ALLOW" ? `capture_${n}` : null;

  const receiptBody = {
    receipt_id: `receipt_${n}`,
    payment_id: `payment_${n}`,
    contract_id: contract.id,
    merchant_id: "merchant_trailgear",
    order_id: `order_${n}`,
    capture_id,
    verdict,
    reason_codes,
    computed_total_cents: 7000,
    money_moved_cents: verdict === "ALLOW" ? 7000 : 0,
    psp_tier: "C",
  };

  return {
    decision: { verdict, reason_codes, computed_total_cents: 7000 },
    pspResult: {
      tier: "C",
      capture_id,
      money_moved_cents: receiptBody.money_moved_cents,
      status: verdict === "ALLOW" ? "COMPLETED" : "NOT_CHARGED",
    },
    receiptBody,
  };
}

describe("intent contracts", () => {
  it("saves and reads back an identical contract; conflicting re-save is rejected", async () => {
    const db = memoryDb();
    try {
      await db.intents.saveIntent(contract);
      await db.intents.saveIntent(contract); // identical re-save is fine
      expect(await db.intents.getIntentById(contract.id)).toEqual(contract);

      expect(
        await rejectionCode(
          db.intents.saveIntent({ ...contract, budget_max_cents: 9000 }),
        ),
      ).toBe("INTENT_CONFLICT");
    } finally {
      db.close();
    }
  });

  it("rejects a schema-invalid contract", async () => {
    const db = memoryDb();
    try {
      await expect(
        db.intents.saveIntent({ ...contract, budget_max_cents: -1 }),
      ).rejects.toThrow();
      expect(await db.intents.getIntentById(contract.id)).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("signed receipts and outcomes", () => {
  it("stores a 3-entry chain in order; chain verifies; null capture_id round-trips", async () => {
    const db = memoryDb();
    const keys = generateSigningKeyPair();
    const ledger = new SignedReceiptLedger(keys);
    try {
      const outcomes = [
        makeOutcome(1, "ALLOW"),
        makeOutcome(2, "BLOCK"),
        makeOutcome(3, "STEP_UP"),
      ];
      const entries = outcomes.map((o) => ledger.append(o.receiptBody));

      for (const [i, outcome] of outcomes.entries()) {
        await db.receipts.recordOutcome({
          idempotency_key: `idem_${i + 1}`,
          result: outcome,
          signed_entry: entries[i] as SignedReceiptEntry,
        });
      }

      const listed = await db.receipts.listReceipts();
      expect(listed.map((e) => e.receipt.receipt_id)).toEqual([
        "receipt_1",
        "receipt_2",
        "receipt_3",
      ]);
      expect(verifySignedReceipts(listed, keys.publicKeyPem)).toBe(true);

      const blocked = await db.receipts.getReceiptById("receipt_2");
      expect(blocked?.receipt.capture_id).toBeNull();
      expect(blocked?.receipt.verdict).toBe("BLOCK");
    } finally {
      db.close();
    }
  });

  it("returns the full original outcome by idempotency key", async () => {
    const db = memoryDb();
    const keys = generateSigningKeyPair();
    const ledger = new SignedReceiptLedger(keys);
    try {
      const outcome = makeOutcome(1);
      await db.receipts.recordOutcome({
        idempotency_key: "idem_1",
        result: outcome,
        signed_entry: ledger.append(outcome.receiptBody) as SignedReceiptEntry,
      });

      expect(await db.receipts.getOutcomeByIdempotencyKey("idem_1")).toEqual(
        outcome,
      );
      expect(
        await db.receipts.getOutcomeByIdempotencyKey("missing"),
      ).toBeNull();
      expect(await db.receipts.getReceiptById("missing")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("rejects duplicate receipt and duplicate idempotency key with no partial writes", async () => {
    const db = memoryDb();
    const keys = generateSigningKeyPair();
    const ledger = new SignedReceiptLedger(keys);
    try {
      const first = makeOutcome(1);
      const firstEntry = ledger.append(first.receiptBody) as SignedReceiptEntry;
      await db.receipts.recordOutcome({
        idempotency_key: "idem_1",
        result: first,
        signed_entry: firstEntry,
      });

      const second = makeOutcome(2);
      const secondEntry = ledger.append(
        second.receiptBody,
      ) as SignedReceiptEntry;
      expect(
        await rejectionCode(
          db.receipts.recordOutcome({
            idempotency_key: "idem_1",
            result: second,
            signed_entry: secondEntry,
          }),
        ),
      ).toBe("DUPLICATE_IDEMPOTENCY_KEY");
      expect(await db.receipts.getReceiptById("receipt_2")).toBeNull();
      expect((await db.receipts.listReceipts()).length).toBe(1);

      expect(
        await rejectionCode(
          db.receipts.recordOutcome({
            idempotency_key: "idem_2",
            result: second,
            signed_entry: firstEntry,
          }),
        ),
      ).toBe("DUPLICATE_RECEIPT");
      expect(await db.receipts.getOutcomeByIdempotencyKey("idem_2")).toBeNull();
      expect((await db.receipts.listReceipts()).length).toBe(1);
    } finally {
      db.close();
    }
  });

  it("allows multiple outcomes with a null idempotency key", async () => {
    const db = memoryDb();
    const keys = generateSigningKeyPair();
    const ledger = new SignedReceiptLedger(keys);
    try {
      for (const outcome of [makeOutcome(1), makeOutcome(2, "BLOCK")]) {
        await db.receipts.recordOutcome({
          idempotency_key: null,
          result: outcome,
          signed_entry: ledger.append(
            outcome.receiptBody,
          ) as SignedReceiptEntry,
        });
      }
      expect((await db.receipts.listReceipts()).length).toBe(2);
    } finally {
      db.close();
    }
  });

  it("persists across close/reopen and migrations are idempotent", async () => {
    const path = fileDbPath();
    const keys = generateSigningKeyPair();
    const ledger = new SignedReceiptLedger(keys);
    const outcome = makeOutcome(1);
    const entry = ledger.append(outcome.receiptBody) as SignedReceiptEntry;

    const db1 = createRecourseDatabase({ path });
    await db1.intents.saveIntent(contract);
    await db1.receipts.recordOutcome({
      idempotency_key: "idem_1",
      result: outcome,
      signed_entry: entry,
    });
    db1.close();

    const db2 = createRecourseDatabase({ path });
    try {
      expect(await db2.intents.getIntentById(contract.id)).toEqual(contract);
      expect(await db2.receipts.getOutcomeByIdempotencyKey("idem_1")).toEqual(
        outcome,
      );
      const listed = await db2.receipts.listReceipts();
      expect(listed.length).toBe(1);
      expect(verifySignedReceipts(listed, keys.publicKeyPem)).toBe(true);
    } finally {
      db2.close();
    }

    const db3 = createRecourseDatabase({ path });
    try {
      expect((await db3.receipts.listReceipts()).length).toBe(1);
    } finally {
      db3.close();
    }
  });
});
