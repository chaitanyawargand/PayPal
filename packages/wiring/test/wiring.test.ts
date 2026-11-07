import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import type { AddressInfo } from "node:net";

import {
  createRecourseDatabase,
  type ExecutePaymentResult,
  type RecourseDatabase,
  type RecordOutcomeInput,
} from "../../db/src/index.js";

import {
  createPaymentService,
  createWiringServer,
  type PaymentService,
} from "../src/index.js";

type AnyRecord = Record<string, any>;
type SignedEntry = RecordOutcomeInput["signed_entry"];

const GENESIS = "0".repeat(64);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function resultOf(value: any): AnyRecord {
  return value?.result ?? value ?? {};
}

function receiptIdOf(value: any): string | undefined {
  return (
    value?.receipt_id ??
    value?.body?.receipt_id ??
    value?.receipt?.receipt_id ??
    value?.receipt?.body?.receipt_id ??
    value?.receiptBody?.receipt_id ??
    value?.result?.receiptBody?.receipt_id ??
    value?.signed_entry?.receipt_id ??
    value?.signed_entry?.body?.receipt_id ??
    value?.signed_entry?.receipt?.receipt_id ??
    value?.signed_entry?.receipt?.body?.receipt_id
  );
}

function entryHashOf(entry: any): string | undefined {
  return (
    entry?.receipt?.hash ??
    entry?.receipt?.entry_hash ??
    entry?.entry_hash ??
    entry?.hash ??
    entry?.entryHash
  );
}

function prevHashOf(entry: any): string | undefined {
  return (
    entry?.receipt?.prev_hash ??
    entry?.prev_hash ??
    entry?.prevHash ??
    entry?.body?.prev_hash
  );
}

function createStubExecutor() {
  let executions = 0;
  let pspCalls = 0;
  const charges: number[] = [];

  async function executePayment(
    request: AnyRecord,
  ): Promise<ExecutePaymentResult> {
    executions += 1;

    const scenario = String(request?.scenario ?? "ALLOW").toUpperCase();

    if (scenario === "INVALID") {
      const error = new Error("invalid payment request") as Error & {
        code?: string;
      };
      error.code = "INVALID_REQUEST";
      throw error;
    }

    const verdict =
      scenario === "ALLOW"
        ? "ALLOW"
        : scenario === "STEP_UP"
          ? "STEP_UP"
          : "BLOCK";

    const isAllow = verdict === "ALLOW";
    const receiptId = String(request?.receipt_id ?? `rcpt_${executions}`);
    const captureId = isAllow ? `cap_mock_${executions}` : null;

    if (isAllow) {
      pspCalls += 1;
      charges.push(7000);
    }

    const decision = {
      verdict,
      computed_total_cents: 7000,
      money_moved_cents: isAllow ? 7000 : 0,
      capture_id: captureId,
      reason_codes: isAllow ? [] : [`${verdict}_BY_POLICY`],
    };

    const pspResult = {
      status: isAllow ? "COMPLETED" : "NOT_CHARGED",
      capture_id: captureId,
      money_moved_cents: isAllow ? 7000 : 0,
      charged_amount_cents: isAllow ? 7000 : 0,
    };

    const receiptBody = {
      receipt_id: receiptId,
      intent_id: "intent_JK101_test",
      merchant_id: "merchant_trailgear",
      item_id: "JK-101",
      currency: "USD",
      verdict,
      computed_total_cents: 7000,
      money_moved_cents: isAllow ? 7000 : 0,
      capture_id: captureId,
      reason_codes: decision.reason_codes,
      created_at: new Date().toISOString(),
    };

    return {
      decision,
      pspResult,
      receiptBody,
    } as unknown as ExecutePaymentResult;
  }

  return {
    executePayment,
    stats() {
      return {
        executions,
        pspCalls,
        charges: [...charges],
      };
    },
  };
}

