import type { CandidateCard } from "../../phase7-contracts/src/candidate.js";
import type { Run, RunDecision } from "../../phase7-contracts/src/run.js";

export type Clock = { now(): string };
export type IdGenerator = { runId(): string; eventId(): string };
export type VerifiedQuote = { ok: true; merchantId: string; sku: string; quoteTotalCents: number };
export type QuoteVerification = VerifiedQuote | { ok: false; reason: string };
export type QuoteVerifierPort = { verify(input: { runId: string; candidateId: string; quoteId: string; signedQuote: unknown }): Promise<QuoteVerification> | QuoteVerification };
export type DecisionPort = { decide(input: { run: Run; candidate: CandidateCard; verifiedQuote: VerifiedQuote }): Promise<RunDecision> | RunDecision };
export type PaymentPort = { execute(input: { runId: string; candidateId: string; amountCents: number; currency: "USD"; idempotencyKey: string }): Promise<{ receiptId: string; status: "COMPLETED" }> | { receiptId: string; status: "COMPLETED" } };
export type EvidencePort = { issue(input: { run: Run; candidate: CandidateCard; decision: RunDecision; receiptId?: string }): Promise<{ evidenceId: string }> | { evidenceId: string } };
export type GatewayPorts = { quoteVerifier: QuoteVerifierPort; decision: DecisionPort; payment: PaymentPort; evidence: EvidencePort };
