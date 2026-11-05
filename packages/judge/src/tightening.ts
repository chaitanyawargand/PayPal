import type { Verdict } from "./types.js";

const VERDICT_RANK: Record<Verdict, number> = {
  ALLOW: 1,
  STEP_UP: 2,
  BLOCK: 3,
};

const RANK_TO_VERDICT: Record<number, Verdict> = {
  1: "ALLOW",
  2: "STEP_UP",
  3: "BLOCK",
};

/**
 * Pure tightening function according to Phase 6 Contract 2.
 * Ordering: ALLOW < STEP_UP < BLOCK.
 * Invariant: The final verdict is NEVER looser than the deterministic verdict.
 */
export function applyTightening(det: Verdict, judge: Verdict): Verdict {
  const detRank = VERDICT_RANK[det] ?? 2;
  const judgeRank = VERDICT_RANK[judge] ?? 2;

  // The final verdict is the stricter of the two
  const finalRank = Math.max(detRank, judgeRank);
  return RANK_TO_VERDICT[finalRank] ?? "BLOCK";
}

