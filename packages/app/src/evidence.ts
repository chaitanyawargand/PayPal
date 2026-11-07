import * as http from "node:http";
import { verifyReceiptChain } from "../../ledger/src/chain.js";
import { verifyReceiptSignature } from "../../ledger/src/sign.js";

const MAX_BODY_BYTES = 1024 * 1024;
const GENESIS_PREV_HASH = "0".repeat(64);

export interface EvidenceVerificationResult {
  valid: boolean;
  checks: {
    chain: boolean;
    signatures: boolean;
  };
  failures: string[];
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformedEvidence(): EvidenceVerificationResult {
  return {
    valid: false,
    checks: { chain: false, signatures: false },
    failures: ["MALFORMED_EVIDENCE"],
  };
}

export function verifyEvidencePack(input: unknown): EvidenceVerificationResult {
  if (!isRecord(input)) return malformedEvidence();

  const entries = input.entries;
  const publicKeyPem = input.public_key_pem ?? input.publicKeyPem;

  if (
    !Array.isArray(entries) ||
    entries.length === 0 ||
    typeof publicKeyPem !== "string" ||
    publicKeyPem.length === 0
  ) {
    return malformedEvidence();
  }

  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      !isRecord(entry.receipt) ||
      typeof entry.signature !== "string" ||
      entry.signature.length === 0 ||
      typeof entry.receipt.prev_hash !== "string" ||
      typeof entry.receipt.hash !== "string"
    ) {
      return malformedEvidence();
    }
  }

  const receipts = entries.map((entry) => entry.receipt);

  let chain = false;
  try {
    chain =
      receipts[0].prev_hash === GENESIS_PREV_HASH &&
      verifyReceiptChain(receipts as any);
  } catch {
    chain = false;
  }

  let signatures = false;
  try {
    signatures = entries.every((entry) =>
      verifyReceiptSignature(entry.receipt.hash, entry.signature, publicKeyPem),
    );
  } catch {
    signatures = false;
  }

  const failures: string[] = [];
  if (!chain) failures.push("CHAIN_INVALID");
  if (!signatures) failures.push("SIGNATURE_INVALID");

  return {
    valid: chain && signatures,
    checks: { chain, signatures },
    failures,
  };
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  result: EvidenceVerificationResult,
): void {
  if (res.writableEnded) return;
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(result));
}

function readBodyWithLimit(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<{ buffer: Buffer; exceeded: boolean }> {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    let exceeded = false;
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      if (exceeded) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        exceeded = true;
        req.pause();
        req.on("data", () => undefined);
        resolve({ buffer: Buffer.alloc(0), exceeded: true });
      } else {
        chunks.push(chunk);
      }
    });

    req.on("end", () => {
      if (!exceeded) resolve({ buffer: Buffer.concat(chunks), exceeded: false });
    });
    req.on("error", reject);
  });
}

export async function handleEvidenceVerify(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    if (req.method !== "POST") {
      return sendJson(res, 405, {
        valid: false,
        checks: { chain: false, signatures: false },
        failures: ["METHOD_NOT_ALLOWED"],
      });
    }

    const contentType = req.headers["content-type"];
    if (!contentType || !contentType.toLowerCase().includes("application/json")) {
      return sendJson(res, 415, {
        valid: false,
        checks: { chain: false, signatures: false },
        failures: ["UNSUPPORTED_MEDIA_TYPE"],
      });
    }

    const { buffer, exceeded } = await readBodyWithLimit(req, MAX_BODY_BYTES);
    if (exceeded) {
      return sendJson(res, 413, {
        valid: false,
        checks: { chain: false, signatures: false },
        failures: ["PAYLOAD_TOO_LARGE"],
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer.toString("utf8"));
    } catch {
      return sendJson(res, 400, {
        valid: false,
        checks: { chain: false, signatures: false },
        failures: ["BAD_JSON"],
      });
    }

    const result = verifyEvidencePack(parsed);
    return sendJson(
      res,
      result.failures.includes("MALFORMED_EVIDENCE") ? 400 : 200,
      result,
    );
  } catch {
    return sendJson(res, 500, {
      valid: false,
      checks: { chain: false, signatures: false },
      failures: ["INTERNAL"],
    });
  }
}
