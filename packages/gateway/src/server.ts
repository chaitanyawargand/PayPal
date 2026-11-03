import http from "node:http";
import crypto from "node:crypto";
import type {
  GatewayDeps,
  GatewayErrorCode,
  GatewayErrorResponse,
  ExecutePaymentResult,
} from "./types.js";
import {
  ExecutePaymentBodySchema,
  formatValidationIssues,
  type FormattedValidationIssue,
} from "./validation.js";

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB limit

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  data: unknown,
  requestId: string,
  additionalHeaders: Record<string, string> = {},
): void {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
    ...additionalHeaders,
  });
  res.end(payload);
}

function sendError(
  res: http.ServerResponse,
  statusCode: number,
  code: GatewayErrorCode,
  message: string,
  requestId: string,
  issues?: FormattedValidationIssue[],
  additionalHeaders: Record<string, string> = {},
): void {
  const envelope: GatewayErrorResponse = {
    error: {
      code,
      message,
      request_id: requestId,
      ...(issues && issues.length > 0 ? { issues } : {}),
    },
  };
  sendJson(res, statusCode, envelope, requestId, additionalHeaders);
}

function mapVerdictToStatus(verdict?: string): number {
  switch (verdict) {
    case "ALLOW":
      return 200;
    case "STEP_UP":
      return 202;
    case "BLOCK":
      return 422;
    default:
      return 200;
  }
}

function readBodyWithLimit(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<{ buffer: Buffer; exceeded: boolean }> {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks: Buffer[] = [];
    let exceeded = false;

    req.on("data", (chunk: Buffer) => {
      if (exceeded) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        exceeded = true;
        req.pause();
        // Drain any incoming data to avoid unhandled stream stalls
        req.on("data", () => {});
        resolve({ buffer: Buffer.alloc(0), exceeded: true });
      } else {
        chunks.push(chunk);
      }
    });

    req.on("end", () => {
      if (!exceeded) {
        resolve({ buffer: Buffer.concat(chunks), exceeded: false });
      }
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Creates the trusted Recourse Gateway HTTP server.
 * The server is returned NOT listening.
 */
export function createGatewayServer(deps: GatewayDeps): http.Server {
  return http.createServer(async (req, res) => {
    const requestId =
      (req.headers["x-request-id"] as string | undefined) ||
      crypto.randomUUID();

    try {
      const parsedUrl = new URL(req.url ?? "/", "http://localhost");
      const pathname = parsedUrl.pathname;
      const method = req.method ?? "GET";

      // 1. Health check route
      if (pathname === "/health") {
        if (method !== "GET") {
          return sendError(
            res,
            405,
            "METHOD_NOT_ALLOWED",
            `Method ${method} not allowed for /health`,
            requestId,
          );
        }
        return sendJson(res, 200, { status: "ok" }, requestId);
      }

      // 2. Receipt retrieval route: GET /v1/receipts/:receiptId
      const receiptMatch = pathname.match(/^\/v1\/receipts\/([^/]+)$/);
      if (receiptMatch) {
        if (method !== "GET") {
          return sendError(
            res,
            405,
            "METHOD_NOT_ALLOWED",
            `Method ${method} not allowed for /v1/receipts/:receiptId`,
            requestId,
          );
        }
        const receiptId = decodeURIComponent(receiptMatch[1]);
        const receipt = await deps.receipts.getReceiptById(receiptId);
        if (!receipt) {
          return sendError(
            res,
            404,
            "NOT_FOUND",
            `Receipt not found: ${receiptId}`,
            requestId,
          );
        }
        return sendJson(res, 200, receipt, requestId);
      }

      // 3. Main execute route: POST /v1/payments/execute
      if (pathname === "/v1/payments/execute") {
        if (method !== "POST") {
          return sendError(
            res,
            405,
            "METHOD_NOT_ALLOWED",
            `Method ${method} not allowed for /v1/payments/execute`,
            requestId,
          );
        }

        // Step 1: Content-Type check
        const contentType = req.headers["content-type"];
        if (
          !contentType ||
          !contentType.toLowerCase().includes("application/json")
        ) {
          return sendError(
            res,
            415,
            "UNSUPPORTED_MEDIA_TYPE",
            "Content-Type must be application/json",
            requestId,
          );
        }

        // Step 2: Read body with 1 MiB limit
        const { buffer, exceeded } = await readBodyWithLimit(
          req,
          MAX_BODY_BYTES,
        );
        if (exceeded) {
          return sendError(
            res,
            413,
            "PAYLOAD_TOO_LARGE",
            "Request payload exceeds 1 MiB limit",
            requestId,
          );
        }

        // Step 3: Parse JSON
        let rawJson: unknown;
        try {
          rawJson = JSON.parse(buffer.toString("utf-8"));
        } catch {
          return sendError(
            res,
            400,
            "BAD_JSON",
            "Malformed JSON payload",
            requestId,
          );
        }

        // Step 4: Validate with Zod
        const parseResult = ExecutePaymentBodySchema.safeParse(rawJson);
        if (!parseResult.success) {
          const issues = formatValidationIssues(parseResult.error.issues);
          return sendError(
            res,
            400,
            "VALIDATION_FAILED",
            "Request body failed validation",
            requestId,
            issues,
          );
        }

        const body = parseResult.data;
        const idempotencyKey =
          body.payment?.idempotency_key ??
          ((body as any).idempotency_key as string | undefined) ??
          null;

        // Step 5: Idempotent replay check
        if (idempotencyKey) {
          const storedOutcome =
            await deps.receipts.getOutcomeByIdempotencyKey(idempotencyKey);
          if (storedOutcome) {
            const status = mapVerdictToStatus(
              storedOutcome.decision?.verdict,
            );
            return sendJson(res, status, storedOutcome, requestId, {
              "Idempotent-Replay": "true",
            });
          }
        }

        // Step 6: Call executor exactly once
        let result: ExecutePaymentResult;
        try {
          result = await deps.executor(body);
        } catch {
          return sendError(
            res,
            500,
            "INTERNAL",
            "Internal payment execution error",
            requestId,
          );
        }

        // Step 7: Record outcome exactly once
        try {
          await deps.receipts.recordOutcome({
            idempotencyKey,
            result,
          });
        } catch {
          return sendError(
            res,
            500,
            "INTERNAL",
            "Internal error recording payment outcome",
            requestId,
          );
        }

        // Step 8: Return mapped decision status code and unmodified result
        const statusCode = mapVerdictToStatus(result.decision?.verdict);
        return sendJson(res, statusCode, result, requestId);
      }

      // 4. Any other route
      return sendError(
        res,
        404,
        "NOT_FOUND",
        `Route not found: ${method} ${pathname}`,
        requestId,
      );
    } catch {
      return sendError(
        res,
        500,
        "INTERNAL",
        "An unexpected error occurred",
        requestId,
      );
    }
  });
}

