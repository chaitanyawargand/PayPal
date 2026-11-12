import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecourseDatabase, type RecourseDatabase } from "../../db/src/index.js";
import { MockPsp } from "../../psp/src/mock.js";
import { MockPspPaymentAdapter } from "../../phase7-gateway/src/mock-psp.js";
import { GatewayService } from "../../phase7-gateway/src/gateway-service.js";
import type { PaymentPort } from "../../phase7-gateway/src/ports.js";
import {
  EngineDecisionAdapter,
  HmacQuoteVerifier,
  InMemorySpendLedger,
  InMemoryVerifiedQuoteStore,
  IntentContractResolver,
  signIntentDraft,
} from "../../phase7-host/src/index.js";
import { TighteningJudge } from "../../phase7-judge/src/judge-service.js";
import type { JudgeModelPort, JudgeFacts } from "../../phase7-judge/src/model.js";
import { AgentService } from "../../phase7-agent/src/agent-service.js";
import type {
  ToolTransport,
  SearchStoreInput,
  GetProductInput,
  RequestQuoteInput,
  QuoteToolResult,
  MerchantBaseUrls,
} from "../../phase7-agent/src/merchant-tools.js";
import { HttpMerchantToolTransport } from "../../phase7-agent/src/merchant-tools.js";
import { compileDraftContract } from "../../compiler/src/compiler.js";
import { NovaMartStorefront } from "../../stores/novamart/src/storefront.js";
import { DealDemonStorefront } from "../../stores/dealdemon/src/storefront.js";
import { PeerMarketStorefront } from "../../stores/peermarket/src/storefront.js";
import { buildEvidencePack } from "../../evidence/src/pack.js";
import { verifyEvidencePack } from "../../evidence/src/verify.js";
import { generateSigningKeyPair } from "../../ledger/src/sign.js";
import { SignedReceiptLedger } from "../../ledger/src/store.js";
import type {
  SystemStatus,
  SpendingContractInput,
  PlantedAttack,
  EvidenceVerificationResult,
} from "./types.js";
import type { Run } from "../../phase7-contracts/src/run.js";
import type { CandidateCard } from "../../phase7-contracts/src/candidate.js";
import type { Event } from "../../phase7-contracts/src/event.js";
import { AutonomousMissionOrchestrator, type Mission, type MissionCandidate, type MissionDraft, type MissionDraftView, type MissionView } from "../../phase7-agent/src/autonomous-mission.js";
import type { Contract } from "../../core/src/contract.js";
import { AgentBrainService, type AgentBrainService as AgentBrainServiceType, type IntentBrainStatus } from "../../phase7-agent/src/agent-brain.js";

function extractSearchQuery(prompt: string): { query: string; maxBudgetCents?: number } {
  const budgetMatch = prompt.match(/\$?([0-9]+(?:\.[0-9]{2})?)/);
  const maxBudgetCents = budgetMatch ? Math.round(parseFloat(budgetMatch[1]!) * 100) : undefined;

  const lower = prompt.toLowerCase();
  // Check for direct SKU
  const skuMatch = prompt.match(/\b(hdp-\d{3}|jkt-\d{3}|run-\d{3}|bpk-\d{3})\b/i);
  if (skuMatch) {
    return { query: skuMatch[1].toUpperCase(), maxBudgetCents };
  }

  // Canonical product categories
  if (lower.includes("headphone") || lower.includes("earbud")) {
    return { query: "headphones", maxBudgetCents };
  }
  if (lower.includes("jacket") || lower.includes("parka") || lower.includes("rain")) {
    return { query: "jacket", maxBudgetCents };
  }
  if (lower.includes("shoe") || lower.includes("running") || lower.includes("trainer")) {
    return { query: "running", maxBudgetCents };
  }
  if (lower.includes("backpack") || lower.includes("pack")) {
    return { query: "backpack", maxBudgetCents };
  }

  // Stop words stripping
  const stopWords = new Set([
    "cheapest", "cheap", "expensive", "best", "find", "buy", "get", "search", "looking", "for",
    "max", "min", "budget", "under", "all-in", "all", "in", "no", "not", "without",
    "subscription", "subscriptions", "gift", "card", "cards", "ask", "me", "about",
    "unverified", "verified", "seller", "sellers", "store", "stores", "merchant", "merchants",
    "please", "the", "a", "an", "and", "or", "with", "only"
  ]);

  const words = prompt
    .replace(/[^\w\s-]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w) && !/^\d+$/.test(w));

  const query = words.slice(0, 2).join(" ") || prompt.trim();
  return { query, maxBudgetCents };
}

