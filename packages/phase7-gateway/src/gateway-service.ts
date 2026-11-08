import { CandidateCard, type CandidateCard as Candidate } from "../../phase7-contracts/src/candidate.js";
import { assertEventDataSafe } from "../../phase7-contracts/src/event.js";
import { Run, RunDecision, type Run as RunType, type RunDecision as Decision } from "../../phase7-contracts/src/run.js";
import { GatewayError } from "./errors.js";
import { InMemoryRunStore, type RunSnapshot } from "./run-store.js";
import type { Clock, DecisionPort, EvidencePort, IdGenerator, PaymentPort, QuoteVerifierPort, VerifiedQuote } from "./ports.js";

export type GatewayServiceDependencies = { quoteVerifier: QuoteVerifierPort; decision: DecisionPort; payment: PaymentPort; evidence: EvidencePort; clock: Clock; ids: IdGenerator; store?: InMemoryRunStore };

export class GatewayService {
  readonly store: InMemoryRunStore;
  constructor(private readonly deps: GatewayServiceDependencies) { this.store = deps.store ?? new InMemoryRunStore(); }

  private now(): string { return this.deps.clock.now(); }
  private runOrThrow(runId: string): RunType {
    const run = this.store.getRun(runId);
    if (!run) throw new GatewayError("RUN_NOT_FOUND", `Run not found: ${runId}`);
    return run;
  }
  private snapshotOrThrow(runId: string): RunSnapshot {
    const snapshot = this.store.snapshot(runId);
    if (!snapshot) throw new GatewayError("RUN_NOT_FOUND", `Run not found: ${runId}`);
    return snapshot;
  }
  private transition(run: RunType, patch: Partial<RunType>): RunType {
    return this.store.updateRun({ ...run, ...patch, updatedAt: this.now() });
  }
  private event(runId: string, type: string, actor: string, message: string, candidateId?: string, data?: Record<string, unknown>) {
    try {
      if (data) assertEventDataSafe(data);
      return this.store.appendEvent({ id: this.deps.ids.eventId(), runId, type, actor, message, ...(candidateId ? { candidateId } : {}), ...(data ? { data } : {}), ts: this.now() } as Parameters<InMemoryRunStore["appendEvent"]>[0]);
    } catch (error) {
      throw new GatewayError("VALIDATION_ERROR", error instanceof Error ? error.message : "Invalid event");
    }
  }
  private updateCandidate(runId: string, candidate: Candidate, patch: Partial<Candidate>): Candidate {
    return this.store.updateCandidate(runId, { ...candidate, ...patch });
  }
  private candidateOrThrow(runId: string, candidateId: string): Candidate {
    const candidate = this.store.getCandidates(runId).find((row) => row.id === candidateId);
    if (!candidate) throw new GatewayError("CANDIDATE_NOT_FOUND", `Candidate not found: ${candidateId}`);
    return candidate;
  }
  private requireStatus(run: RunType, status: RunType["status"]): void {
    if (run.status !== status) throw new GatewayError("INVALID_TRANSITION", `Run ${run.id} must be ${status}; current status is ${run.status}`);
  }

  createRun(prompt: string): RunType {
    const now = this.now();
    const run = this.store.createRun({ id: this.deps.ids.runId(), status: "CREATED", prompt, createdAt: now, updatedAt: now });
    this.event(run.id, "RUN_CREATED", "USER", "Purchase request created.");
    return this.runOrThrow(run.id);
  }

  beginSearch(runId: string): RunSnapshot {
    const run = this.runOrThrow(runId);
    this.requireStatus(run, "CREATED");
    this.transition(run, { status: "SEARCHING" });
    this.event(runId, "SEARCH_STARTED", "AGENT", "Candidate search started.");
    return this.snapshotOrThrow(runId);
  }

