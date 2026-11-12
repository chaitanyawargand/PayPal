import { CandidateCard, type CandidateCard as Candidate } from "../../phase7-contracts/src/candidate.js";
import { Run, type Run as RunType } from "../../phase7-contracts/src/run.js";
import { AgentError } from "./errors.js";
import { MERCHANT_IDS, type MerchantId } from "./config.js";
import { SearchResultSchema } from "./store-schemas.js";
import { buildCandidateCard } from "./candidate-builder.js";
import { SearchPlanSchema, type AgentModelPort, type CandidateRankingInput, type SearchPlan } from "./model.js";
import { applyCandidateOrder, deterministicRank, isCandidatePermutation } from "./ranking.js";
import type { ToolTransport } from "./merchant-tools.js";
import type { SearchResult } from "./store-schemas.js";

export type AgentGatewaySnapshot = { run: RunType; candidates: Candidate[] };
type Awaitable<T> = T | Promise<T>;
export interface AgentGatewayPort {
  createRun(prompt: string): Awaitable<RunType>;
  beginSearch(runId: string): Awaitable<AgentGatewaySnapshot>;
  registerCandidates(runId: string, candidates: CandidateCard[]): Awaitable<AgentGatewaySnapshot>;
}
export type AgentServiceDependencies = { gateway: AgentGatewayPort; tools: ToolTransport; model: AgentModelPort };

export class AgentService {
  constructor(private readonly deps: AgentServiceDependencies) {}

  async startDiscovery(prompt: string, quantityOverride?: number, variantOverride: Record<string, string> = {}): Promise<AgentGatewaySnapshot> {
    const created = Run.parse(await this.deps.gateway.createRun(prompt));
    await this.deps.gateway.beginSearch(created.id);
    const draftedPlan = await this.plan(prompt);
    const plan = SearchPlanSchema.parse({ ...draftedPlan, ...(quantityOverride === undefined ? {} : { quantity: quantityOverride }) });
    const searched = await Promise.all(MERCHANT_IDS.map(async (merchantId) => {
      try {
        const results = await this.deps.tools.searchStore({ merchantId, query: plan.query });
        return { merchantId, results, failed: false as const };
      } catch {
        return { merchantId, results: [] as SearchResult[], failed: true as const };
      }
    }));

    const candidates: Candidate[] = [];
    for (const store of searched) {
      if (store.failed) continue;
      for (const rawResult of store.results.slice(0, 3)) {
        const parsed = SearchResultSchema.safeParse(rawResult);
        if (!parsed.success) continue;
        const result = parsed.data;
        try {
          const product = await this.deps.tools.getProduct({ merchantId: store.merchantId, sku: result.sku });
          const variant = { ...product.defaultVariant };
          for (const [requestedKey, requestedValue] of Object.entries(variantOverride)) {
            const option = product.variantOptions?.find((item) => item.id === requestedKey || item.label.toLowerCase() === requestedKey.toLowerCase());
            if (!option || !option.values.includes(requestedValue)) throw new Error("Requested variant unavailable");
            variant[option.id] = requestedValue;
          }
          const quote = await this.deps.tools.requestQuote({
            merchantId: store.merchantId,
            sku: result.sku,
            quantity: plan.quantity,
            variant,
          });
          candidates.push(buildCandidateCard({ runId: created.id, merchantId: store.merchantId, sku: result.sku, quantity: plan.quantity, product, quote, variant }));
        } catch {
          // A malformed or unavailable listing is excluded; other listings and merchants continue.
        }
      }
    }
    if (candidates.length === 0) throw new AgentError("NO_CANDIDATES", "No valid candidates were returned by the storefronts.");

    const input = this.rankingInput(prompt, plan, candidates);
    let ranked: Candidate[];
    try {
      const result = await this.deps.model.rankCandidates(input);
      ranked = isCandidatePermutation(candidates, result.orderedCandidateIds)
        ? applyCandidateOrder(candidates, result.orderedCandidateIds)
        : deterministicRank(candidates);
    } catch {
      ranked = deterministicRank(candidates);
    }
    const registered = await this.deps.gateway.registerCandidates(created.id, ranked);
    if (registered.run.status !== "AWAITING_SELECTION") throw new AgentError("GATEWAY_STATE", "Gateway did not leave the run awaiting candidate selection.");
    return { run: Run.parse(registered.run), candidates: registered.candidates.map((candidate) => CandidateCard.parse(candidate)) };
  }

  private async plan(prompt: string): Promise<SearchPlan> {
    try { return SearchPlanSchema.parse(await this.deps.model.planSearch(prompt)); }
    catch {
      return SearchPlanSchema.parse({ query: prompt.trim() || "products", quantity: 1 });
    }
  }

  private rankingInput(prompt: string, plan: SearchPlan, candidates: Candidate[]): CandidateRankingInput {
    return {
      prompt,
      ...(plan.maxBudgetCents === undefined ? {} : { maxBudgetCents: plan.maxBudgetCents }),
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        merchantId: candidate.merchantId,
        sku: candidate.sku,
        quantity: candidate.quantity,
        advertisedTotalCents: candidate.advertisedTotalCents,
        ...(candidate.quoteTotalCents === undefined ? {} : { quoteTotalCents: candidate.quoteTotalCents }),
        seller: { verified: candidate.seller.verified } as CandidateRankingInput["candidates"][number]["seller"],
        terms: { ...candidate.terms },
      })),
    };
  }
}
