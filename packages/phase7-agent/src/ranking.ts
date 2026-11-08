import { CandidateCard, type CandidateCard as Candidate } from "../../phase7-contracts/src/candidate.js";
import type { RankingCandidate } from "./model.js";

function compare(a: RankingCandidate, b: RankingCandidate): number {
  return Number(b.seller.verified) - Number(a.seller.verified)
    || Number(a.terms.finalSale) - Number(b.terms.finalSale)
    || Number(a.terms.subscription || a.terms.giftCard) - Number(b.terms.subscription || b.terms.giftCard)
    || b.terms.returnsDays - a.terms.returnsDays
    || (a.quoteTotalCents ?? a.advertisedTotalCents) - (b.quoteTotalCents ?? b.advertisedTotalCents)
    || a.advertisedTotalCents - b.advertisedTotalCents
    || a.merchantId.localeCompare(b.merchantId)
    || a.sku.localeCompare(b.sku);
}
export function rankStructuredCandidates(candidates: readonly RankingCandidate[]): string[] {
  return [...candidates].sort(compare).map((candidate) => candidate.id);
}
export function deterministicRank(candidates: readonly Candidate[]): Candidate[] {
  const orderedIds = rankStructuredCandidates(candidates);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return orderedIds.map((id, index) => CandidateCard.parse({ ...byId.get(id)!, rank: index + 1 }));
}
export function applyCandidateOrder(candidates: readonly Candidate[], orderedIds: readonly string[]): Candidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return orderedIds.map((id, index) => CandidateCard.parse({ ...byId.get(id)!, rank: index + 1 }));
}
export function isCandidatePermutation(candidates: readonly Candidate[], orderedIds: readonly string[]): boolean {
  if (orderedIds.length !== candidates.length) return false;
  const expected = new Set(candidates.map((candidate) => candidate.id));
  if (expected.size !== candidates.length) return false;
  const actual = new Set(orderedIds);
  return actual.size === orderedIds.length && orderedIds.every((id) => expected.has(id));
}
