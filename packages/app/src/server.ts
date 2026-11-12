import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DataAdapter } from "./adapter.js";
import type { SpendingContractInput, PlantedAttack } from "./types.js";
import type { MissionDraft } from "../../phase7-agent/src/autonomous-mission.js";

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
      } catch {
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
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(json);
}

function missionDraftFields(body: Record<string, unknown>): Partial<MissionDraft> {
  const allowed = new Set(["productQuery", "quantity", "condition", "requiredAttributes", "preferredAttributes", "exclusions", "maxAllInCapDollars", "confirmHardCap", "revision"]);
  const unexpected = Object.keys(body).find((key) => !allowed.has(key));
  if (unexpected) throw new Error(`Unexpected mission field: ${unexpected}`);
  const fields: Partial<MissionDraft> = {};
  if ("productQuery" in body) fields.productQuery = body.productQuery as string;
  if ("quantity" in body) fields.quantity = body.quantity as number;
  if ("condition" in body) fields.condition = body.condition as MissionDraft["condition"];
  if ("requiredAttributes" in body) fields.requiredAttributes = body.requiredAttributes as string[];
  if ("preferredAttributes" in body) fields.preferredAttributes = body.preferredAttributes as string[];
  if ("exclusions" in body) fields.exclusions = body.exclusions as string[];
  if ("maxAllInCapDollars" in body) {
    const dollars = body.maxAllInCapDollars;
    if (typeof dollars !== "number" && typeof dollars !== "string") throw new Error("Hard all-in cap must be a dollar amount.");
    const match = String(dollars).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
    const cents = match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : Number.NaN;
    if (!match || !Number.isSafeInteger(cents) || cents <= 0) throw new Error("Hard all-in cap must be a positive dollar amount with at most two decimal places.");
    fields.maxAllInCapCents = cents;
  } else if ("maxAllInCapCents" in body) {
    throw new Error("Submit the hard all-in cap as a dollar amount.");
  }
  return fields;
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
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase();

    try {
      // 1. Status endpoints
      if (pathname === "/api/status" && method === "GET") {
        const status = await adapter.getStatus();
        return sendJson(res, 200, status);
      }

      if (pathname === "/api/psp/stats" && method === "GET") {
        return sendJson(res, 200, adapter.getPspStats());
      }

      if (pathname === "/api/agent-brain/status" && method === "GET") {
        return sendJson(res, 200, adapter.getAgentBrainStatus());
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

      if (pathname === "/api/mission/start" && method === "POST") {
        const body = await parseJsonBody<{ prompt?: string }>(req);
        if (typeof body.prompt !== "string" || !body.prompt.trim()) return sendJson(res, 400, { error: "prompt is required" });
        return sendJson(res, 200, await adapter.startMission(body.prompt));
      }

      if (pathname === "/api/missions/drafts" && method === "POST") {
        const body = await parseJsonBody<{ prompt?: string }>(req);
        if (typeof body.prompt !== "string" || !body.prompt.trim()) return sendJson(res, 400, { error: "prompt is required" });
        return sendJson(res, 200, await adapter.prepareMissionDraft(body.prompt));
      }
      const draftMatch = pathname.match(/^\/api\/missions\/drafts\/([^/]+)(?:\/(answers|sign-start))?$/);
      if (draftMatch && method === "POST") {
        const draftId = decodeURIComponent(draftMatch[1]!);
        const body = await parseJsonBody<Record<string, unknown>>(req);
        const fields = missionDraftFields(body);
        const revision = Number.isSafeInteger(body.revision) ? body.revision as number : -1;
        if (draftMatch[2] === "answers") return sendJson(res, 200, adapter.answerMissionDraft(draftId, { ...fields, confirmHardCap: body.confirmHardCap === true }, revision));
        if (draftMatch[2] === "sign-start") return sendJson(res, 200, await adapter.signStartMissionDraft(draftId, fields, revision));
      }
      if (draftMatch && method === "PATCH" && !draftMatch[2]) {
        const draftId = decodeURIComponent(draftMatch[1]!);
        const body = await parseJsonBody<Record<string, unknown>>(req);
        return sendJson(res, 200, adapter.editMissionDraft(draftId, missionDraftFields(body), Number.isSafeInteger(body.revision) ? body.revision as number : -1));
      }
      const missionStatusMatch = pathname.match(/^\/api\/missions\/([^/]+)$/);
      if (missionStatusMatch && method === "GET") {
        const view = adapter.getMissionStatus(decodeURIComponent(missionStatusMatch[1]!));
        return view ? sendJson(res, 200, view) : sendJson(res, 404, { error: "Mission not found." });
      }
      if (missionStatusMatch && method === "PATCH") {
        adapter.assertMissionNotSigned(decodeURIComponent(missionStatusMatch[1]!));
        return sendJson(res, 404, { error: "Mission draft not found." });
      }

      const missionDecisionMatch = pathname.match(/^\/api\/missions\/([^/]+)\/step-up$/);
      if (missionDecisionMatch && method === "POST") {
        const body = await parseJsonBody<{ decision?: "APPROVE" | "REJECT" }>(req);
        if (body.decision !== "APPROVE" && body.decision !== "REJECT") return sendJson(res, 400, { error: "decision must be APPROVE or REJECT" });
        return sendJson(res, 200, await adapter.decideMissionStepUp(decodeURIComponent(missionDecisionMatch[1]!), body.decision));
      }
      const missionAbortMatch = pathname.match(/^\/api\/missions\/([^/]+)\/abort$/);
      if (missionAbortMatch && method === "POST") return sendJson(res, 200, adapter.abortMission(decodeURIComponent(missionAbortMatch[1]!)));

      // 2. Real Phase 7 discovery flow
      if ((pathname === "/api/discovery/start" || pathname === "/api/phase7/runs") && method === "POST") {
        const body = await parseJsonBody<{ prompt: string }>(req);
        if (!body.prompt || typeof body.prompt !== "string") {
          return sendJson(res, 400, { error: "prompt is required" });
        }
        try {
          const result = await adapter.startDiscovery(body.prompt);
          return sendJson(res, 200, result);
        } catch (err: any) {
          if (err?.code === "NO_CANDIDATES" || err?.message?.includes("No valid candidates") || err?.message?.includes("NO_CANDIDATES")) {
            return sendJson(res, 200, {
              status: "NO_CANDIDATES",
              message: "No matching candidates found for that prompt.",
              candidates: [],
              run: null,
            });
          }
          throw err;
        }
      }

      // 3. Candidate selection
      const selectMatch = pathname.match(/^\/api\/(?:run|phase7\/runs)\/([^/]+)\/select$/);
      if (selectMatch && method === "POST") {
        const runId = decodeURIComponent(selectMatch[1]!);
        const body = await parseJsonBody<{ candidateId: string }>(req);
        if (!body.candidateId || typeof body.candidateId !== "string") {
          return sendJson(res, 400, { error: "candidateId is required" });
        }
        const result = adapter.selectCandidate(runId, body.candidateId);
        return sendJson(res, 200, result);
      }

      // 4. Compile and sign contract via host bridge
      const signMatch = pathname.match(/^\/api\/(?:run|phase7\/runs)\/([^/]+)\/(?:sign|sign-and-submit)$/);
      if (signMatch && method === "POST") {
        const runId = decodeURIComponent(signMatch[1]!);
        const body = await parseJsonBody<{
          candidateId?: string;
          limits?: SpendingContractInput;
          maxBudgetCents?: number;
          perOrderCapCents?: number;
          maxQuantity?: number;
          noSubscriptions?: boolean;
          noGiftCards?: boolean;
          unverifiedSellerRule?: "ASK_ME" | "BLOCK";
          allowedPayees?: string[];
          expiryMinutes?: number;
        }>(req);

        const limits: SpendingContractInput = body.limits ?? {
          maxBudgetCents: body.maxBudgetCents ?? 10000,
          perOrderCapCents: body.perOrderCapCents ?? body.maxBudgetCents ?? 10000,
          maxQuantity: body.maxQuantity,
          noSubscriptions: body.noSubscriptions ?? true,
          noGiftCards: body.noGiftCards ?? true,
          unverifiedSellerRule: body.unverifiedSellerRule,
          allowedPayees: body.allowedPayees,
          expiryMinutes: body.expiryMinutes,
        };

        const result = await adapter.compileAndSign(runId, limits, body.candidateId);
        return sendJson(res, 200, result);
      }

      // 5. STEP_UP decision (APPROVE or REJECT)
      const stepUpMatch = pathname.match(/^\/api\/(?:run|phase7\/runs)\/([^/]+)\/step-up$/);
      if (stepUpMatch && method === "POST") {
        const runId = decodeURIComponent(stepUpMatch[1]!);
        const body = await parseJsonBody<{ decision?: "APPROVE" | "REJECT"; approved?: boolean }>(req);
        const decision: "APPROVE" | "REJECT" =
          body.decision === "APPROVE" || body.decision === "REJECT"
            ? body.decision
            : body.approved === true
              ? "APPROVE"
              : "REJECT";

        const result = await adapter.decideStepUp(runId, decision);
        return sendJson(res, 200, result);
      }

      // 6. Run event polling with afterSeq
      const eventsMatch = pathname.match(/^\/api\/(?:run|phase7\/runs)\/([^/]+)\/events$/);
      if (eventsMatch && method === "GET") {
        const runId = decodeURIComponent(eventsMatch[1]!);
        const rawSeq = parsedUrl.searchParams.get("afterSeq");
        const afterSeq = rawSeq !== null ? parseInt(rawSeq, 10) || 0 : 0;
        try {
          const events = adapter.getEvents(runId, afterSeq);
          return sendJson(res, 200, { events });
        } catch (error) {
          if (typeof error === "object" && error !== null && "code" in error && error.code === "RUN_NOT_FOUND") {
            return sendJson(res, 404, { error: `Run '${runId}' not found` });
          }
          throw error;
        }
      }

      // 7. Get run snapshot
      const runMatch = pathname.match(/^\/api\/(?:run|phase7\/runs)\/([^/]+)$/);
      if (runMatch && method === "GET") {
        const runId = decodeURIComponent(runMatch[1]!);
        try {
          const snapshot = adapter.getRun(runId);
          return sendJson(res, 200, snapshot);
        } catch {
          return sendJson(res, 404, { error: `Run '${runId}' not found` });
        }
      }

      // 8. Attack lab
      if (pathname === "/api/attack/plant" && method === "POST") {
        const body = await parseJsonBody<PlantedAttack>(req);
        if (!body.storeId || !body.productSku || !body.instruction || !body.placement) {
          return sendJson(res, 400, { error: "storeId, productSku, and instruction are required" });
        }
        const result = await adapter.plantAttack(body);
        return sendJson(res, 200, result);
      }

      if (pathname === "/api/attack/planted" && method === "GET") {
        const attack = adapter.getPlantedAttack();
        return sendJson(res, 200, { attack });
      }
      if (pathname === "/api/attack/clear" && method === "POST") {
        await adapter.clearPlantedAttack();
        return sendJson(res, 200, { success: true, attack: null });
      }

      // 9. Evidence verification
      if (pathname === "/api/evidence/verify" && method === "POST") {
        const body = await parseJsonBody<{ receiptId: string }>(req);
        if (!body.receiptId) {
          return sendJson(res, 400, { error: "receiptId is required" });
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
      const message = typeof err?.message === "string" ? err.message : "Internal server error";
      const status = /needs clarification|locked|already started/i.test(message) ? 409
        : /not found/i.test(message) ? 404
          : /Unexpected mission field|Product\/query|must be a list|Quantity must|Hard all-in cap|Condition must|Submit the hard all-in cap|Invalid JSON body|draft changed/i.test(message) ? 400
            : 500;
      if (status >= 500) console.error("Server error handling request:", err);
      sendJson(res, status, { error: message });
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
            try {
              adapter.close();
            } catch {
              // ignore
            }
            server.close(() => resClose());
          }),
      });
    });
  });
}
