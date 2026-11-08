import { z } from "zod";
export {
  CandidateCard,
  CandidateStatus,
} from "../../phase7-contracts/src/candidate.js";
export {
  Event,
  EventType,
  EventActor,
} from "../../phase7-contracts/src/event.js";
export {
  Run,
  RunStatus,
  RunDecision,
} from "../../phase7-contracts/src/run.js";

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

export interface SpendingContractInput {
  maxBudgetCents: number;
  perOrderCapCents?: number;
  maxQuantity?: number;
  noSubscriptions?: boolean;
  noGiftCards?: boolean;
  unverifiedSellerRule?: "ASK_ME" | "BLOCK";
  allowedPayees?: string[];
  expiryMinutes?: number;
}

export interface PlantedAttack {
  storeId: string;
  productSku: string;
  placement: string;
  instruction: string;
  plantedAt?: string;
}

export type AttackPlanted = PlantedAttack;

export interface EvidenceVerificationResult {
  valid: boolean;
  checks: { chain: boolean; signatures: boolean };
  failures: string[];
}
