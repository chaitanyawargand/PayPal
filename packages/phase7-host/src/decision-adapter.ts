import { PaymentSchema } from "../../core/src/payment.js";
import type { Decision as EngineDecision } from "../../engine/src/engine.js";
import type { CandidateCard } from "../../phase7-contracts/src/candidate.js";
import type { Run, RunDecision } from "../../phase7-contracts/src/run.js";
import { decidePayment } from "../../engine/src/engine.js";
import type { DecisionPort, VerifiedQuote } from "../../phase7-gateway/src/ports.js";
import type { Clock } from "./contract-resolver.js";
import { IntentContractResolver } from "./contract-resolver.js";
import type { HostErrorCode } from "./errors.js";
import { InMemoryVerifiedQuoteStore } from "./quote-verifier.js";

export type EngineDecisionAdapterDependencies = {
  contractResolver: IntentContractResolver;
  quoteStore: InMemoryVerifiedQuoteStore;
  getSpentCents(contractId: string): Promise<number> | number;
  clock: Clock;
};

export class EngineDecisionAdapter implements DecisionPort {
  constructor(private readonly deps: EngineDecisionAdapterDependencies) {}

  async decide(input: { run: Run; candidate: CandidateCard; verifiedQuote: VerifiedQuote }): Promise<RunDecision> {
    const resolved = await this.deps.contractResolver.resolveForRun(input.run);
    if (!resolved.ok) return blocked(resolved.reasonCode);
    const quoteId = input.candidate.quoteId;
    if (!quoteId) return blocked("QUOTE_ID_MISSING");
    const quote = this.deps.quoteStore.take({ runId: input.run.id, candidateId: input.candidate.id, quoteId });
    if (!quote) return blocked("VERIFIED_QUOTE_DETAILS_UNAVAILABLE");
    const quoteExpiry = Date.parse(quote.expiresAt);
    if (!Number.isFinite(quoteExpiry) || quoteExpiry <= this.deps.clock.now().getTime()) return blocked("VERIFIED_QUOTE_EXPIRED");
    if (quote.quoteId !== quoteId
      || quote.merchantId !== input.candidate.merchantId
      || quote.merchantId !== input.verifiedQuote.merchantId
      || input.verifiedQuote.sku !== input.candidate.sku
      || quote.totalCents !== input.verifiedQuote.quoteTotalCents
      || (input.candidate.quoteTotalCents !== undefined && quote.totalCents !== input.candidate.quoteTotalCents)) return blocked("VERIFIED_QUOTE_MISMATCH");

    const quantity = quote.items.filter((item) => item.sku === input.candidate.sku).reduce((sum, item) => sum + item.quantity, 0);
    if (quantity !== input.candidate.quantity) return blocked("VERIFIED_QUOTE_MISMATCH");

    let spent: number;
    try {
      spent = await this.deps.getSpentCents(resolved.contract.id);
    } catch {
      return blocked("SPENT_LOOKUP_FAILED");
    }
    if (!Number.isSafeInteger(spent) || spent < 0) return blocked("SPENT_LOOKUP_FAILED");

    const payment = {
      id: `payment_${input.run.id}_${input.candidate.id}`,
      contract_id: resolved.contract.id,
      idempotency_key: `${input.run.id}:${input.candidate.id}`,
      merchant_id: input.verifiedQuote.merchantId,
      merchant_order_ref: quote.quoteId,
      items: quote.lineItems.map((line) => ({ sku: line.sku ?? line.kind.toLowerCase(), qty: 1, unit_price_cents: line.amountCents })),
      proposed_total_cents: input.verifiedQuote.quoteTotalCents,
      spans: [],
    };
    const parsedPayment = PaymentSchema.safeParse(payment);
    if (!parsedPayment.success) return blocked("VERIFIED_QUOTE_DETAILS_INVALID");
    const computedLineTotal = quote.lineItems.reduce((sum, line) => sum + line.amountCents, 0);
    if (!Number.isSafeInteger(computedLineTotal)) return blocked("VERIFIED_QUOTE_DETAILS_INVALID");

    try {
      const result = decidePayment({ contract: resolved.contract, payment: parsedPayment.data, spent_cents: spent });
      return mapEngineDecision(result);
    } catch {
      return blocked("ENGINE_DECISION_FAILED");
    }
  }
}

export function mapEngineDecision(result: EngineDecision): RunDecision {
  return { outcome: result.verdict, reasonCodes: [...result.reason_codes], computedTotalCents: result.computed_total_cents };
}

function blocked(reasonCode: HostErrorCode | string): RunDecision {
  return { outcome: "BLOCK", reasonCodes: [reasonCode] };
}

export class InMemorySpendLedger {
  private readonly totals = new Map<string, number>();

  getSpentCents(contractId: string): number { return this.totals.get(contractId) ?? 0; }

  recordCompleted(contractId: string, amountCents: number): void {
    if (!contractId || !Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error("Completed spend must have a contract ID and non-negative integer cents.");
    const total = this.getSpentCents(contractId) + amountCents;
    if (!Number.isSafeInteger(total)) throw new Error("Completed spend exceeds safe integer cents.");
    this.totals.set(contractId, total);
  }
}