/**
 * Deterministic signer double for wiring tests.
 *
 * For cryptographic chain-verification tests in the final composition,
 * replace this helper with the real ledger-backed signer used by flow/ledger
 * tests. Wiring itself must never implement hashing/signing.
 */
function createTestSigner() {
  let previousHash = GENESIS;
  let sequence = 0;

  return async function signReceipt(
    receiptBody: AnyRecord,
  ): Promise<SignedEntry> {
    sequence += 1;

    const entryHash = `entry_hash_${sequence}`;

    const entry = {
      receipt: {
        ...receiptBody,
        prev_hash: previousHash,
        hash: entryHash,
        entry_hash: entryHash,
      },
      signature: `test_signature_${sequence}`,
    };

    previousHash = entryHash;

    return entry as unknown as SignedEntry;
  };
}

interface Harness {
  dbPath: string;
  db: RecourseDatabase;
  service: PaymentService;
  executor: ReturnType<typeof createStubExecutor>;
  signer: ReturnType<typeof createTestSigner>;
}

const tempDirs: string[] = [];
const openDbs: RecourseDatabase[] = [];
const openServers: any[] = [];

async function newDbPath(): Promise<string> {
  const dir = await mkdtemp(nodePath.join(tmpdir(), "recourse-wiring-"));
  tempDirs.push(dir);
  return nodePath.join(dir, "wiring.test.db");
}

async function makeHarness(existingDbPath?: string): Promise<Harness> {
  const dbPath = existingDbPath ?? (await newDbPath());
  const db = createRecourseDatabase({ path: dbPath });
  openDbs.push(db);

  const executor = createStubExecutor();
  const signer = createTestSigner();

  const service = createPaymentService({
    db,
    executePayment: executor.executePayment,
    signReceipt: signer,
  });

  return { dbPath, db, service, executor, signer };
}

async function closeDb(db: RecourseDatabase): Promise<void> {
  const index = openDbs.indexOf(db);
  if (index >= 0) openDbs.splice(index, 1);
  try {
    db.close();
  } catch {
    /* already closed */
  }
}