class HybridMerchantToolTransport implements ToolTransport {
  private httpTransport: HttpMerchantToolTransport;
  private quoteCache = new Map<string, any>();

  constructor(
    private novamart: NovaMartStorefront,
    private dealdemon: DealDemonStorefront,
    private peermarket: PeerMarketStorefront,
    private remoteQuoteAccess: Readonly<Record<"novamart" | "dealdemon" | "peermarket", boolean>>,
    private baseUrls: MerchantBaseUrls,
  ) { this.httpTransport = new HttpMerchantToolTransport(globalThis.fetch.bind(globalThis), 2500, baseUrls); }

  private getStore(merchantId: "novamart" | "dealdemon" | "peermarket") {
    if (merchantId === "novamart") return this.novamart;
    if (merchantId === "dealdemon") return this.dealdemon;
    return this.peermarket;
  }

  async searchStore(input: SearchStoreInput) {
    if (this.remoteQuoteAccess[input.merchantId]) {
      try {
        return await this.httpTransport.searchStore(input);
      } catch {
        // Network failures fall back to this process's matching signer/verifier key.
      }
    }
    const store = this.getStore(input.merchantId);
    let results = store.search({ query: input.query });
    if (results.length === 0) {
      const tokens = input.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
      for (const token of tokens) {
        results = store.search({ query: token });
        if (results.length > 0) break;
      }
    }
    return results.map((r: any) => ({
      sku: r.product.sku,
      slug: r.product.slug,
      name: r.product.name,
      brand: r.product.brand,
      category: r.product.category,
      features: r.product.features.slice(0, 2),
      advertisedUnitPriceCents: r.offer.unitPriceCents,
      estimatedTotalForOneCents: r.estimatedTotalForOneCents,
      rating: r.offer.rating,
      reviewCount: r.offer.reviewCount,
      stock: r.offer.stock,
      seller: r.seller ?? {
        id: input.merchantId,
        name: input.merchantId === "novamart" ? "NovaMart Official"
          : input.merchantId === "peermarket" ? "PeerMarket Seller"
          : input.merchantId === "dealdemon" ? "DealDemon" : input.merchantId,
        verified: input.merchantId === "novamart",
      },
      productUrl: `/products/${r.product.slug}`,
    }));
  }

  async getProduct(input: GetProductInput) {
    if (this.remoteQuoteAccess[input.merchantId]) {
      try {
        return await this.httpTransport.getProduct(input);
      } catch {
        // Network failures fall back to this process's matching signer/verifier key.
      }
    }
    const store = this.getStore(input.merchantId);
    const product = store.productDetail(input.sku);
    if (!product) throw new Error(`Product ${input.sku} not found`);
    return product as any;
  }

  async requestQuote(input: RequestQuoteInput): Promise<QuoteToolResult> {
    if (this.remoteQuoteAccess[input.merchantId]) {
      try {
        const quoteRes = await this.httpTransport.requestQuote(input);
        try {
          const fullRes = await fetch(`${this.baseUrls[input.merchantId]}/api/quotes/${encodeURIComponent(quoteRes.quoteId)}`);
          if (fullRes.ok) this.quoteCache.set(quoteRes.quoteId, await fullRes.json());
        } catch {
          // Keep the summary; getSignedQuote will make one server-side retrieval attempt.
        }
        return quoteRes;
      } catch {
        // Network failures fall back to this process's matching signer/verifier key.
      }
    }
    const store = this.getStore(input.merchantId);
    const cart = store.getCart();
    store.addCartItem(cart.id, input.sku, input.quantity, input.variant);
    const quote = store.createQuote(cart.id, "STANDARD");
    this.quoteCache.set(quote.quoteId, quote);
    return { quoteId: quote.quoteId, quoteTotalCents: quote.totalCents, advertisedTotalCents: quote.totalCents };
  }

