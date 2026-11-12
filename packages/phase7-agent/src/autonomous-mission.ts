import { randomUUID } from "node:crypto";
import { z } from "zod";
import { verifyIntentContract } from "../../phase7-host/src/contract-resolver.js";
import { signContractPayload } from "../../phase7-host/src/contract-resolver.js";
import type { Contract } from "../../core/src/contract.js";

export const MissionSchema = z.object({
  id: z.string().min(1), nonce: z.string().min(1), productQuery: z.string().min(1),
  requiredAttributes: z.array(z.string()), preferredAttributes: z.array(z.string()), exclusions: z.array(z.string()),
  quantity: z.number().int().min(1).max(100), condition: z.enum(["new", "open-box", "used"]),
  maxAllInCapCents: z.number().int().positive(), terms: z.array(z.string()), maxAttempts: z.number().int().min(1).max(4),
  expiresAt: z.string().datetime(), contract: z.unknown(),
}).strict();
export type Mission = z.infer<typeof MissionSchema>;
export type MissionDraft = Omit<Mission, "id" | "nonce" | "expiresAt" | "contract">;
export type MissionOutcome = "ALLOW" | "STEP_UP" | "BLOCK" | "TAMPER_REJECT";
export type MissionCandidate = {
  id: string; merchantId: string; sku: string; variant?: string; quoteId: string;
  allInCents: number; quoteExpiresAt?: string; attributes: string[]; condition: "new" | "open-box" | "used";
  terms?: { finalSale: boolean; subscription: boolean; giftCard: boolean; returnsDays: number; sellerVerified: boolean };
};
export type MissionSubmitResult = { outcome: MissionOutcome; runId: string; captureDelta: number; capturedCents: number; evidenceValid?: boolean; alert?: string };
export type MissionView = { missionId: string; status: "NEEDS_CLARIFICATION" | "READY_TO_SIGN" | "SEARCHING" | "STEP_UP_REQUIRED" | "COMPLETED" | "NO_PURCHASE" | "ABORTED"; questions: string[]; events: string[]; attempts: number; capturedCents: number; runId?: string; evidenceValid?: boolean; securityAlert?: string };
export type MissionPorts = {
  publicKeyPem: string; now(): Date; discover(mission: Mission, excluded: ReadonlySet<string>): Promise<MissionCandidate[]>;
  refresh(mission: Mission, candidate: MissionCandidate): Promise<MissionCandidate>;
  submit(mission: Mission, candidate: MissionCandidate): Promise<MissionSubmitResult>;
  stepUp(mission: Mission, candidate: MissionCandidate, runId: string, decision: "APPROVE" | "REJECT"): Promise<MissionSubmitResult>;
};

const INJECTION = /ignore\s+(the\s+)?cap|sign\s+for\s+me|force\s+allow|buy\s+anyway/i;
export function draftMission(prompt: string): { draft?: MissionDraft; questions: string[] } {
  const text = prompt.trim();
  const questions: string[] = [];
  if (!text || /\bbanana\b/i.test(text) || !/headphones?|earbuds?|jacket|shoes?|backpack/i.test(text)) questions.push("What product would you like me to find?");
  if (/\b(?:running\s+)?shoes?\b/i.test(text) && !/\b(?:size\s*|US\s+)(?:[0-9]{1,2}(?:\.5)?|[XSML]{1,3})\b/i.test(text)) questions.push("What shoe size should I search for?");
  if (/\bjacket\b/i.test(text) && !/\bsize\s*(?:[XSML]{1,3}|[0-9]{1,2})\b/i.test(text)) questions.push("What jacket size should I search for?");
  const budget = text.match(/(?:max(?:imum)?|under|up to|budget(?: of)?|cap(?: of)?)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i)
    ?? text.match(/\$\s*(\d+(?:\.\d{1,2})?)\s*(?:all[- ]in|total|max|maximum)/i);
  if (!budget) questions.push("What is your maximum all-in budget, including shipping and fees?");
  if (INJECTION.test(text)) questions.push("Please confirm the product and a hard all-in budget without instructions to bypass safeguards.");
  if (questions.length) return { questions: [...new Set(questions)].slice(0, 3) };
  const productQuery = /headphones?|earbuds?/i.test(text) ? "headphones" : /jacket/i.test(text) ? "jacket" : /shoes?/i.test(text) ? "shoes" : "backpack";
  const amount = Number(budget![1]);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) return { questions: ["What is your maximum all-in budget, including shipping and fees?"] };
  const lower = text.toLowerCase();
  const sizeMatch = text.match(/\bsize\s*(?:[:=]\s*)?([A-Z0-9]+(?:\.5)?)\b/i)
    ?? (/shoes?/i.test(text) ? text.match(/\bUS\s+([0-9]{1,2}(?:\.5)?)\b/i) : null);
  const exclusions = [
    ...( /no\s+(?:auto[- ]renewing\s+)?subscriptions?/i.test(text) ? ["subscription"] : []),
    ...( /no\s+gift[ -]?cards?/i.test(text) ? ["gift card"] : []),
  ];
  const quantity = Number(text.match(/\b(\d+)\s+(?:(?:pairs?|sets?)\s+of\s+)?(?:wireless\s+)?(?:headphones?|earbuds?|jackets?|shoes?|backpacks?|items?|units?|pairs?|sets?)\b/i)?.[1] ?? 1);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) return { questions: ["How many should I search for?"] };
  return { questions: [], draft: {
    productQuery, requiredAttributes: [
      ...(lower.includes("wireless") ? ["wireless"] : []),
      ...(sizeMatch ? [`size:${/shoes?/i.test(text) && /^\d/.test(sizeMatch[1]!) ? `US ${sizeMatch[1]}` : sizeMatch[1]}`] : []),
    ],
    preferredAttributes: ["cheapest"], exclusions, quantity,
    condition: lower.includes("used") ? "used" : lower.includes("open-box") ? "open-box" : "new",
    maxAllInCapCents: Math.round(amount * 100), terms: exclusions.map((item) => `no ${item}`), maxAttempts: 4,
  } };
}

