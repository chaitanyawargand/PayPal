import { CandidateCard, type CandidateCard as Candidate } from "../../phase7-contracts/src/candidate.js";
import { Run, RunDecision, type Run as RunType, type RunDecision as Decision } from "../../phase7-contracts/src/run.js";
import type { DecisionPort, VerifiedQuote } from "../../phase7-gateway/src/ports.js";
import { JudgeRecommendationSchema, JUDGE_REASON_CODES, type JudgeFacts, type JudgeModelPort } from "./model.js";

export type JudgeInput = { run: RunType; candidate: Candidate; verifiedQuote: VerifiedQuote };
export type TighteningJudgeDependencies = { baseDecisionPort: DecisionPort; judgeModel: JudgeModelPort };

export class TighteningJudge implements DecisionPort {
  constructor(private readonly deps: TighteningJudgeDependencies) {}

  async decide(input: JudgeInput): Promise<Decision> {
    const base = RunDecision.parse(await this.deps.baseDecisionPort.decide(input));
    if (base.outcome === "BLOCK" || base.outcome === "TAMPER_REJECT") return freshDecision(base);

    try {
      const recommendation = JudgeRecommendationSchema.parse(await this.deps.judgeModel.review(toJudgeFacts(input, base)));
      if (recommendation.recommendation === "KEEP") return freshDecision(base);
      if (recommendation.recommendation === "BLOCK") {
        return { ...base, outcome: "BLOCK", reasonCodes: [...base.reasonCodes, JUDGE_REASON_CODES.block] };
      }
      if (base.outcome === "ALLOW") {
        return { ...base, outcome: "STEP_UP", reasonCodes: [...base.reasonCodes, JUDGE_REASON_CODES.stepUp] };
      }
      return freshDecision(base);
    } catch {
      return {
        ...base,
        outcome: "STEP_UP",
        reasonCodes: [...base.reasonCodes, JUDGE_REASON_CODES.unavailable],
      };
    }
  }
}

function freshDecision(base: Decision): Decision {
  return RunDecision.parse({ ...base, reasonCodes: [...base.reasonCodes] });
}

function toJudgeFacts(input: JudgeInput, base: Decision): JudgeFacts {
  const candidate = CandidateCard.parse(input.candidate);
  const run = Run.parse(input.run);
  return {
    run: { prompt: run.prompt },
    candidate: {
      candidateId: candidate.id,
      merchantId: candidate.merchantId,
      sku: candidate.sku,
      quantity: candidate.quantity,
      advertisedTotalCents: candidate.advertisedTotalCents,
      ...(candidate.quoteTotalCents === undefined ? {} : { quoteTotalCents: candidate.quoteTotalCents }),
      terms: {
        condition: candidate.terms.condition,
        returnsDays: candidate.terms.returnsDays,
        finalSale: candidate.terms.finalSale,
        subscription: candidate.terms.subscription,
        giftCard: candidate.terms.giftCard,
        warrantyLabel: candidate.terms.warrantyLabel,
      },
      seller: { verified: candidate.seller.verified },
      listingContent: candidate.listingContent ?? [],
    },
    verifiedQuote: {
      merchantId: input.verifiedQuote.merchantId,
      sku: input.verifiedQuote.sku,
      quoteTotalCents: input.verifiedQuote.quoteTotalCents,
    },
    baseDecision: { outcome: base.outcome, reasonCodes: [...base.reasonCodes] },
  };
}