  getCachedQuote(quoteId: string): any | undefined {
    return this.quoteCache.get(quoteId);
  }
}

export class DataAdapter {
  private dbDir: string;
  private db: RecourseDatabase;
  private quoteStore = new InMemoryVerifiedQuoteStore();
  private spendLedger = new InMemorySpendLedger();
  private psp = new MockPsp();
  private pspAdapter: MockPspPaymentAdapter;

  private userPrivateKeyPem: string;
  private userPublicKeyPem: string;

  private merchantSecrets: { novamart: string; dealdemon: string; peermarket: string };
  private novamartStore: NovaMartStorefront;
  private dealdemonStore: DealDemonStorefront;
  private peermarketStore: PeerMarketStorefront;

  private toolTransport: HybridMerchantToolTransport;
  private gateway: GatewayService;
  private agentService: AgentService;
  private missionService: AutonomousMissionOrchestrator;
  private agentBrain: AgentBrainServiceType;
  private remoteQuoteAccess: Record<"novamart" | "dealdemon" | "peermarket", boolean>;
  private merchantBaseUrls: MerchantBaseUrls;
  private missionCandidates = new Map<string, { runId: string; candidate: CandidateCard }>();
  private judgeStatus: "CONNECTED" | "UNAVAILABLE" = "CONNECTED";
  private plantedAttack: PlantedAttack | null = null;

  private ledgerKeys = generateSigningKeyPair();
  private receiptLedger: SignedReceiptLedger;
  private evidencePacks = new Map<string, any>();