export function signMission(draft: MissionDraft, privateKeyPem: string, now = new Date()): Mission {
  const mission: Mission = MissionSchema.parse({ ...draft, id: `mission_${randomUUID()}`, nonce: randomUUID(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(), contract: null });
  // The existing signed Intent Contract binds every mission field in criteria and its hard cap.
  const criteria = ["nonce", "productQuery", "requiredAttributes", "preferredAttributes", "exclusions", "quantity", "condition", "terms", "maxAttempts"]
    .map((field) => ({ id: `mission:${field}`, type: "structured" as const, field: `mission.${field}`, expected: field === "nonce" ? mission.nonce : mission[field as keyof Mission] }));
  const contract = signContractPayload({
    id: mission.id, family_id: mission.id, version: 1, owner_payer_id: "payer_user", criteria,
    budget_max_cents: mission.maxAllInCapCents, per_order_cap_cents: mission.maxAllInCapCents,
    allowed_payee_ids: ["novamart", "dealdemon", "peermarket"], blocked_categories: ["subscription", "gift_card"],
    expires_at: mission.expiresAt, ship_to_hash: "phase7-ship-to-not-collected", status: "ACTIVE",
  }, privateKeyPem) as Contract;
  return MissionSchema.parse({ ...mission, contract });
}

function verifyMission(mission: Mission, publicKeyPem: string, now: Date): boolean {
  const parsed = MissionSchema.safeParse(mission);
  if (!parsed.success || new Date(parsed.data.expiresAt).getTime() <= now.getTime()) return false;
  const verified = verifyIntentContract(parsed.data.contract, { userPublicKeyPem: publicKeyPem, now });
  if (!verified.ok || verified.contract.id !== parsed.data.id || verified.contract.per_order_cap_cents !== parsed.data.maxAllInCapCents) return false;
  const bound = new Map(verified.contract.criteria.map((criterion) => [criterion.field, criterion.expected]));
  return bound.get("mission.productQuery") === parsed.data.productQuery
    && bound.get("mission.quantity") === parsed.data.quantity
    && bound.get("mission.condition") === parsed.data.condition
    && bound.get("mission.nonce") === parsed.data.nonce
    && JSON.stringify(bound.get("mission.requiredAttributes")) === JSON.stringify(parsed.data.requiredAttributes)
    && JSON.stringify(bound.get("mission.preferredAttributes")) === JSON.stringify(parsed.data.preferredAttributes)
    && JSON.stringify(bound.get("mission.exclusions")) === JSON.stringify(parsed.data.exclusions)
    && JSON.stringify(bound.get("mission.terms")) === JSON.stringify(parsed.data.terms)
    && bound.get("mission.maxAttempts") === parsed.data.maxAttempts;
}

export class AutonomousMissionOrchestrator {
  private missions = new Map<string, { signed: Mission; view: MissionView; tried: Set<string>; pending?: MissionCandidate; pendingRunId?: string }>();
  constructor(private readonly ports: MissionPorts, private readonly privateKeyPem: string) {}

  start(prompt: string): MissionView {
    const parsed = draftMission(prompt);
    if (!parsed.draft) return { missionId: "", status: "NEEDS_CLARIFICATION", questions: parsed.questions, events: [`Prompt received: ${prompt}`], attempts: 0, capturedCents: 0 };
    const mission = signMission(parsed.draft, this.privateKeyPem, this.ports.now());
    const view: MissionView = { missionId: mission.id, status: "READY_TO_SIGN", questions: [], events: [`Prompt received: ${prompt}`, `Mission ${mission.id} signed once with a $${(mission.maxAllInCapCents / 100).toFixed(2)} cap.`], attempts: 0, capturedCents: 0 };
    this.missions.set(mission.id, { signed: mission, view, tried: new Set() });
    return structuredClone(view);
  }

  getSignedMission(id: string): Mission | undefined { const state = this.missions.get(id); return state ? structuredClone(state.signed) : undefined; }

  async begin(id: string, supplied: Mission): Promise<MissionView> {
    const state = this.state(id);
    if (!this.valid(state, supplied)) return this.abort(state, "Mission signature, fields, or expiry did not validate.");
    if (state.view.status !== "READY_TO_SIGN") throw new Error("Mission has already started.");
    state.view.status = "SEARCHING";
    await this.advance(state);
    return structuredClone(state.view);
  }

  async decideStepUp(id: string, supplied: Mission, decision: "APPROVE" | "REJECT"): Promise<MissionView> {
    const state = this.state(id);
    if (!this.valid(state, supplied)) return this.abort(state, "Mission signature, fields, or expiry did not validate.");
    if (state.view.status !== "STEP_UP_REQUIRED" || !state.pending || !state.pendingRunId) throw new Error("Mission is not awaiting STEP_UP approval.");
    state.view.status = "SEARCHING";
    const before = state.view.capturedCents;
    const result = await this.ports.stepUp(state.signed, state.pending, state.pendingRunId, decision);
    if (decision === "REJECT") {
      if (result.captureDelta !== 0) return this.abort(state, "Unexpected capture while rejecting STEP_UP.");
      this.exclude(state, state.pending, "User rejected STEP_UP; candidate excluded.");
      state.pending = undefined; state.pendingRunId = undefined; state.view.status = "SEARCHING";
      await this.advance(state);
    } else {
      if (!this.captureSafe(state, result, before)) return this.abort(state, "Capture limit check failed.");
      state.view.capturedCents = result.capturedCents; state.view.status = "COMPLETED";
      state.view.runId = result.runId; state.view.evidenceValid = result.evidenceValid === true;
      state.view.events.push(`STEP_UP approved. Captured ${result.capturedCents} cents once. Evidence ${state.view.evidenceValid ? "VALID" : "INVALID"}.`);
    }
    return structuredClone(state.view);
  }

  abortPausedMission(id: string): MissionView {
    const state = this.state(id);
    if (state.view.status !== "STEP_UP_REQUIRED") throw new Error("Only a paused mission can be aborted.");
    state.view.status = "ABORTED";
    state.pending = undefined;
    state.pendingRunId = undefined;
    state.view.events.push("User aborted the paused mission. NO_PURCHASE; $0 captured.");
    return structuredClone(state.view);
  }

  private async advance(state: { signed: Mission; view: MissionView; tried: Set<string>; pending?: MissionCandidate; pendingRunId?: string }): Promise<void> {
    while (state.view.status === "SEARCHING" && state.view.attempts < state.signed.maxAttempts) {
      state.view.events.push("Rediscovering eligible offers from NovaMart, DealDemon, and PeerMarket.");
      const candidates = await this.ports.discover(state.signed, state.tried);
      const eligible = candidates.filter((item) => !this.isExcluded(state.tried, item)
        && item.condition === state.signed.condition
        && state.signed.requiredAttributes.every((attribute) => item.attributes.some((actual) => actual.toLowerCase() === attribute.toLowerCase()))
        && !state.signed.exclusions.some((exclusion) => item.attributes.some((actual) => actual.toLowerCase() === exclusion.toLowerCase()))
        && Number.isSafeInteger(item.allInCents) && item.allInCents <= state.signed.maxAllInCapCents)
        .sort((a, b) => b.attributes.filter((attribute) => state.signed.preferredAttributes.some((preferred) => preferred.toLowerCase() === attribute.toLowerCase())).length
          - a.attributes.filter((attribute) => state.signed.preferredAttributes.some((preferred) => preferred.toLowerCase() === attribute.toLowerCase())).length
          || a.allInCents - b.allInCents
          || Number(a.terms?.sellerVerified === false) - Number(b.terms?.sellerVerified === false)
          || Number(a.terms?.finalSale ?? false) - Number(b.terms?.finalSale ?? false)
          || Number(a.terms?.subscription ?? false) - Number(b.terms?.subscription ?? false)
          || Number(a.terms?.giftCard ?? false) - Number(b.terms?.giftCard ?? false)
          || (b.terms?.returnsDays ?? 0) - (a.terms?.returnsDays ?? 0)
          || a.merchantId.localeCompare(b.merchantId) || a.sku.localeCompare(b.sku));
      let candidate = eligible[0];
      if (!candidate) { state.view.status = "NO_PURCHASE"; state.view.events.push("No eligible offer remains. NO_PURCHASE; $0 captured."); return; }
      if (candidate.quoteExpiresAt && new Date(candidate.quoteExpiresAt).getTime() <= this.ports.now().getTime()) {
        const refreshed = await this.ports.refresh(state.signed, candidate);
        if (refreshed.id !== candidate.id || refreshed.merchantId !== candidate.merchantId || refreshed.sku !== candidate.sku
          || refreshed.quoteId === candidate.quoteId || !Number.isSafeInteger(refreshed.allInCents) || refreshed.allInCents < 0) {
          this.abort(state, "Refreshed quote changed candidate identity or contained invalid totals."); return;
        }
        if (new Date(refreshed.quoteExpiresAt ?? 0).getTime() <= this.ports.now().getTime() || refreshed.allInCents > state.signed.maxAllInCapCents) {
          this.exclude(state, candidate, "Expired quote refreshed outside the signed cap; candidate excluded."); continue;
        }
        candidate = refreshed;
      }
      state.view.attempts++;
      state.view.events.push(`Attempt ${state.view.attempts}: ranked ${candidate.merchantId}/${candidate.sku}; submitting in a fresh gateway run.`);
      const before = state.view.capturedCents;
      const result = await this.ports.submit(state.signed, candidate);
      state.view.runId = result.runId;
      state.view.events.push(`Gateway run ${result.runId} returned ${result.outcome}.`);
      if (result.outcome === "TAMPER_REJECT") { this.abort(state, result.alert ?? "Tampered quote detected. Security alert."); return; }
      if (result.outcome === "BLOCK") { if (result.captureDelta !== 0) { this.abort(state, "Unexpected capture after BLOCK."); return; } this.exclude(state, candidate, "Gateway BLOCK; candidate excluded."); continue; }
      if (result.outcome === "STEP_UP") {
        if (result.captureDelta !== 0) { this.abort(state, "Capture occurred while STEP_UP was pending."); return; }
        state.pending = candidate; state.pendingRunId = result.runId; state.view.status = "STEP_UP_REQUIRED";
        state.view.events.push(`Paused for user STEP_UP decision. Captured $0.`); return;
      }
      if (!this.captureSafe(state, result, before)) { this.abort(state, "Capture limit check failed."); return; }
      state.view.capturedCents = result.capturedCents; state.view.status = "COMPLETED";
      state.view.evidenceValid = result.evidenceValid === true;
      state.view.events.push(`Mission complete. Captured ${result.capturedCents} cents once. Evidence ${state.view.evidenceValid ? "VALID" : "INVALID"}.`); return;
    }
    if (state.view.status === "SEARCHING") { state.view.status = "NO_PURCHASE"; state.view.events.push("Attempt limit reached. NO_PURCHASE; $0 captured."); }
  }

  private captureSafe(state: { signed: Mission; view: MissionView }, result: MissionSubmitResult, before: number): boolean {
    return result.captureDelta === 1 && result.capturedCents > 0 && result.capturedCents <= state.signed.maxAllInCapCents && before === 0;
  }
  private isExcluded(tried: Set<string>, c: MissionCandidate): boolean { return [c.id, c.quoteId, `${c.merchantId}/${c.sku}/${c.variant ?? "default"}`].some((key) => tried.has(key)); }
  private exclude(state: { tried: Set<string>; view: MissionView }, c: MissionCandidate, message: string): void {
    state.tried.add(c.id); state.tried.add(c.quoteId); state.tried.add(`${c.merchantId}/${c.sku}/${c.variant ?? "default"}`); state.view.events.push(message);
  }
  private valid(state: { signed: Mission }, supplied: Mission): boolean { return JSON.stringify(supplied) === JSON.stringify(state.signed) && verifyMission(supplied, this.ports.publicKeyPem, this.ports.now()); }
  private state(id: string) { const state = this.missions.get(id); if (!state) throw new Error("Mission not found."); return state; }
  private abort(state: { view: MissionView }, message: string): MissionView { state.view.status = "ABORTED"; state.view.securityAlert = message; state.view.events.push(`Mission aborted. Security alert: ${message} $0 captured.`); return structuredClone(state.view); }
}