  registerCandidates(runId: string, values: unknown[]): RunSnapshot {
    const run = this.runOrThrow(runId);
    this.requireStatus(run, "SEARCHING");
    let candidates: Candidate[];
    try { candidates = values.map((value) => CandidateCard.parse(value)); }
    catch (error) { throw new GatewayError("VALIDATION_ERROR", error instanceof Error ? error.message : "Invalid candidate"); }
    const ranks = new Set<number>();
    const ids = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.runId !== runId || candidate.status !== "PROPOSED" || ranks.has(candidate.rank) || ids.has(candidate.id)) {
        throw new GatewayError("VALIDATION_ERROR", "Candidates must belong to this run, be PROPOSED, and have unique ranks and IDs");
      }
      ranks.add(candidate.rank); ids.add(candidate.id);
    }
    this.store.setCandidates(runId, candidates);
    for (const candidate of [...candidates].sort((a, b) => a.rank - b.rank)) this.event(runId, "CANDIDATE_FOUND", "AGENT", "Candidate found.", candidate.id);
    this.transition(run, { status: "AWAITING_SELECTION" });
    this.event(runId, "CANDIDATES_READY", "AGENT", "Candidate list is ready for human selection.");
    return this.snapshotOrThrow(runId);
  }

  selectCandidate(runId: string, candidateId: string): RunSnapshot {
    const run = this.runOrThrow(runId);
    this.requireStatus(run, "AWAITING_SELECTION");
    const candidate = this.candidateOrThrow(runId, candidateId);
    if (candidate.status !== "PROPOSED") throw new GatewayError("INVALID_TRANSITION", "Only a PROPOSED candidate can be selected");
    this.updateCandidate(runId, candidate, { status: "SELECTED" });
    const { decision: _oldDecision, draftIntentId: _oldDraft, signedIntentId: _oldSigned, ...fresh } = run;
    this.transition(fresh as RunType, { selectedCandidateId: candidateId, status: "AWAITING_SIGNATURE" });
    return this.snapshotOrThrow(runId);
  }

  createDraft(runId: string, draftIntentId: string): RunSnapshot {
    const run = this.runOrThrow(runId);
    this.requireStatus(run, "AWAITING_SIGNATURE");
    if (!run.selectedCandidateId) throw new GatewayError("INVALID_TRANSITION", "A candidate must be selected before drafting an intent");
    if (run.draftIntentId) throw new GatewayError("INVALID_TRANSITION", "A draft intent already exists for this selection");
    const id = draftIntentId.trim();
    if (!id) throw new GatewayError("VALIDATION_ERROR", "draftIntentId must be non-empty");
    this.transition(run, { draftIntentId: id });
    this.event(runId, "DRAFT_CREATED", "SYSTEM", "Unsigned intent draft created.", run.selectedCandidateId, { draftIntentId: id });
    return this.snapshotOrThrow(runId);
  }

  async submitSignedQuote(runId: string, input: { signedIntentId: string; quoteId: string; signedQuote: unknown }): Promise<RunSnapshot> {
    let run = this.runOrThrow(runId);
    this.requireStatus(run, "AWAITING_SIGNATURE");
    if (!run.selectedCandidateId || !run.draftIntentId) throw new GatewayError("INVALID_TRANSITION", "A selected candidate and draft intent are required");
    if (!input.signedIntentId.trim() || !input.quoteId.trim()) throw new GatewayError("VALIDATION_ERROR", "signedIntentId and quoteId must be non-empty");
    const candidateId = run.selectedCandidateId;
    const candidate = this.candidateOrThrow(runId, candidateId);
    run = this.transition(run, { signedIntentId: input.signedIntentId, status: "VERIFYING" });
    this.event(runId, "INTENT_SIGNED", "USER", "Intent Contract signed.", candidateId, { signedIntentId: input.signedIntentId });
    this.event(runId, "QUOTE_SUBMITTED", "GATEWAY", "Signed merchant quote submitted for verification.", candidateId, { quoteId: input.quoteId });

    let verification;
    try { verification = await this.deps.quoteVerifier.verify({ runId, candidateId, quoteId: input.quoteId, signedQuote: input.signedQuote }); }
    catch { verification = { ok: false as const, reason: "Quote verifier unavailable" }; }
    // Do not persist, clone, inspect, serialize, or emit the supplied signed quote.
    if (!verification.ok || !this.validVerifiedQuote(verification, candidate, input.quoteId)) {
      this.event(runId, "QUOTE_SIGNATURE_FAILED", "GATEWAY", "Quote signature or identity verification failed.", candidateId, { quoteId: input.quoteId });
      this.event(runId, "ENGINE_DECIDED", "ENGINE", "Quote was rejected as tampered.", candidateId, { outcome: "TAMPER_REJECT" });
      run = this.transition(run, { decision: { outcome: "TAMPER_REJECT", reasonCodes: [] } });
      this.updateCandidate(runId, candidate, { quoteId: input.quoteId, status: "TAMPER_REJECTED" });
      return this.returnToSelection(run, candidateId);
    }

    const verifiedCandidate = this.updateCandidate(runId, candidate, { quoteId: input.quoteId, quoteTotalCents: verification.quoteTotalCents });
    this.event(runId, "QUOTE_SIGNATURE_VERIFIED", "GATEWAY", "Quote signature verified.", candidateId, { quoteId: input.quoteId });
    let decision: Decision;
    try { decision = RunDecision.parse(await this.deps.decision.decide({ run, candidate: verifiedCandidate, verifiedQuote: verification })); }
    catch (error) {
      const failed = this.transition(run, { status: "FAILED" });
      this.event(runId, "RUN_FAILED", "SYSTEM", "Decision service failed; payment was not attempted.", candidateId);
      if (error instanceof GatewayError) throw error;
      return this.snapshotOrThrow(failed.id);
    }
    run = this.transition(run, { decision });
    this.event(runId, "ENGINE_DECIDED", "ENGINE", `Engine outcome: ${decision.outcome}.`, candidateId, { outcome: decision.outcome });
    if (decision.outcome === "ALLOW") return this.executeAllowed(run, verifiedCandidate, decision);
    if (decision.outcome === "STEP_UP") {
      this.updateCandidate(runId, verifiedCandidate, { status: "STEP_UP" });
      run = this.transition(run, { status: "STEP_UP_REQUIRED" });
      this.event(runId, "STEP_UP_REQUIRED", "GATEWAY", "Human review is required.", candidateId);
      return this.snapshotOrThrow(runId);
    }
    this.updateCandidate(runId, verifiedCandidate, { status: decision.outcome === "BLOCK" ? "BLOCKED" : "TAMPER_REJECTED" });
    return this.returnToSelection(run, candidateId);
  }

  async decideStepUp(runId: string, decision: "APPROVE" | "REJECT"): Promise<RunSnapshot> {
    let run = this.runOrThrow(runId);
    this.requireStatus(run, "STEP_UP_REQUIRED");
    if (!run.selectedCandidateId || !run.decision) throw new GatewayError("INVALID_TRANSITION", "No pending step-up candidate exists");
    const candidate = this.candidateOrThrow(runId, run.selectedCandidateId);
    const currentDecision = run.decision;
    if (decision === "REJECT") {
      this.event(runId, "STEP_UP_REJECTED", "USER", "Human rejected the step-up request.", candidate.id);
      this.updateCandidate(runId, candidate, { status: "DISCARDED" });
      return this.returnToSelection(run, candidate.id);
    }
    this.event(runId, "STEP_UP_APPROVED", "USER", "Human approved the step-up request.", candidate.id);
    run = this.transition(run, { status: "VERIFYING" });
    return this.executeAllowed(run, candidate, currentDecision);
  }

  private validVerifiedQuote(value: unknown, candidate: Candidate, quoteId: string): value is VerifiedQuote {
    if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true) return false;
    const quote = value as VerifiedQuote;
    return quote.merchantId === candidate.merchantId && quote.sku === candidate.sku && Number.isSafeInteger(quote.quoteTotalCents) && quote.quoteTotalCents >= 0 && Boolean(quoteId);
  }

  private async executeAllowed(run: RunType, candidate: Candidate, decision: Decision): Promise<RunSnapshot> {
    if (decision.outcome !== "ALLOW" && decision.outcome !== "STEP_UP") throw new GatewayError("INVALID_TRANSITION", "Only ALLOW or approved STEP_UP decisions can execute payment");
    if (!Number.isSafeInteger(decision.computedTotalCents) || decision.computedTotalCents === undefined || decision.computedTotalCents < 0) {
      run = this.transition(run, { status: "FAILED" });
      this.updateCandidate(run.id, candidate, { status: "BLOCKED" });
      this.event(run.id, "RUN_FAILED", "SYSTEM", "Decision did not provide a valid computed total; payment was not attempted.", candidate.id);
      return this.snapshotOrThrow(run.id);
    }
    const amountCents = decision.computedTotalCents;
    let payment: { receiptId: string; status: "COMPLETED" };
    try {
      payment = await this.deps.payment.execute({ runId: run.id, candidateId: candidate.id, amountCents, currency: "USD", idempotencyKey: `${run.id}:${candidate.id}` });
    } catch {
      run = this.transition(run, { status: "FAILED" });
      this.updateCandidate(run.id, candidate, { status: "DISCARDED" });
      this.event(run.id, "RUN_FAILED", "SYSTEM", "Payment service failed.", candidate.id);
      return this.snapshotOrThrow(run.id);
    }
    this.event(run.id, "PAYMENT_EXECUTED", "GATEWAY", "Mock payment completed.", candidate.id, { amountCents, currency: "USD", status: payment.status });
    let updatedDecision: Decision = { ...decision, receiptId: payment.receiptId };
    try {
      const issued = await this.deps.evidence.issue({ run, candidate, decision: updatedDecision, receiptId: payment.receiptId });
      updatedDecision = RunDecision.parse({ ...updatedDecision, evidenceId: issued.evidenceId });
      this.event(run.id, "EVIDENCE_ISSUED", "GATEWAY", "Evidence issued for the completed payment.", candidate.id, { evidenceId: issued.evidenceId, receiptId: payment.receiptId });
    } catch {
      run = this.transition(run, { status: "FAILED", decision: updatedDecision });
      this.event(run.id, "RUN_FAILED", "SYSTEM", "Evidence service failed after mock payment completion.", candidate.id);
      return this.snapshotOrThrow(run.id);
    }
    this.updateCandidate(run.id, candidate, { status: "ALLOWED" });
    run = this.transition(run, { status: "COMPLETED", decision: updatedDecision });
    this.event(run.id, "RUN_COMPLETED", "SYSTEM", "Run completed.", candidate.id);
    return this.snapshotOrThrow(run.id);
  }

  private returnToSelection(run: RunType, rejectedCandidateId: string): RunSnapshot {
    const next = this.store.getCandidates(run.id).filter((candidate) => candidate.status === "PROPOSED").sort((a, b) => a.rank - b.rank)[0];
    const { selectedCandidateId: _selected, draftIntentId: _draft, signedIntentId: _signed, ...rest } = run;
    this.transition(rest as RunType, { status: "AWAITING_SELECTION" });
    this.event(run.id, "NEXT_CANDIDATE", "GATEWAY", "Select another candidate to continue.", next?.id);
    return this.snapshotOrThrow(run.id);
  }

  getRun(runId: string): RunSnapshot { return this.snapshotOrThrow(runId); }
  getEvents(runId: string, afterSeq = 0) {
    this.runOrThrow(runId);
    return this.store.getEvents(runId, afterSeq);
  }
}
