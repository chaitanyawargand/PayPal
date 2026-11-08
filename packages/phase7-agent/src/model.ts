import { z } from "zod";
import type { CandidateCard } from "../../phase7-contracts/src/candidate.js";
import { rankStructuredCandidates } from "./ranking.js";

export const SearchPlanSchema = z.object({
  query: z.string().min(1).max(2000),
  quantity: z.number().int().min(1).max(100),
  maxBudgetCents: z.number().int().nonnegative().optional(),
}).strict();
export type SearchPlan = z.infer<typeof SearchPlanSchema>;
export type RankingCandidate = Pick<CandidateCard, "id" | "merchantId" | "sku" | "quantity" | "advertisedTotalCents" | "quoteTotalCents" | "terms"> & { seller: Pick<CandidateCard["seller"], "verified"> };
export type CandidateRankingInput = { prompt: string; maxBudgetCents?: number; candidates: RankingCandidate[] };
export const RankingResponseSchema = z.object({ orderedCandidateIds: z.array(z.string().min(1)) }).strict();
export type RankingResponse = z.infer<typeof RankingResponseSchema>;
export interface AgentModelPort {
  planSearch(prompt: string): Promise<SearchPlan> | SearchPlan;
  rankCandidates(structuredInput: CandidateRankingInput): Promise<RankingResponse> | RankingResponse;
}

export class DeterministicAgentModel implements AgentModelPort {
  planSearch(prompt: string): SearchPlan { return SearchPlanSchema.parse({ query: prompt.trim() || "products", quantity: 1 }); }
  rankCandidates(input: CandidateRankingInput): RankingResponse { return { orderedCandidateIds: rankStructuredCandidates(input.candidates) }; }
}
