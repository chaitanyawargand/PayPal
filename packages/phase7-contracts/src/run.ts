import { z } from "zod";

export const RunStatus = z.enum([
  "CREATED",
  "SEARCHING",
  "AWAITING_SELECTION",
  "AWAITING_SIGNATURE",
  "VERIFYING",
  "STEP_UP_REQUIRED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunDecision = z.object({
  outcome: z.enum(["ALLOW", "BLOCK", "STEP_UP", "TAMPER_REJECT"]),
  reasonCodes: z.array(z.string()),
  computedTotalCents: z.number().int().nonnegative().optional(),
  evidenceId: z.string().optional(),
  receiptId: z.string().optional(),
}).strict();
export type RunDecision = z.infer<typeof RunDecision>;

export const Run = z.object({
  id: z.string().startsWith("run_"),
  status: RunStatus,
  prompt: z.string().min(1).max(2000),
  selectedCandidateId: z.string().optional(),
  draftIntentId: z.string().optional(),
  signedIntentId: z.string().optional(),
  decision: RunDecision.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type Run = z.infer<typeof Run>;
