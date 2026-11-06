import { createRecourseDatabase } from "../../db/src/index.js";
import type { ExecutePaymentResult, RecourseDatabase } from "../../db/src/index.js";
import { executePayment as executeFlowPayment } from "../../flow/src/execute.js";
import { createGatewayServer } from "../../gateway/src/index.js";
import {
  SignedReceiptLedger,
  verifySignedReceipts,
  type SignedReceiptEntry,
} from "../../ledger/src/store.js";
import { generateSigningKeyPair } from "../../ledger/src/sign.js";
import type { SigningKeyPair } from "../../ledger/src/sign.js";
import { MockPsp } from "../../psp/src/mock.js";
import { createPaymentService } from "../../wiring/src/index.js";
import type { PaymentRequest, PaymentService } from "../../wiring/src/index.js";
import * as http from "node:http";
import { handleEvidenceVerify } from "./evidence.js";
import { renderRecourseUiHtml } from "./ui.js";

const GENESIS_PREV_HASH = "0".repeat(64);

export interface CreateAppOptions {
  dbPath: string;
  psp?: MockPsp;
  signingKeyPair?: SigningKeyPair;
}

export interface RecourseAppStatus {
  service: "recourse-app";
  mode: "MOCK";
  real_money: false;
  safety_label: string;
  psp: "MockPsp";
  psp_tier: "C";
  judge: "DISCONNECTED";
  receipt_count: number;
  chain_verified: boolean;
  signing_public_key_pem: string;
}

export interface RecourseApp {
  status(): Promise<RecourseAppStatus>;
  server: http.Server;
  service: PaymentService;
  db: RecourseDatabase;
  psp: MockPsp;
  ledger: SignedReceiptLedger;
  publicKeyPem: string;
  close(): Promise<void>;
}

// Engine Decision.layer_results carry `reason: undefined` on passing checks.
// canonicalJson (used by DB persistence) rejects undefined; JSON semantics
// would drop those keys anyway. Normalize once at this composition boundary.
function sanitizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (entryValue === undefined) continue;
      result[key] = sanitizeJsonValue(entryValue);
    }
    return result;
  }
  return value;
}

// Gateway-validated bodies carry the idempotency key at payment.idempotency_key,
// while createPaymentService reads a top-level idempotency_key. Bridge that seam
// here so replay-once works for both HTTP and direct service callers.
function bridgeIdempotencyKey(request: PaymentRequest): PaymentRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return request;
  }

  const record = request as Record<string, any>;
  const payment =
    record.payment && typeof record.payment === "object" ? record.payment : {};

  const candidate = [
    record.idempotency_key,
    record.idempotencyKey,
    payment.idempotency_key,
  ].find((value) => typeof value === "string" && value.trim().length > 0);

  return {
    ...record,
    idempotency_key: typeof candidate === "string" ? candidate : null,
  };
}

