import { z } from "zod";
import type { CandidateCard } from "../../phase7-contracts/src/candidate.js";
import type { Run, RunDecision } from "../../phase7-contracts/src/run.js";
import type { VerifiedQuote } from "../../phase7-gateway/src/ports.js";

export const JUDGE_REASON_CODES = Object.freeze({
  stepUp: "AI_JUDGE_STEP_UP",
  block: "AI_JUDGE_BLOCK",
  unavailable: "AI_JUDGE_UNAVAILABLE",
} as const);

export const JudgeRecommendationSchema = z.object({ recommendation: z.enum(["KEEP", "STEP_UP", "BLOCK"]) }).strict();
export type JudgeRecommendation = z.infer<typeof JudgeRecommendationSchema>;

export type JudgeFacts = {
  run: { prompt: Run["prompt"] };
  candidate: {
    candidateId: CandidateCard["id"];
    merchantId: CandidateCard["merchantId"];
    sku: CandidateCard["sku"];
    quantity: CandidateCard["quantity"];
    advertisedTotalCents: CandidateCard["advertisedTotalCents"];
    quoteTotalCents?: CandidateCard["quoteTotalCents"];
    terms: {
      condition: CandidateCard["terms"]["condition"];
      returnsDays: CandidateCard["terms"]["returnsDays"];
      finalSale: CandidateCard["terms"]["finalSale"];
      subscription: CandidateCard["terms"]["subscription"];
      giftCard: CandidateCard["terms"]["giftCard"];
      warrantyLabel: CandidateCard["terms"]["warrantyLabel"];
    };
    seller: { verified: CandidateCard["seller"]["verified"] };
  };
  verifiedQuote: { merchantId: VerifiedQuote["merchantId"]; sku: VerifiedQuote["sku"]; quoteTotalCents: VerifiedQuote["quoteTotalCents"] };
  baseDecision: { outcome: RunDecision["outcome"]; reasonCodes: RunDecision["reasonCodes"] };
};

export interface JudgeModelPort {
  review(facts: JudgeFacts): Promise<JudgeRecommendation> | JudgeRecommendation;
}