  constructor(agentBrain: AgentBrainServiceType = new AgentBrainService({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    RECOURSE_AGENT_BRAIN: process.env.RECOURSE_AGENT_BRAIN,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    GEMINI_TIMEOUT_MS: process.env.GEMINI_TIMEOUT_MS,
  }), options: { merchantBaseUrls?: MerchantBaseUrls } = {}) {
    this.agentBrain = agentBrain;
    this.dbDir = mkdtempSync(join(tmpdir(), "recourse-p7c-"));
    this.db = createRecourseDatabase({ path: join(this.dbDir, "app.sqlite") });

    // Host user keypair - private key remains strictly server-side
    const keys = generateKeyPairSync("ed25519");
    this.userPrivateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    this.userPublicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

    const configuredMerchantSecrets = {
      novamart: process.env.NOVAMART_QUOTE_SECRET,
      dealdemon: process.env.DEALDEMON_QUOTE_SECRET,
      peermarket: process.env.PEERMARKET_QUOTE_SECRET,
    };
    this.remoteQuoteAccess = {
      novamart: Boolean(configuredMerchantSecrets.novamart),
      dealdemon: Boolean(configuredMerchantSecrets.dealdemon),
      peermarket: Boolean(configuredMerchantSecrets.peermarket),
    };
    this.merchantBaseUrls = options.merchantBaseUrls ?? {
      novamart: "http://127.0.0.1:8801", dealdemon: "http://127.0.0.1:8802", peermarket: "http://127.0.0.1:8803",
    };
    this.merchantSecrets = {
      novamart: configuredMerchantSecrets.novamart ?? randomBytes(32).toString("base64url"),
      dealdemon: configuredMerchantSecrets.dealdemon ?? randomBytes(32).toString("base64url"),
      peermarket: configuredMerchantSecrets.peermarket ?? randomBytes(32).toString("base64url"),
    };

    this.novamartStore = new NovaMartStorefront(this.merchantSecrets.novamart, this.remoteQuoteAccess.novamart ? "configured" : "ephemeral-dev");
    this.dealdemonStore = new DealDemonStorefront(this.merchantSecrets.dealdemon, this.remoteQuoteAccess.dealdemon ? "configured" : "ephemeral-dev");
    this.peermarketStore = new PeerMarketStorefront(this.merchantSecrets.peermarket, this.remoteQuoteAccess.peermarket ? "configured" : "ephemeral-dev");

    this.receiptLedger = new SignedReceiptLedger(this.ledgerKeys);
    this.pspAdapter = new MockPspPaymentAdapter(this.psp);

    const contractResolver = new IntentContractResolver({
      intents: this.db.intents,
      userPublicKeyPem: this.userPublicKeyPem,
      clock: { now: () => new Date() },
    });

    const quoteVerifier = new HmacQuoteVerifier({
      merchantSecrets: this.merchantSecrets,
      quoteStore: this.quoteStore,
      clock: { now: () => new Date() },
    });

    const engineDecisionAdapter = new EngineDecisionAdapter({
      contractResolver,
      quoteStore: this.quoteStore,
      getSpentCents: (contractId) => this.spendLedger.getSpentCents(contractId),
      clock: { now: () => new Date() },
    });

    const judgeModel: JudgeModelPort = {
      review: (facts: JudgeFacts) => {
        if (this.judgeStatus === "UNAVAILABLE") {
          throw new Error("AI Safety Review is unavailable");
        }
        // DealDemon listings contain prohibited subscriptions and adverse terms -> BLOCK
        if (facts.candidate.merchantId === "dealdemon" || facts.candidate.terms.subscription || facts.candidate.terms.giftCard) {
          return { recommendation: "BLOCK" };
        }
        // Tightening logic: PeerMarket final-sale listings tighten to STEP_UP
        if (facts.candidate.merchantId === "peermarket" && facts.candidate.terms.finalSale) {
          return { recommendation: "STEP_UP" };
        }
        return { recommendation: "KEEP" };
      },
    };

    const tighteningJudge = new TighteningJudge({
      baseDecisionPort: engineDecisionAdapter,
      judgeModel,
    });

    const paymentPort: PaymentPort = {
      execute: async (input) => {
        const result = await this.pspAdapter.execute(input);
        const run = this.gateway.store.getRun(input.runId);
        if (result.status === "COMPLETED" && run?.signedIntentId) {
          this.spendLedger.recordCompleted(run.signedIntentId, input.amountCents);
        }
        return result;
      },
    };

    const evidencePort = {
      issue: async ({ run, candidate, decision, receiptId }: any) => {
        const entry = this.receiptLedger.append({
          receipt_id: receiptId,
          payment_id: `pay_${run.id}_${candidate.id}`,
          contract_id: run.signedIntentId ?? "contract_intent",
          merchant_id: candidate.merchantId,
          order_id: `order_${candidate.quoteId ?? "quote"}`,
          capture_id: `capture_${receiptId}`,
          verdict: decision.outcome === "ALLOW" ? "ALLOW" : "BLOCK",
          reason_codes: decision.reasonCodes ?? [],
          computed_total_cents: decision.computedTotalCents ?? 0,
          money_moved_cents: decision.outcome === "ALLOW" ? (decision.computedTotalCents ?? 0) : 0,
          psp_tier: "C",
        });

        const pack = buildEvidencePack({
          intentContract: {
            id: run.signedIntentId ?? "contract_intent",
            budget_max_cents: 100000,
            allowed_payee_ids: [candidate.merchantId],
            status: "ACTIVE",
          },
          publicKeyPem: this.ledgerKeys.publicKeyPem,
          signedEntries: [entry],
        });

        this.evidencePacks.set(receiptId, pack);
        return { evidenceId: `evidence_${run.id}_${receiptId}` };
      },
    };

    this.gateway = new GatewayService({
      quoteVerifier,
      decision: tighteningJudge,
      payment: paymentPort,
      evidence: evidencePort,
      clock: { now: () => new Date().toISOString() },
      ids: {
        runId: () => `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        eventId: () => `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      },
    });

    this.toolTransport = new HybridMerchantToolTransport(
      this.novamartStore,
      this.dealdemonStore,
      this.peermarketStore,
      this.remoteQuoteAccess,
      this.merchantBaseUrls,
    );

    const agentModel = {
      planSearch: async (prompt: string) => {
        const { query, maxBudgetCents } = extractSearchQuery(prompt);
        return {
          query,
          quantity: 1,
          ...(maxBudgetCents ? { maxBudgetCents } : {}),
        };
      },
      rankCandidates: async (input: any) => ({
        orderedCandidateIds: input.candidates.map((c: any) => c.id),
      }),
    };

    this.agentService = new AgentService({
      gateway: this.gateway,
      tools: this.toolTransport,
      model: agentModel,
    });

    this.missionService = new AutonomousMissionOrchestrator({
      publicKeyPem: this.userPublicKeyPem,
      now: () => new Date(),
      discover: async (mission, excluded) => {
        let snapshot: { run: Run; candidates: CandidateCard[] };
        const requestedSize = mission.requiredAttributes.find((attribute) => attribute.startsWith("size:"))?.slice(5);
        try { snapshot = await this.agentService.startDiscovery(mission.productQuery, mission.quantity, requestedSize ? { size: requestedSize } : {}); }
        catch { return []; }
        const results: MissionCandidate[] = [];
        for (const candidate of snapshot.candidates) {
          const product = await this.toolTransport.getProduct({ merchantId: candidate.merchantId, sku: candidate.sku }).catch(() => undefined);
          const quote = candidate.quoteId ? await this.getSignedQuote(candidate.merchantId, candidate.quoteId).catch(() => undefined) : undefined;
          const missionCandidate: MissionCandidate = {
            id: candidate.id, merchantId: candidate.merchantId, sku: candidate.sku,
            variant: candidate.variantLabel, quoteId: candidate.quoteId ?? "",
            allInCents: candidate.quoteTotalCents ?? candidate.advertisedTotalCents,
            ...(typeof quote?.expiresAt === "string" ? { quoteExpiresAt: quote.expiresAt } : {}),
            terms: {
              finalSale: candidate.terms.finalSale, subscription: candidate.terms.subscription,
              giftCard: candidate.terms.giftCard, returnsDays: candidate.terms.returnsDays,
              sellerVerified: candidate.seller.verified,
            },
            attributes: [
              ...candidate.productName.toLowerCase().split(/\W+/),
              ...(product?.features ?? []).flatMap((feature: string) => feature.toLowerCase().split(/\W+/)),
              ...(candidate.variantLabel ? candidate.variantLabel.split(", ").map((variant) => variant.replace(": ", ":").toLowerCase()) : []),
              ...(candidate.terms.subscription ? ["subscription"] : []),
              ...(candidate.terms.giftCard ? ["gift card"] : []),
            ],
            condition: candidate.terms.condition === "OPEN_BOX" ? "open-box" : candidate.terms.condition === "NEW" ? "new" : "used",
          };
          if ([missionCandidate.id, missionCandidate.quoteId, `${missionCandidate.merchantId}/${missionCandidate.sku}/${missionCandidate.variant ?? "default"}`].some((key) => excluded.has(key))) continue;
          this.missionCandidates.set(candidate.id, { runId: snapshot.run.id, candidate });
          results.push(missionCandidate);
        }
        return results;
      },
      refresh: async (mission, candidate) => {
        const merchantId = candidate.merchantId as "novamart" | "dealdemon" | "peermarket";
        const product = await this.toolTransport.getProduct({ merchantId, sku: candidate.sku });
        const variant = candidate.variant ? Object.fromEntries(candidate.variant.split(", ").map((entry) => { const [key, value] = entry.split(": "); return [key!, value!]; })) : product.defaultVariant;
        const quoteSummary = await this.toolTransport.requestQuote({ merchantId, sku: candidate.sku, quantity: mission.quantity, variant });
        const quote = await this.getSignedQuote(merchantId, quoteSummary.quoteId);
        const ref = this.missionCandidates.get(candidate.id);
        if (ref) {
          const updated = this.gateway.store.updateCandidate(ref.runId, { ...ref.candidate, quoteId: quoteSummary.quoteId, quoteTotalCents: quoteSummary.quoteTotalCents, advertisedTotalCents: quoteSummary.advertisedTotalCents });
          this.missionCandidates.set(candidate.id, { ...ref, candidate: updated });
        }
        return { ...candidate, quoteId: quoteSummary.quoteId, allInCents: quoteSummary.quoteTotalCents, quoteExpiresAt: quote.expiresAt };
      },
      submit: async (mission, item) => {
        const ref = this.missionCandidates.get(item.id);
        if (!ref) return { outcome: "TAMPER_REJECT", runId: "run_missing", captureDelta: 0, capturedCents: 0, alert: "Candidate was not registered by server discovery." };
        const before = this.psp.captureCount();
        const beforeCents = this.psp.totalCapturedCents();
        this.gateway.selectCandidate(ref.runId, ref.candidate.id);
        this.gateway.createDraft(ref.runId, mission.id);
        const signedQuote = await this.getSignedQuote(item.merchantId, item.quoteId);
        const result = await this.gateway.submitSignedQuote(ref.runId, { signedIntentId: mission.id, quoteId: item.quoteId, signedQuote });
        const delta = this.psp.captureCount() - before;
        const capturedCents = this.psp.totalCapturedCents() - beforeCents;
        const decision = result.run.decision;
        const evidence = decision?.receiptId ? await this.verifyEvidence(decision.receiptId) : undefined;
        const outcome = decision?.outcome ?? "BLOCK";
        if (outcome === "TAMPER_REJECT") return { outcome, runId: ref.runId, captureDelta: delta, capturedCents, alert: "Quote signature validation failed." };
        return { outcome, runId: ref.runId, captureDelta: delta, capturedCents, ...(evidence ? { evidenceValid: evidence.valid } : {}) };
      },
      stepUp: async (_mission, item, runId, decision) => {
        const before = this.psp.captureCount();
        const beforeCents = this.psp.totalCapturedCents();
        const result = await this.gateway.decideStepUp(runId, decision);
        const delta = this.psp.captureCount() - before;
        const capturedCents = this.psp.totalCapturedCents() - beforeCents;
        const evidence = result.run.decision?.receiptId ? await this.verifyEvidence(result.run.decision.receiptId) : undefined;
        return { outcome: decision === "REJECT" ? "BLOCK" : "ALLOW", runId, captureDelta: delta, capturedCents, ...(evidence ? { evidenceValid: evidence.valid } : {}) };
      },
    }, this.userPrivateKeyPem);
  }