export function createApp(options: CreateAppOptions): RecourseApp {
  if (!options || typeof options.dbPath !== "string" || options.dbPath.length === 0) {
    throw new Error("createApp requires a non-empty dbPath");
  }

  const db = createRecourseDatabase({ path: options.dbPath });
  const psp = options.psp ?? new MockPsp();
  const keys = options.signingKeyPair ?? generateSigningKeyPair();
  const ledger = new SignedReceiptLedger(keys);

  let chainRestorePromise: Promise<void> | undefined;

  async function restorePersistedChain(): Promise<void> {
    if (!chainRestorePromise) {
      chainRestorePromise = (async () => {
        const stored = await db.receipts.listReceipts();
        if (stored.length === 0) return;

        const byPrevHash = new Map<string, SignedReceiptEntry>();

        for (const entry of stored as SignedReceiptEntry[]) {
          const receipt: any = (entry as any)?.receipt;

          if (
            !receipt ||
            typeof receipt.prev_hash !== "string" ||
            typeof receipt.hash !== "string" ||
            byPrevHash.has(receipt.prev_hash)
          ) {
            throw new Error(
              "Cannot extend signed receipt chain: stored chain is malformed or forked",
            );
          }

          byPrevHash.set(receipt.prev_hash, entry);
        }

        const ordered: SignedReceiptEntry[] = [];
        let cursor = GENESIS_PREV_HASH;

        while (byPrevHash.has(cursor)) {
          const entry = byPrevHash.get(cursor)!;
          ordered.push(entry);
          cursor = entry.receipt.hash;
        }

        if (ordered.length !== stored.length) {
          throw new Error(
            "Cannot extend signed receipt chain: stored chain does not start at genesis or is incomplete",
          );
        }

        if (!verifySignedReceipts(ordered, keys.publicKeyPem)) {
          throw new Error(
            "Cannot extend signed receipt chain: stored chain failed verification",
          );
        }

        // SignedReceiptLedger exposes no restore/import seam. Seed its runtime
        // entry list once, only after the persisted chain verifies.
        const internals = ledger as unknown as {
          _entries: SignedReceiptEntry[];
        };
        internals._entries.splice(0, internals._entries.length, ...ordered);
      })();

      chainRestorePromise.catch(() => {
        chainRestorePromise = undefined;
      });
    }

    return chainRestorePromise;
  }

  async function buildStatus(): Promise<RecourseAppStatus> {
    const stored = await db.receipts.listReceipts();
    return {
      service: "recourse-app",
      mode: "MOCK",
      real_money: false,
      safety_label: "MOCK/SANDBOX - NO REAL MONEY",
      psp: "MockPsp",
      psp_tier: "C",
      judge: "DISCONNECTED",
      receipt_count: stored.length,
      chain_verified:
        stored.length === 0 ||
        verifySignedReceipts(stored as SignedReceiptEntry[], keys.publicKeyPem),
      signing_public_key_pem: keys.publicKeyPem,
    };
  }

  const rawService = createPaymentService({
    db,
    executePayment: async (request: PaymentRequest): Promise<ExecutePaymentResult> => {
      const req = request as Record<string, any>;
      const payment = req.payment as Record<string, any>;
      const receiptId =
        typeof req.receipt_id === "string" && req.receipt_id.length > 0
          ? req.receipt_id
          : `rcpt_${typeof payment?.idempotency_key === "string" ? payment.idempotency_key : "unknown"}`;

      const result = await executeFlowPayment({
        contract: req.contract,
        payment,
        spent_cents: typeof req.spent_cents === "number" ? req.spent_cents : 0,
        receipt_id: receiptId,
        psp,
      });

      return sanitizeJsonValue(result) as ExecutePaymentResult;
    },
    signReceipt: async (receiptBody) => {
      await restorePersistedChain();
      return ledger.append(receiptBody);
    },
  });

  const service: PaymentService = {
    execute: (request: PaymentRequest) =>
      rawService.execute(bridgeIdempotencyKey(request)),
    getReceiptById: (receiptId: string) => rawService.getReceiptById(receiptId),
    listReceipts: () => rawService.listReceipts(),
  };

  const server = createGatewayServer({
    executor: async (request: PaymentRequest) => {
      const outcome = await service.execute(request);
      return outcome.result;
    },
    receipts: {
      // service.execute() already signed the receipt and atomically persisted
      // outcome + signed entry through db.receipts. Never persist twice.
      recordOutcome: async () => undefined,
      getOutcomeByIdempotencyKey: async (idempotencyKey: string) =>
        db.receipts.getOutcomeByIdempotencyKey(idempotencyKey),
      getReceiptById: async (receiptId: string) => service.getReceiptById(receiptId),
      listReceipts: async () => service.listReceipts(),
    },
  } as any);

  const gatewayRequestListeners = server.listeners("request") as Array<
    (req: http.IncomingMessage, res: http.ServerResponse) => void
  >;
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    try {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname === "/" || pathname === "/index.html") {
        if (req.method !== "GET") {
          res.writeHead(405, {
            "content-type": "application/json",
            "cache-control": "no-store",
          });
          res.end(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
          return;
        }
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(renderRecourseUiHtml());
        return;
      }

      if (pathname === "/v1/app/status") {
        if (req.method !== "GET") {
          res.writeHead(405, {
            "content-type": "application/json",
            "cache-control": "no-store",
          });
          res.end(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
          return;
        }
        void buildStatus()
          .then((status) => {
            if (!res.headersSent) {
              res.writeHead(200, {
                "content-type": "application/json",
                "cache-control": "no-store",
              });
            }
            res.end(JSON.stringify(status));
          })
          .catch(() => {
            if (!res.headersSent) {
              res.writeHead(500, {
                "content-type": "application/json",
                "cache-control": "no-store",
              });
            }
            res.end(JSON.stringify({ error: "INTERNAL" }));
          });
        return;
      }

      if (pathname === "/v1/evidence/verify") {
        void handleEvidenceVerify(req, res);
        return;
      }
      for (const listener of gatewayRequestListeners) {
        listener.call(server, req, res);
      }
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
      }
      res.end(
        JSON.stringify({
          valid: false,
          checks: { chain: false, signatures: false },
          failures: ["INTERNAL"],
        }),
      );
    }
  });

  let closed = false;

  return {
    server,
    service,
    db,
    psp,
    ledger,
    publicKeyPem: keys.publicKeyPem,
    status: buildStatus,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      try {
        db.close();
      } catch {
        /* already closed */
      }
    },
  };
}
