export type ActorType = "AGENT" | "GATEWAY" | "JUDGE" | "AI SAFETY REVIEW" | "HUMAN" | "SYSTEM";

export interface TimelineEvent {
  id: string;
  runId: string;
  timestamp: string;
  actor: ActorType;
  type: string;
  title: string;
  detail?: string;
  url?: string;
  candidateId?: string;
}

export type LineItemKind =
  | "product"
  | "tax"
  | "shipping"
  | "discount"
  | "subscription"
  | "fee"
  | "gift_card";

export interface LineItem {
  label: string;
  amountCents: number;
  kind: LineItemKind;
}

export type CheckStatus = "PASS" | "FAIL" | "WARN";

export interface RuleCheck {
  code: string;
  status: CheckStatus;
  message: string;
}

export interface JudgeFinding {
  severity: "INFO" | "WARN" | "CRITICAL";
  message: string;
  snippet?: string | null;
}

export interface JudgeReview {
  status: "CONNECTED" | "UNAVAILABLE" | "FLAGGED" | "CLEARED";
  findings: JudgeFinding[];
}

export type DecisionType = "ALLOW" | "BLOCK" | "STEP_UP";

export type NextActionType =
  | "PROCEED_TO_PAYMENT"
  | "TRY_NEXT_CANDIDATE"
  | "PAUSE_FOR_HUMAN"
  | "COMPLETED";

export interface CandidateCard {
  candidateId: string;
  orderNumber: number;
  merchant: {
    id: string;
    name: string;
    origin: string;
    verified: boolean;
  };
  product: {
    sku: string;
    title: string;
    url: string;
    imageUrl?: string;
  };
  selectionReason: string;
  advertisedTotalCents: number;
  quotedTotalCents: number;
  lineItems: LineItem[];
  checks: RuleCheck[];
  judge: JudgeReview;
  decision: DecisionType;
  capturedCents: number;
  nextAction: NextActionType;
  untrustedPageText?: string;
  hiddenInjectionText?: string | null;
}

export interface StepUpDetails {
  candidateId: string;
  reasons: string[];
  productTitle: string;
  merchantName: string;
  amountCents: number;
  sellerFacts: {
    isVerified: boolean;
    returnPolicy: string;
    warranty: string;
    shippingOrigin: string;
  };
}

export interface AttackPlanted {
  storeId: string;
  productSku: string;
  placement: "description" | "review" | "checkout_note" | "hidden_text";
  instruction: string;
  plantedAt: string;
}

export interface SpendingContractDraft {
  id: string;
  whatToBuy: string;
  maxTotalCents: number;
  maxQuantity: number;
  noSubscriptions: boolean;
  noGiftCards: boolean;
  unverifiedSellerRule: "ASK_ME" | "BLOCK";
  expiryMinutes: number;
  signedAt?: string;
  contractHash?: string;
}

export interface SystemStatus {
  gateway: "READY" | "DEGRADED" | "OFFLINE";
  aiJudge: "CONNECTED" | "UNAVAILABLE";
  paymentMode: "Mock PSP" | "PayPal Sandbox";
  stores: Array<{
    id: string;
    name: string;
    port: number;
    url: string;
    type: "Honest Retailer" | "Discount Store" | "Risky Marketplace";
  }>;
}

export interface RunState {
  runId: string;
  status: "IDLE" | "SEARCHING" | "EVALUATING" | "PAUSED_STEP_UP" | "COMPLETED" | "FAILED";
  prompt: string;
  contract: SpendingContractDraft;
  events: TimelineEvent[];
  candidates: CandidateCard[];
  activeCandidateId?: string;
  stepUpPrompt?: StepUpDetails | null;
  paymentResult?: {
    status: "CAPTURED" | "NOT_CHARGED";
    amountCents: number;
    storeName: string;
    mode: "Mock PSP" | "PayPal Sandbox";
    transactionId?: string;
    receiptId?: string;
  } | null;
  attackPlanted?: AttackPlanted | null;
}