  getGateway(): GatewayService {
    return this.gateway;
  }

  async getStatus(): Promise<SystemStatus & { pspCaptures: number; pspCapturedCents: number }> {
    const probeStore = async (
      id: string,
      name: string,
      port: number,
      type: "Honest Retailer" | "Discount Store" | "Risky Marketplace",
    ) => {
      let online = false;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 500);
        const res = await fetch(`http://127.0.0.1:${port}/`, { signal: ctrl.signal });
        clearTimeout(t);
        online = res.ok || res.status < 500;
      } catch {
        online = false;
      }
      return {
        id,
        name,
        port,
        url: `http://localhost:${port}`,
        type,
        online,
      };
    };

    const stores = await Promise.all([
      probeStore("novamart", "NovaMart Official", 8801, "Honest Retailer"),
      probeStore("dealdemon", "DealDemon", 8802, "Discount Store"),
      probeStore("peermarket", "PeerMarket", 8803, "Risky Marketplace"),
    ]);

    return {
      gateway: "READY",
      aiJudge: this.judgeStatus,
      paymentMode: "Mock PSP",
      stores,
      pspCaptures: this.psp.captureCount(),
      pspCapturedCents: this.psp.totalCapturedCents(),
    };
  }

  getPspStats() {
    return {
      captureCount: this.psp.captureCount(),
      capturedCents: this.psp.totalCapturedCents(),
    };
  }

  setAiJudgeStatus(status: "CONNECTED" | "UNAVAILABLE") {
    this.judgeStatus = status;
  }

  async startDiscovery(prompt: string): Promise<{ run: Run; candidates: CandidateCard[] }> {
    return this.agentService.startDiscovery(prompt);
  }

  async startMission(prompt: string): Promise<MissionView> {
    const intent = await this.agentBrain.draft(prompt);
    const initial = this.missionService.start(prompt, intent.draft);
    if (initial.status !== "READY_TO_SIGN") return initial;
    const mission = this.missionService.getSignedMission(initial.missionId)!;
    await this.db.intents.saveIntent(mission.contract as Contract);
    return this.missionService.begin(initial.missionId, mission);
  }

  async prepareMissionDraft(prompt: string): Promise<MissionDraftView> {
    const intent = await this.agentBrain.draft(prompt);
    return this.missionService.prepareDraft(prompt, intent.draft);
  }

  answerMissionDraft(draftId: string, fields: Partial<MissionDraft> & { confirmHardCap?: boolean }, revision: number): MissionDraftView {
    return this.missionService.answerDraft(draftId, fields, revision);
  }

  editMissionDraft(draftId: string, fields: Partial<MissionDraft>, revision: number): MissionDraftView {
    return this.missionService.editDraft(draftId, fields, revision);
  }

  async signStartMissionDraft(draftId: string, fields: Partial<MissionDraft>, revision: number): Promise<MissionView> {
    const mission = this.missionService.signDraft(draftId, fields, revision);
    await this.db.intents.saveIntent(mission.contract as Contract);
    return this.missionService.beginSignedMission(mission.id);
  }

  getMissionStatus(missionId: string): MissionView | undefined { return this.missionService.getMissionView(missionId); }

  assertMissionNotSigned(missionId: string): void {
    if (this.missionService.isSignedMission(missionId)) throw new Error("Signed mission fields are locked and cannot be edited.");
  }

  getAgentBrainStatus(): IntentBrainStatus { return this.agentBrain.getStatus(); }

  async decideMissionStepUp(missionId: string, decision: "APPROVE" | "REJECT"): Promise<MissionView> {
    const mission = this.missionService.getSignedMission(missionId);
    if (!mission) throw new Error("Mission not found.");
    return this.missionService.decideStepUp(missionId, mission, decision);
  }

  abortMission(missionId: string): MissionView { return this.missionService.abortPausedMission(missionId); }

  selectCandidate(runId: string, candidateId: string): { run: Run; candidates: CandidateCard[] } {
    return this.gateway.selectCandidate(runId, candidateId);
  }

  async compileAndSign(
    runId: string,
    limits: SpendingContractInput,
    candidateIdOverride?: string,
  ): Promise<{ run: Run; candidates: CandidateCard[]; contract: any }> {
    let snapshot = this.gateway.getRun(runId);
    let selectedCandidateId = candidateIdOverride || snapshot.run.selectedCandidateId;

    if (!selectedCandidateId) {
      const defaultCandidate = snapshot.candidates.find((c) => c.status === "PROPOSED") ?? snapshot.candidates[0];
      if (!defaultCandidate) throw new Error("No proposed candidate available for run");
      selectedCandidateId = defaultCandidate.id;
      const updated = this.gateway.selectCandidate(runId, selectedCandidateId);
      snapshot = updated;
    } else if (snapshot.run.status === "AWAITING_SELECTION" || snapshot.run.selectedCandidateId !== selectedCandidateId) {
      const updated = this.gateway.selectCandidate(runId, selectedCandidateId);
      snapshot = updated;
    }

    const candidate = snapshot.candidates.find((c) => c.id === selectedCandidateId);
    if (!candidate) throw new Error(`Selected candidate ${selectedCandidateId} not found`);

    const blockedCategories: string[] = [];
    if (limits.noSubscriptions) blockedCategories.push("subscription");
    if (limits.noGiftCards) blockedCategories.push("gift_card");

    const expiryMinutes = limits.expiryMinutes ?? 15;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

    const maxBudgetCents = limits.maxBudgetCents > 0 ? limits.maxBudgetCents : 10000;
    const perOrderCapCents = limits.perOrderCapCents && limits.perOrderCapCents > 0
      ? limits.perOrderCapCents
      : maxBudgetCents;

    const compiled = compileDraftContract({
      prompt: snapshot.run.prompt,
      payer_id: "payer_user",
      allowed_payee_ids: limits.allowedPayees ?? [candidate.merchantId],
      budget_max_cents: maxBudgetCents,
      per_order_cap_cents: perOrderCapCents,
      blocked_categories: blockedCategories,
      expires_at: expiresAt,
    });

    if (compiled.status === "NEEDS_CLARIFICATION" || !compiled.draft) {
      throw new Error("Contract limits need clarification");
    }

    const shipToHash = createHash("sha256").update("phase7-ship-to-not-collected", "utf8").digest("hex");
    const contract = signIntentDraft({
      draft: compiled.draft,
      shipToHash,
      privateKeyPem: this.userPrivateKeyPem,
      now: new Date(),
    });

    await this.db.intents.saveIntent(contract);
    this.gateway.createDraft(runId, contract.id);

    // Retrieve signed quote for candidate
    const signedQuote = await this.getSignedQuote(candidate.merchantId, candidate.quoteId!);

    // Submit signed quote to gateway (verification, engine decision, payment if allowed)
    const result = await this.gateway.submitSignedQuote(runId, {
      signedIntentId: contract.id,
      quoteId: candidate.quoteId!,
      signedQuote,
    });

    return {
      run: result.run,
      candidates: result.candidates,
      contract,
    };
  }

  private async getSignedQuote(merchantId: string, quoteId: string): Promise<any> {
    const cached = this.toolTransport.getCachedQuote(quoteId);
    if (cached) return cached;

    try {
      if (!this.remoteQuoteAccess[merchantId as keyof typeof this.remoteQuoteAccess]) throw new Error("Remote quote access is not configured.");
      const res = await fetch(`${this.merchantBaseUrls[merchantId as keyof typeof this.merchantBaseUrls]}/api/quotes/${encodeURIComponent(quoteId)}`);
      if (res.ok) return await res.json();
    } catch {
      // ignore network error and fall back to in-process store
    }

    const store =
      merchantId === "novamart"
        ? this.novamartStore
        : merchantId === "dealdemon"
          ? this.dealdemonStore
          : this.peermarketStore;

    const quote = store.getIssuedQuote(quoteId);
    if (quote) return quote;
    throw new Error(`Signed quote ${quoteId} not found on merchant ${merchantId}`);
  }

  async decideStepUp(runId: string, decision: "APPROVE" | "REJECT"): Promise<{ run: Run; candidates: CandidateCard[] }> {
    return this.gateway.decideStepUp(runId, decision);
  }

  getRun(runId: string): { run: Run; candidates: CandidateCard[] } {
    return this.gateway.getRun(runId);
  }

  getEvents(runId: string, afterSeq = 0): Event[] {
    return this.gateway.getEvents(runId, afterSeq);
  }

  async plantAttack(attack: PlantedAttack): Promise<{ success: boolean; message: string }> {
    this.plantedAttack = { ...attack, plantedAt: new Date().toISOString() };
    return {
      success: true,
      message: `Attack registered on store '${attack.storeId}' for SKU '${attack.productSku}' in '${attack.placement}'`,
    };
  }

  getPlantedAttack(): PlantedAttack | null {
    return this.plantedAttack;
  }

  clearPlantedAttack(): void {
    this.plantedAttack = null;
  }

  async verifyEvidence(receiptId: string): Promise<EvidenceVerificationResult> {
    const pack = this.evidencePacks.get(receiptId);
    if (!pack) {
      return {
        valid: false,
        checks: { chain: false, signatures: false },
        failures: [`Evidence pack for receipt '${receiptId}' not found`],
      };
    }
    return verifyEvidencePack(pack);
  }

  close() {
    try {
      this.db.close();
      rmSync(this.dbDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
