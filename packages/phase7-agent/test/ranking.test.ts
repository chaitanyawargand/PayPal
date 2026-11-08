import { describe, expect, it } from "vitest";
import { deterministicRank } from "../src/ranking.js";
import type { CandidateCard } from "../../phase7-contracts/src/candidate.js";

const candidate = (id: string, changes: Partial<CandidateCard> = {}): CandidateCard => ({
  id: `cand_${id}`, runId: "run_1", rank: 1, status: "PROPOSED", merchantId: "novamart", merchantDisplayName: "NovaMart", sku: id, productName: id, quantity: 1, advertisedTotalCents: 1000, currency: "USD", seller: { id: "seller", name: "Seller", verified: true }, terms: { condition: "NEW", returnsDays: 30, finalSale: false, warrantyLabel: "1 year", subscription: false, giftCard: false }, hiddenContent: [], ...changes,
});

describe("deterministic ranking", () => {
  it("orders by seller, terms, returns, quote total, advertised total, then identifiers", () => {
    const values = [
      candidate("z", { merchantId: "peermarket", seller: { id: "s", name: "S", verified: false } }),
      candidate("b", { merchantId: "dealdemon", quoteTotalCents: 800 }),
      candidate("a", { merchantId: "novamart", quoteTotalCents: 800 }),
      candidate("c", { terms: { condition: "USED_GOOD", returnsDays: 90, finalSale: true, warrantyLabel: "none", subscription: true, giftCard: true } }),
    ];
    expect(deterministicRank(values).map((item) => item.id)).toEqual(["cand_b", "cand_a", "cand_c", "cand_z"]);
    expect(deterministicRank(values).map((item) => item.rank)).toEqual([1, 2, 3, 4]);
  });
});
