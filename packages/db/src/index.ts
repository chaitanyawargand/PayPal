import { DatabaseSync } from "node:sqlite";

import { canonicalJson, type JsonValue } from "../../core/src/canonical.js";
import { ContractSchema, type Contract } from "../../core/src/contract.js";
import type { SignedReceiptEntry } from "../../ledger/src/store.js";

export type RecourseDbErrorCode =
  | "INTENT_CONFLICT"
  | "DUPLICATE_IDEMPOTENCY_KEY"
  | "DUPLICATE_RECEIPT"
  | "INVALID_OUTCOME"
  | "INVALID_SIGNED_ENTRY"
  | "DATABASE_CLOSED";

export class RecourseDatabaseError extends Error {
  readonly code: RecourseDbErrorCode;

  constructor(code: RecourseDbErrorCode, message: string) {
    super(message);
    this.name = "RecourseDatabaseError";
    this.code = code;
  }
}

export type ExecutePaymentResult = {
  decision: Record<string, JsonValue>;
  pspResult: Record<string, JsonValue>;
  receiptBody: Record<string, JsonValue>;
};

export interface RecordOutcomeInput {
  idempotency_key: string | null;
  result: ExecutePaymentResult;
  signed_entry: SignedReceiptEntry;
}

export interface RecourseDatabase {
  intents: {
    saveIntent(contract: Contract): Promise<void>;
    getIntentById(intentId: string): Promise<Contract | null>;
  };
  receipts: {
    recordOutcome(input: RecordOutcomeInput): Promise<void>;
    getOutcomeByIdempotencyKey(
      idempotencyKey: string,
    ): Promise<ExecutePaymentResult | null>;
    getReceiptById(receiptId: string): Promise<SignedReceiptEntry | null>;
    listReceipts(): Promise<SignedReceiptEntry[]>;
  };
  close(): void;
}

type IntentRow = {
  canonical_intent_json: string;
};

type SignedReceiptRow = {
  signed_entry_json: string;
};

type OutcomeRow = {
  outcome_json: string;
};

type ExistingRow = {
  receipt_id: string;
};

