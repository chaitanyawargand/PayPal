import { z } from "zod";

export const CreateRunRequest = z.object({ prompt: z.string().min(1).max(2000) }).strict();
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;
export const SelectCandidateRequest = z.object({ candidateId: z.string().min(1) }).strict();
export type SelectCandidateRequest = z.infer<typeof SelectCandidateRequest>;
export const StepUpDecisionRequest = z.object({ decision: z.enum(["APPROVE", "REJECT"]) }).strict();
export type StepUpDecisionRequest = z.infer<typeof StepUpDecisionRequest>;
export const EventsQuery = z.object({ afterSeq: z.number().int().nonnegative().default(0) }).strict();
export type EventsQuery = z.infer<typeof EventsQuery>;
