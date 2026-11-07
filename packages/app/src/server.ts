import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DataAdapter } from "./adapter.js";
import type { SpendingContractDraft, AttackPlanted } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export interface AppServerOptions {
  port?: number;
  adapter?: DataAdapter;
}

export interface AppServerInstance {
  server: http.Server;
  port: number;
  adapter: DataAdapter;
  close: () => Promise<void>;
}

function parseJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        req.destroy();
        reject(new Error("Request entity too large"));
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(json);
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  let relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  // Prevent directory traversal
  const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
  });
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}

export function createAppServer(options: AppServerOptions = {}): Promise<AppServerInstance> {
  const adapter = options.adapter ?? new DataAdapter();
  const requestedPort = options.port ?? 8787;

  const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase();

    try {
      // API Routes
      if (pathname === "/api/status" && method === "GET") {
        const status = await adapter.getStatus();
        return sendJson(res, 200, status);
      }

      if (pathname === "/api/status/judge" && method === "POST") {
        const body = await parseJsonBody<{ status: "CONNECTED" | "UNAVAILABLE" }>(req);
        if (body.status === "CONNECTED" || body.status === "UNAVAILABLE") {
          adapter.setAiJudgeStatus(body.status);
          const updated = await adapter.getStatus();
          return sendJson(res, 200, updated);
        }
        return sendJson(res, 400, { error: "status must be 'CONNECTED' or 'UNAVAILABLE'" });
      }

      if (pathname === "/api/contract/draft" && method === "POST") {
        const body = await parseJsonBody<{ prompt: string }>(req);
        const draft = await adapter.draftContract(body.prompt || "");
        return sendJson(res, 200, draft);
      }

      if (pathname === "/api/contract/sign" && method === "POST") {
        const body = await parseJsonBody<{ draft: SpendingContractDraft }>(req);
        if (!body.draft) {
          return sendJson(res, 400, { error: "Missing draft" });
        }
        const signed = await adapter.signContract(body.draft);
        return sendJson(res, 200, signed);
      }

      if (pathname === "/api/run/start" && method === "POST") {
        const body = await parseJsonBody<{ prompt: string; contract: SpendingContractDraft }>(req);
        if (!body.prompt || !body.contract) {
          return sendJson(res, 400, { error: "Missing prompt or contract" });
        }
        const run = await adapter.startRun(body.prompt, body.contract);
        return sendJson(res, 200, run);
      }

      if (pathname.startsWith("/api/run/") && pathname.endsWith("/step-up") && method === "POST") {
        const parts = pathname.split("/");
        // /api/run/:id/step-up
        const runId = parts[3];
        const body = await parseJsonBody<{ candidateId: string; approved: boolean }>(req);
        if (!candidateIdValid(body.candidateId) || typeof body.approved !== "boolean") {
          return sendJson(res, 400, { error: "Missing candidateId or valid approved flag" });
        }
        const updatedRun = await adapter.stepUpDecision(runId, body.candidateId, body.approved);
        return sendJson(res, 200, updatedRun);
      }

      if (pathname.startsWith("/api/run/") && method === "GET") {
        const runId = pathname.replace("/api/run/", "");
        const run = await adapter.getRun(runId);
        if (!run) {
          return sendJson(res, 404, { error: `Run ${runId} not found` });
        }
        return sendJson(res, 200, run);
      }

      if (pathname === "/api/attack/plant" && method === "POST") {
        const body = await parseJsonBody<AttackPlanted>(req);
        if (!body.storeId || !body.productSku || !body.instruction) {
          return sendJson(res, 400, { error: "Invalid attack specification" });
        }
        const result = await adapter.plantAttack(body);
        return sendJson(res, 200, result);
      }

      if (pathname === "/api/evidence/verify" && method === "POST") {
        const body = await parseJsonBody<{ receiptId: string }>(req);
        if (!body.receiptId) {
          return sendJson(res, 400, { error: "Missing receiptId" });
        }
        const result = await adapter.verifyEvidence(body.receiptId);
        return sendJson(res, 200, result);
      }

      // If it starts with /api/ and wasn't handled, return 404
      if (pathname.startsWith("/api/")) {
        return sendJson(res, 404, { error: `Endpoint ${method} ${pathname} not found` });
      }

      // Otherwise serve static files
      serveStatic(req, res, pathname);
    } catch (err: any) {
      console.error("Server error handling request:", err);
      sendJson(res, 500, { error: err?.message || "Internal server error" });
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(requestedPort, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : requestedPort;
      resolve({
        server,
        port: actualPort,
        adapter,
        close: () =>
          new Promise<void>((resClose) => {
            server.close(() => resClose());
          }),
      });
    });
  });
}

function candidateIdValid(id: any): id is string {
  return typeof id === "string" && id.length > 0;
}