type MaxSequenceRow = {
  max_sequence: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RecourseDatabaseError(
      "INVALID_SIGNED_ENTRY",
      `Signed receipt is missing required string field: ${field}`,
    );
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intent_contracts (
      intent_id TEXT PRIMARY KEY,
      family_id TEXT,
      version INTEGER,
      owner_payer_id TEXT,
      budget_max_cents INTEGER,
      per_order_cap_cents INTEGER,
      status TEXT,
      expires_at TEXT,
      intent_hash TEXT NOT NULL,
      canonical_intent_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signed_receipts (
      sequence INTEGER NOT NULL UNIQUE,
      receipt_id TEXT PRIMARY KEY,
      contract_id TEXT,
      payment_id TEXT,
      verdict TEXT NOT NULL,
      capture_id TEXT UNIQUE,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      signature TEXT NOT NULL,
      signed_entry_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_signed_receipts_contract_id
      ON signed_receipts(contract_id);

    CREATE TABLE IF NOT EXISTS payment_outcomes (
      idempotency_key TEXT UNIQUE,
      receipt_id TEXT NOT NULL UNIQUE
        REFERENCES signed_receipts(receipt_id) ON DELETE RESTRICT,
      verdict TEXT NOT NULL,
      psp_status TEXT,
      capture_id TEXT,
      outcome_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  db.prepare(
    "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
  ).run(1, new Date().toISOString());
}

export function createRecourseDatabase(options: {
  path: string;
}): RecourseDatabase {
  if (!options || typeof options.path !== "string" || options.path.length === 0) {
    throw new RecourseDatabaseError(
      "INVALID_OUTCOME",
      "createRecourseDatabase requires a non-empty path",
    );
  }

  const db = new DatabaseSync(options.path);
  let closed = false;

  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);

  function assertOpen(): void {
    if (closed) {
      throw new RecourseDatabaseError(
        "DATABASE_CLOSED",
        "Recourse database is closed",
      );
    }
  }

  return {
    intents: {
      async saveIntent(contract: Contract): Promise<void> {
        assertOpen();

        const parsed = ContractSchema.parse(contract);
        const canonical = canonicalJson(parsed as unknown as JsonValue);

        const existing = db
          .prepare(
            "SELECT canonical_intent_json FROM intent_contracts WHERE intent_id = ?",
          )
          .get(parsed.id) as unknown as IntentRow | undefined;

        if (existing) {
          if (existing.canonical_intent_json !== canonical) {
            throw new RecourseDatabaseError(
              "INTENT_CONFLICT",
              `Intent contract already exists with different contents: ${parsed.id}`,
            );
          }
          return;
        }

        db.prepare(
          `
          INSERT INTO intent_contracts (
            intent_id,
            family_id,
            version,
            owner_payer_id,
            budget_max_cents,
            per_order_cap_cents,
            status,
            expires_at,
            intent_hash,
            canonical_intent_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          parsed.id,
          parsed.family_id,
          parsed.version,
          parsed.owner_payer_id,
          parsed.budget_max_cents,
          parsed.per_order_cap_cents,
          parsed.status,
          parsed.expires_at,
          parsed.hash,
          canonical,
          new Date().toISOString(),
        );
      },

      async getIntentById(intentId: string): Promise<Contract | null> {
        assertOpen();

        if (typeof intentId !== "string" || intentId.length === 0) {
          return null;
        }

        const row = db
          .prepare(
            "SELECT canonical_intent_json FROM intent_contracts WHERE intent_id = ?",
          )
          .get(intentId) as unknown as IntentRow | undefined;

        if (!row) {
          return null;
        }

        return ContractSchema.parse(JSON.parse(row.canonical_intent_json));
      },
    },

    receipts: {
      async recordOutcome(input: RecordOutcomeInput): Promise<void> {
        assertOpen();

        if (!isRecord(input)) {
          throw new RecourseDatabaseError(
            "INVALID_OUTCOME",
            "recordOutcome input must be an object",
          );
        }

        const { idempotency_key, result, signed_entry } = input;

        if (
          idempotency_key !== null &&
          (typeof idempotency_key !== "string" || idempotency_key.length === 0)
        ) {
          throw new RecourseDatabaseError(
            "INVALID_OUTCOME",
            "idempotency_key must be a non-empty string or null",
          );
        }

        if (
          !isRecord(result) ||
          !isRecord(result.decision) ||
          !isRecord(result.pspResult) ||
          !isRecord(result.receiptBody)
        ) {
          throw new RecourseDatabaseError(
            "INVALID_OUTCOME",
            "result must contain decision, pspResult, and receiptBody objects",
          );
        }

        if (
          !isRecord(signed_entry) ||
          !isRecord(signed_entry.receipt) ||
          typeof signed_entry.signature !== "string" ||
          signed_entry.signature.length === 0
        ) {
          throw new RecourseDatabaseError(
            "INVALID_SIGNED_ENTRY",
            "signed_entry must contain a receipt object and signature",
          );
        }

        const receipt = signed_entry.receipt as Record<string, unknown>;

        const receiptId = requiredString(receipt.receipt_id, "receipt_id");
        const prevHash = requiredString(receipt.prev_hash, "prev_hash");
        const hash = requiredString(receipt.hash, "hash");
        const verdict = requiredString(
          receipt.verdict ?? result.decision.verdict,
          "verdict",
        );

                const resultReceiptId =
          typeof result.receiptBody.receipt_id === "string"
            ? result.receiptBody.receipt_id
            : null;

        const captureId =
          receipt.capture_id === null || typeof receipt.capture_id === "string"
            ? (receipt.capture_id as string | null)
            : null;

        const contractId = nullableString(receipt.contract_id);
        const paymentId = nullableString(receipt.payment_id);
        const pspStatus =
          typeof result.pspResult.status === "string"
            ? result.pspResult.status
            : null;

        const signedEntryJson = canonicalJson(
          signed_entry as unknown as JsonValue,
        );
        const outcomeJson = canonicalJson(result as unknown as JsonValue);
        const now = new Date().toISOString();

        db.exec("BEGIN IMMEDIATE");
        try {
          if (idempotency_key !== null) {
            const existingOutcome = db
              .prepare(
                "SELECT receipt_id FROM payment_outcomes WHERE idempotency_key = ?",
              )
              .get(idempotency_key) as unknown as ExistingRow | undefined;

            if (existingOutcome) {
              throw new RecourseDatabaseError(
                "DUPLICATE_IDEMPOTENCY_KEY",
                `Outcome already recorded for idempotency key: ${idempotency_key}`,
              );
            }
          }

          const existingReceipt = db
            .prepare(
              "SELECT receipt_id FROM signed_receipts WHERE receipt_id = ?",
            )
            .get(receiptId) as unknown as ExistingRow | undefined;

          if (existingReceipt) {
            throw new RecourseDatabaseError(
              "DUPLICATE_RECEIPT",
              `Signed receipt already recorded: ${receiptId}`,
            );
          }
          if (resultReceiptId !== receiptId) {
            throw new RecourseDatabaseError(
              "INVALID_SIGNED_ENTRY",
              "signed_entry receipt_id must match result.receiptBody.receipt_id",
            );
          }
          const maxRow = db
            .prepare(
              "SELECT COALESCE(MAX(sequence), 0) AS max_sequence FROM signed_receipts",
            )
            .get() as unknown as MaxSequenceRow;

          const sequence = Number(maxRow.max_sequence) + 1;

          db.prepare(
            `
            INSERT INTO signed_receipts (
              sequence,
              receipt_id,
              contract_id,
              payment_id,
              verdict,
              capture_id,
              prev_hash,
              hash,
              signature,
              signed_entry_json,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          ).run(
            sequence,
            receiptId,
            contractId,
            paymentId,
            verdict,
            captureId,
            prevHash,
            hash,
            signed_entry.signature,
            signedEntryJson,
            now,
          );

          db.prepare(
            `
            INSERT INTO payment_outcomes (
              idempotency_key,
              receipt_id,
              verdict,
              psp_status,
              capture_id,
              outcome_json,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
          ).run(
            idempotency_key,
            receiptId,
            verdict,
            pspStatus,
            captureId,
            outcomeJson,
            now,
          );

          db.exec("COMMIT");
        } catch (error) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // Preserve the original error.
          }

          if (error instanceof RecourseDatabaseError) {
            throw error;
          }

          const message = error instanceof Error ? error.message : String(error);

          if (message.includes("payment_outcomes.idempotency_key")) {
            throw new RecourseDatabaseError(
              "DUPLICATE_IDEMPOTENCY_KEY",
              `Outcome already recorded for idempotency key: ${idempotency_key}`,
            );
          }

          if (
            message.includes("signed_receipts.receipt_id") ||
            message.includes("payment_outcomes.receipt_id")
          ) {
            throw new RecourseDatabaseError(
              "DUPLICATE_RECEIPT",
              `Signed receipt already recorded: ${receiptId}`,
            );
          }

          throw error;
        }
      },

      async getOutcomeByIdempotencyKey(
        idempotencyKey: string,
      ): Promise<ExecutePaymentResult | null> {
        assertOpen();

        if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
          return null;
        }

        const row = db
          .prepare(
            "SELECT outcome_json FROM payment_outcomes WHERE idempotency_key = ?",
          )
          .get(idempotencyKey) as unknown as OutcomeRow | undefined;

        if (!row) {
          return null;
        }

        return JSON.parse(row.outcome_json) as ExecutePaymentResult;
      },

      async getReceiptById(
        receiptId: string,
      ): Promise<SignedReceiptEntry | null> {
        assertOpen();

        if (typeof receiptId !== "string" || receiptId.length === 0) {
          return null;
        }

        const row = db
          .prepare(
            "SELECT signed_entry_json FROM signed_receipts WHERE receipt_id = ?",
          )
          .get(receiptId) as unknown as SignedReceiptRow | undefined;

        if (!row) {
          return null;
        }

        return JSON.parse(row.signed_entry_json) as SignedReceiptEntry;
      },

      async listReceipts(): Promise<SignedReceiptEntry[]> {
        assertOpen();

        const rows = db
          .prepare(
            "SELECT signed_entry_json FROM signed_receipts ORDER BY sequence ASC",
          )
          .all() as unknown as SignedReceiptRow[];

        return rows.map(
          (row) => JSON.parse(row.signed_entry_json) as SignedReceiptEntry,
        );
      },
    },

    close(): void {
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  };
}