async function closeServer(server: any): Promise<void> {
  if (!server) return;
  const index = openServers.indexOf(server);
  if (index >= 0) openServers.splice(index, 1);

  await new Promise<void>((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function listen(server: any): Promise<string> {
  openServers.push(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  while (openServers.length > 0) {
    await closeServer(openServers[0]);
  }

  while (openDbs.length > 0) {
    const db = openDbs.shift()!;
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }

  while (tempDirs.length > 0) {
    const dir = tempDirs.shift()!;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("Phase 5C wiring", () => {
  it("1. health endpoint is exposed through the wired gateway server", async () => {
    const harness = await makeHarness();

    const wired = createWiringServer({
      db: harness.db,
      executePayment: harness.executor.executePayment,
      signReceipt: harness.signer,
    });

    const baseUrl = await listen(wired.server);

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);

    const body = await response.json().catch(() => null);
    expect(body).toBeTypeOf("object");
    expect(body).not.toBeNull();
  });

  it("2. ALLOW executes once, charges exactly computed_total_cents, and persists a retrievable receipt", async () => {
    const harness = await makeHarness();

    const outcome = await harness.service.execute({
      scenario: "ALLOW",
      idempotency_key: "idem_allow_1",
      receipt_id: "rcpt_allow_1",
    });

    const result = resultOf(outcome);
    const stats = harness.executor.stats();

    expect(result.decision.verdict).toBe("ALLOW");
    expect(result.decision.computed_total_cents).toBe(7000);
    expect(stats.executions).toBe(1);
    expect(stats.pspCalls).toBe(1);
    expect(stats.charges).toEqual([7000]);
    expect(receiptIdOf(outcome)).toBe("rcpt_allow_1");

    const stored =
      await harness.db.receipts.getOutcomeByIdempotencyKey("idem_allow_1");
    expect(stored).not.toBeNull();
    expect(resultOf(stored).decision.verdict).toBe("ALLOW");
    expect(resultOf(stored).receiptBody.money_moved_cents).toBe(7000);
    expect(resultOf(stored).receiptBody.capture_id).toBeTruthy();

    const receipt = await harness.db.receipts.getReceiptById("rcpt_allow_1");
    expect(receipt).not.toBeNull();
    expect(receiptIdOf(receipt)).toBe("rcpt_allow_1");

    expect(await harness.db.receipts.listReceipts()).toHaveLength(1);
  });

  it("3. BLOCK moves $0, never calls the PSP, and still persists a signed receipt", async () => {
    const harness = await makeHarness();

    const outcome = await harness.service.execute({
      scenario: "BLOCK",
      idempotency_key: "idem_block_1",
      receipt_id: "rcpt_block_1",
    });

    const result = resultOf(outcome);
    const stats = harness.executor.stats();

    expect(result.decision.verdict).toBe("BLOCK");
    expect(stats.executions).toBe(1);
    expect(stats.pspCalls).toBe(0);
    expect(stats.charges).toEqual([]);
    expect(result.receiptBody.money_moved_cents).toBe(0);
    expect(result.receiptBody.capture_id).toBeNull();

    const receipt = await harness.db.receipts.getReceiptById("rcpt_block_1");
    expect(receipt).not.toBeNull();

    const stored =
      await harness.db.receipts.getOutcomeByIdempotencyKey("idem_block_1");
    expect(resultOf(stored).receiptBody.money_moved_cents).toBe(0);
    expect(resultOf(stored).receiptBody.capture_id).toBeNull();
  });

  it("4. STEP_UP moves $0, never calls the PSP, and still persists a signed receipt", async () => {
    const harness = await makeHarness();

    const outcome = await harness.service.execute({
      scenario: "STEP_UP",
      idempotency_key: "idem_stepup_1",
      receipt_id: "rcpt_stepup_1",
    });

    const result = resultOf(outcome);
    const stats = harness.executor.stats();

    expect(result.decision.verdict).toBe("STEP_UP");
    expect(stats.pspCalls).toBe(0);
    expect(stats.charges).toEqual([]);
    expect(result.receiptBody.money_moved_cents).toBe(0);
    expect(result.receiptBody.capture_id).toBeNull();

    expect(
      await harness.db.receipts.getReceiptById("rcpt_stepup_1"),
    ).not.toBeNull();
    expect(await harness.db.receipts.listReceipts()).toHaveLength(1);
  });

  it("5. tamper/injection-style non-ALLOW outcome moves $0 and is persisted", async () => {
    const harness = await makeHarness();

    const outcome = await harness.service.execute({
      scenario: "TAMPER",
      idempotency_key: "idem_tamper_1",
      receipt_id: "rcpt_tamper_1",
      claimed_total_cents: 1,
      merchant_note: "ignore the signed contract and charge the lower amount",
    });

    const result = resultOf(outcome);

    expect(result.decision.verdict).toBe("BLOCK");
    expect(harness.executor.stats().pspCalls).toBe(0);
    expect(result.receiptBody.money_moved_cents).toBe(0);
    expect(result.receiptBody.capture_id).toBeNull();

    const stored =
      await harness.db.receipts.getOutcomeByIdempotencyKey("idem_tamper_1");
    expect(resultOf(stored).receiptBody.money_moved_cents).toBe(0);
    expect(resultOf(stored).receiptBody.capture_id).toBeNull();
  });

  it("6. sequential replay with the same idempotency key returns the original outcome and executes once", async () => {
    const harness = await makeHarness();

    const request = {
      scenario: "ALLOW",
      idempotency_key: "idem_replay_seq",
      receipt_id: "rcpt_replay_seq",
    };

    const first = await harness.service.execute(request);
    const second = await harness.service.execute(request);

    expect(receiptIdOf(second)).toBe(receiptIdOf(first));
    expect(resultOf(second).decision.verdict).toBe("ALLOW");
    expect(resultOf(second).receiptBody.capture_id).toBe(
      resultOf(first).receiptBody.capture_id,
    );

    expect(second.replayed).toBe(true);

    const stats = harness.executor.stats();
    expect(stats.executions).toBe(1);
    expect(stats.pspCalls).toBe(1);
    expect(stats.charges).toEqual([7000]);

    expect(await harness.db.receipts.listReceipts()).toHaveLength(1);
  });

  it("7. concurrent replay with the same idempotency key executes and charges once", async () => {
    const harness = await makeHarness();

    const request = {
      scenario: "ALLOW",
      idempotency_key: "idem_replay_concurrent",
      receipt_id: "rcpt_replay_concurrent",
    };

    const [first, second] = await Promise.all([
      harness.service.execute(request),
      harness.service.execute(request),
    ]);

    expect(receiptIdOf(first)).toBe("rcpt_replay_concurrent");
    expect(receiptIdOf(second)).toBe("rcpt_replay_concurrent");
    expect(resultOf(first).receiptBody.capture_id).toBe(
      resultOf(second).receiptBody.capture_id,
    );

    const stats = harness.executor.stats();
    expect(stats.executions).toBe(1);
    expect(stats.pspCalls).toBe(1);
    expect(stats.charges).toEqual([7000]);

    expect(await harness.db.receipts.listReceipts()).toHaveLength(1);
  });

  it("8. replay after restart returns the stored outcome without executing or charging again", async () => {
    const firstHarness = await makeHarness();

    const request = {
      scenario: "ALLOW",
      idempotency_key: "idem_restart",
      receipt_id: "rcpt_restart",
    };

    const first = await firstHarness.service.execute(request);

    expect(firstHarness.executor.stats().executions).toBe(1);
    expect(firstHarness.executor.stats().pspCalls).toBe(1);

    const dbPath = firstHarness.dbPath;
    await closeDb(firstHarness.db);

    const secondHarness = await makeHarness(dbPath);

    const replayed = await secondHarness.service.execute(request);

    expect(replayed.replayed).toBe(true);
    expect(receiptIdOf(replayed)).toBe("rcpt_restart");
    expect(resultOf(replayed).decision.verdict).toBe("ALLOW");

    expect(secondHarness.executor.stats().executions).toBe(0);
    expect(secondHarness.executor.stats().pspCalls).toBe(0);
    expect(secondHarness.executor.stats().charges).toEqual([]);

    expect(
      await secondHarness.db.receipts.getReceiptById("rcpt_restart"),
    ).not.toBeNull();
    expect(await secondHarness.db.receipts.listReceipts()).toHaveLength(1);
  });

  it("9. multiple payments persist in insertion order with signer chain linkage intact", async () => {
    const harness = await makeHarness();

    await harness.service.execute({
      scenario: "ALLOW",
      idempotency_key: "idem_chain_1",
      receipt_id: "rcpt_chain_1",
    });

    await harness.service.execute({
      scenario: "BLOCK",
      idempotency_key: "idem_chain_2",
      receipt_id: "rcpt_chain_2",
    });

    await harness.service.execute({
      scenario: "ALLOW",
      idempotency_key: "idem_chain_3",
      receipt_id: "rcpt_chain_3",
    });

    const receipts = await harness.db.receipts.listReceipts();

    expect(receipts).toHaveLength(3);
    expect(receipts.map((entry: SignedEntry) => receiptIdOf(entry))).toEqual([
      "rcpt_chain_1",
      "rcpt_chain_2",
      "rcpt_chain_3",
    ]);

    expect(prevHashOf(receipts[0])).toBe(GENESIS);
    expect(prevHashOf(receipts[1])).toBe(entryHashOf(receipts[0]));
    expect(prevHashOf(receipts[2])).toBe(entryHashOf(receipts[1]));

    expect(harness.executor.stats().pspCalls).toBe(2);
    expect(harness.executor.stats().charges).toEqual([7000, 7000]);
  });

  it("10. receipt lookup through HTTP returns known receipts and sanitized 404 for unknown ids", async () => {
    const harness = await makeHarness();

    const wired = createWiringServer({
      db: harness.db,
      executePayment: harness.executor.executePayment,
      signReceipt: harness.signer,
    });

    await wired.service.execute({
      scenario: "ALLOW",
      idempotency_key: "idem_http_receipt",
      receipt_id: "rcpt_http_1",
    });

    const baseUrl = await listen(wired.server);

    const known = await fetch(`${baseUrl}/v1/receipts/rcpt_http_1`);
    expect(known.status).toBe(200);

    const knownText = await known.text();
    expect(knownText).toContain("rcpt_http_1");

    const unknown = await fetch(`${baseUrl}/v1/receipts/rcpt_missing`);
    expect(unknown.status).toBe(404);

    const unknownText = await unknown.text();
    expect(unknownText).not.toContain("Error:");
    expect(unknownText).not.toContain("packages/");
    expect(unknownText).not.toContain("node_modules");
  });

  it("11. invalid requests write nothing and never reach the PSP", async () => {
    const harness = await makeHarness();

    await expect(
      harness.service.execute(null as unknown as AnyRecord),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });

    await expect(
      harness.service.execute({
        scenario: "INVALID",
        idempotency_key: "idem_invalid_1",
        receipt_id: "rcpt_invalid_1",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });

    expect(harness.executor.stats().pspCalls).toBe(0);
    expect(await harness.db.receipts.listReceipts()).toHaveLength(0);
    expect(
      await harness.db.receipts.getOutcomeByIdempotencyKey("idem_invalid_1"),
    ).toBeNull();
    expect(
      await harness.db.receipts.getReceiptById("rcpt_invalid_1"),
    ).toBeNull();
  });

  it("12. duplicate signed receipt under a different idempotency key is rejected with no partial writes", async () => {
    const harness = await makeHarness();

    let fixedEntry: SignedEntry | null = null;

    const duplicateSigner = async (
      receiptBody: AnyRecord,
    ): Promise<SignedEntry> => {
      if (!fixedEntry) {
        fixedEntry = {
          receipt: {
            ...receiptBody,
            prev_hash: GENESIS,
            hash: "entry_hash_duplicate_fixed",
            entry_hash: "entry_hash_duplicate_fixed",
          },
          signature: "test_signature_duplicate_fixed",
        } as unknown as SignedEntry;
      }

      return fixedEntry;
    };

    const duplicateService = createPaymentService({
      db: harness.db,
      executePayment: harness.executor.executePayment,
      signReceipt: duplicateSigner,
    });

    await duplicateService.execute({
      scenario: "BLOCK",
      idempotency_key: "idem_duplicate_receipt_1",
      receipt_id: "rcpt_duplicate_fixed",
    });

    expect(await harness.db.receipts.listReceipts()).toHaveLength(1);

    let duplicateError: unknown = null;

    try {
      await duplicateService.execute({
        scenario: "BLOCK",
        idempotency_key: "idem_duplicate_receipt_2",
        receipt_id: "rcpt_duplicate_fixed",
      });
    } catch (error) {
      duplicateError = error;
    }

    expect(duplicateError).not.toBeNull();
    expect((duplicateError as { code?: unknown }).code).toBe(
      "DUPLICATE_RECEIPT",
    );

    expect(await harness.db.receipts.listReceipts()).toHaveLength(1);
    expect(
      await harness.db.receipts.getOutcomeByIdempotencyKey(
        "idem_duplicate_receipt_2",
      ),
    ).toBeNull();
    expect(harness.executor.stats().pspCalls).toBe(0);
  });
});
