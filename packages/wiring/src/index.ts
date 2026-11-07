import type {
  ExecutePaymentResult,
  RecourseDatabase,
  RecordOutcomeInput,
} from "../../db/src/index.js";

import { createGatewayServer } from "../../gateway/src/index.js";

export type SignedReceiptEntry = RecordOutcomeInput["signed_entry"];

export interface PaymentRequest {
  idempotency_key?: string | null;
  idempotencyKey?: string | null;
  [key: string]: unknown;
}

export type ExecutePaymentFn = (
  request: PaymentRequest,
) => Promise<ExecutePaymentResult>;

export type SignReceiptFn = (
  receiptBody: ExecutePaymentResult["receiptBody"],
) => Promise<SignedReceiptEntry> | SignedReceiptEntry;

export interface WiringDeps {
  db: RecourseDatabase;
  executePayment: ExecutePaymentFn;
  signReceipt: SignReceiptFn;
}

export interface PaymentServiceOutcome {
  result: ExecutePaymentResult;
  signed_entry: SignedReceiptEntry | null;
  replayed: boolean;
}

export interface PaymentService {
  execute(request: PaymentRequest): Promise<PaymentServiceOutcome>;
  getReceiptById(receiptId: string): Promise<SignedReceiptEntry | null>;
  listReceipts(): Promise<SignedReceiptEntry[]>;
}

export class WiringError extends Error {
  readonly code: string;
  override cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "WiringError";
    this.code = code;
    this.cause = cause;
  }
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function normalizeIdempotencyKey(request: PaymentRequest): string | null {
  const raw = request.idempotency_key ?? request.idempotencyKey;

  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unwrapStoredOutcome(stored: unknown): PaymentServiceOutcome | null {
  if (!stored || typeof stored !== "object") return null;

  const record = stored as Record<string, any>;

  const result =
    record.result ??
    (record.decision && record.pspResult && record.receiptBody
      ? {
          decision: record.decision,
          pspResult: record.pspResult,
          receiptBody: record.receiptBody,
        }
      : null);

  if (!result) return null;

  return {
    result: result as ExecutePaymentResult,
    signed_entry: (record.signed_entry ??
      record.signedEntry ??
      null) as SignedReceiptEntry | null,
    replayed: true,
  };
}

export function createPaymentService(deps: WiringDeps): PaymentService {
  const inFlight = new Map<string, Promise<PaymentServiceOutcome>>();

  async function executeOnce(
    request: PaymentRequest,
    idempotencyKey: string | null,
  ): Promise<PaymentServiceOutcome> {
    if (idempotencyKey) {
      const stored =
        await deps.db.receipts.getOutcomeByIdempotencyKey(idempotencyKey);
      const replayed = unwrapStoredOutcome(stored);

      if (replayed) {
        return replayed;
      }
    }

    const result = await deps.executePayment(request);

    if (!result || typeof result !== "object" || !result.receiptBody) {
      throw new WiringError(
        "INVALID_EXECUTION_RESULT",
        "executePayment returned an invalid result",
      );
    }

    const signedEntry = await deps.signReceipt(result.receiptBody);

    if (!signedEntry || typeof signedEntry !== "object") {
      throw new WiringError(
        "INVALID_SIGNED_RECEIPT",
        "signReceipt returned an invalid signed receipt entry",
      );
    }

    try {
      await deps.db.receipts.recordOutcome({
        idempotency_key: idempotencyKey,
        result,
        signed_entry: signedEntry,
      });
    } catch (error) {
      const code = errorCode(error);

      if (code === "DUPLICATE_IDEMPOTENCY_KEY" && idempotencyKey) {
        const stored =
          await deps.db.receipts.getOutcomeByIdempotencyKey(idempotencyKey);
        const replayed = unwrapStoredOutcome(stored);

        if (replayed) {
          return replayed;
        }
      }

      if (code === "DUPLICATE_RECEIPT") {
        throw new WiringError(
          "DUPLICATE_RECEIPT",
          "duplicate signed receipt",
          error,
        );
      }

      throw error;
    }

    return {
      result,
      signed_entry: signedEntry,
      replayed: false,
    };
  }

  return {
    async execute(request: PaymentRequest): Promise<PaymentServiceOutcome> {
      if (!request || typeof request !== "object" || Array.isArray(request)) {
        throw new WiringError(
          "INVALID_REQUEST",
          "payment request must be an object",
        );
      }

      const idempotencyKey = normalizeIdempotencyKey(request);

      const normalizedRequest: PaymentRequest = {
        ...request,
        idempotency_key: idempotencyKey,
      };

      if (!idempotencyKey) {
        return executeOnce(normalizedRequest, null);
      }

      const existing = inFlight.get(idempotencyKey);
      if (existing) {
        return existing;
      }

      const promise = executeOnce(normalizedRequest, idempotencyKey);
      inFlight.set(idempotencyKey, promise);

      try {
        return await promise;
      } finally {
        if (inFlight.get(idempotencyKey) === promise) {
          inFlight.delete(idempotencyKey);
        }
      }
    },

    async getReceiptById(
      receiptId: string,
    ): Promise<SignedReceiptEntry | null> {
      return deps.db.receipts.getReceiptById(receiptId);
    },

    async listReceipts(): Promise<SignedReceiptEntry[]> {
      return deps.db.receipts.listReceipts();
    },
  };
}

export function createWiringServer(deps: WiringDeps) {
  const service = createPaymentService(deps);

  const server = createGatewayServer({
    executor: async (request: PaymentRequest) => {
      const outcome = await service.execute(request);
      return outcome.result;
    },

    receipts: {
      // createPaymentService.execute() already signed the receipt and
      // atomically persisted outcome + signed entry through db.receipts.
      // The gateway must not persist a second time.
      recordOutcome: async () => undefined,

      getOutcomeByIdempotencyKey: async (idempotencyKey: string) =>
        deps.db.receipts.getOutcomeByIdempotencyKey(idempotencyKey),

      getReceiptById: async (receiptId: string) =>
        service.getReceiptById(receiptId),

      listReceipts: async () => service.listReceipts(),
    },
  } as any);

  return {
    server,
    service,
  };
}
