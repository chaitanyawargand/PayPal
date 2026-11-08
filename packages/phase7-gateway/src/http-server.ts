import http from "node:http";
import { CreateRunRequest, EventsQuery, SelectCandidateRequest, StepUpDecisionRequest } from "../../phase7-contracts/src/requests.js";
import { GatewayError } from "./errors.js";
import type { GatewayService } from "./gateway-service.js";

const MAX_BODY_BYTES = 64 * 1024;
class JsonBodyError extends Error {}
class RequestValidationError extends Error {}
function reply(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}
async function body(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RequestValidationError("Request body too large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new JsonBodyError("Request body must be valid JSON"); }
}
function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string } } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new RequestValidationError(result.error.message);
  return result.data;
}
function errorStatus(error: unknown): number {
  if (error instanceof JsonBodyError || error instanceof RequestValidationError) return 400;
  if (error instanceof GatewayError) {
    if (error.code === "RUN_NOT_FOUND" || error.code === "CANDIDATE_NOT_FOUND") return 404;
    if (error.code === "INVALID_TRANSITION") return 409;
    if (error.code === "VALIDATION_ERROR") return 400;
  }
  return 500;
}
function errorCode(error: unknown): string {
  if (error instanceof JsonBodyError) return "INVALID_JSON";
  if (error instanceof RequestValidationError) return "VALIDATION_ERROR";
  if (error instanceof GatewayError) return error.code;
  return "INTERNAL_ERROR";
}
function errorMessage(error: unknown): string {
  if (error instanceof JsonBodyError || error instanceof RequestValidationError || error instanceof GatewayError) return error.message;
  return "An unexpected error occurred";
}

export function createGatewayHttpServer(service: GatewayService): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const method = req.method ?? "GET";
      const path = url.pathname;
      if (method === "GET" && path === "/health") return reply(res, 200, { ok: true });
      if (method === "POST" && path === "/runs") {
        const request = parse(CreateRunRequest, await body(req));
        return reply(res, 201, { run: service.createRun(request.prompt) });
      }
      const match = path.match(/^\/runs\/([^/]+)(?:\/(events|select|step-up))?$/);
      if (match) {
        const runId = decodeURIComponent(match[1]!);
        const suffix = match[2];
        if (method === "GET" && !suffix) return reply(res, 200, service.getRun(runId));
        if (method === "GET" && suffix === "events") {
          const raw = url.searchParams.get("afterSeq");
          const query = parse(EventsQuery, raw === null ? {} : { afterSeq: Number(raw) });
          return reply(res, 200, { events: service.getEvents(runId, query.afterSeq) });
        }
        if (method === "POST" && suffix === "select") {
          const request = parse(SelectCandidateRequest, await body(req));
          return reply(res, 200, service.selectCandidate(runId, request.candidateId));
        }
        if (method === "POST" && suffix === "step-up") {
          const request = parse(StepUpDecisionRequest, await body(req));
          return reply(res, 200, await service.decideStepUp(runId, request.decision));
        }
      }
      return reply(res, 404, { error: { code: "NOT_FOUND", message: "Route not found" } });
    } catch (error) {
      return reply(res, errorStatus(error), { error: { code: errorCode(error), message: errorMessage(error) } });
    }
  });
}
