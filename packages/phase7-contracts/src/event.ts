import { z } from "zod";

export const EventType = z.enum([
  "RUN_CREATED", "SEARCH_STARTED", "CANDIDATE_FOUND", "CANDIDATES_READY",
  "DRAFT_CREATED", "INTENT_SIGNED", "QUOTE_SUBMITTED",
  "QUOTE_SIGNATURE_VERIFIED", "QUOTE_SIGNATURE_FAILED", "ENGINE_DECIDED",
  "JUDGE_REVIEWED", "STEP_UP_REQUIRED", "STEP_UP_APPROVED",
  "STEP_UP_REJECTED", "NEXT_CANDIDATE", "PAYMENT_EXECUTED",
  "EVIDENCE_ISSUED", "RUN_COMPLETED", "RUN_FAILED",
]);
export type EventType = z.infer<typeof EventType>;
export const EventActor = z.enum(["USER", "AGENT", "GATEWAY", "ENGINE", "JUDGE", "SYSTEM"]);
export type EventActor = z.infer<typeof EventActor>;

const unsafeDataKey = /secret|signature|hmac|token|password|credential|api[-_]?key/i;
export function assertEventDataSafe(data: Record<string, unknown>): void {
  const visit = (value: unknown, seen: Set<object>): void => {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) throw new TypeError("Event data must not contain circular references");
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, seen);
    } else {
      for (const [key, nested] of Object.entries(value)) {
        if (unsafeDataKey.test(key)) throw new Error(`Unsafe event data key: ${key}`);
        visit(nested, seen);
      }
    }
    seen.delete(value);
  };
  visit(data, new Set());
}

export const Event = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  seq: z.number().int().min(1),
  type: EventType,
  actor: EventActor,
  message: z.string().min(1),
  candidateId: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional().superRefine((data, ctx) => {
    if (data === undefined) return;
    try { assertEventDataSafe(data); }
    catch (error) { ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Unsafe event data" }); }
  }),
  ts: z.string().datetime(),
}).strict();
export type Event = z.infer<typeof Event>;
