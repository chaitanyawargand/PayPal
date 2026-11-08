import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { ContractSchema, type Contract } from "../../core/src/contract.js";
import { canonicalJson, type JsonValue } from "../../core/src/canonical.js";
import type { UnsignedDraftContract } from "../../compiler/src/types.js";
import type { Run } from "../../phase7-contracts/src/run.js";

export type Clock = { now(): Date };
export type UnsignedContractPayload = Omit<Contract, "hash" | "signature">;
export type ContractVerificationFailure =
  | "INTENT_CONTRACT_INVALID"
  | "INTENT_CONTRACT_HASH_MISMATCH"
  | "INTENT_CONTRACT_INVALID_SIGNATURE"
  | "INTENT_CONTRACT_NOT_ACTIVE"
  | "INTENT_CONTRACT_EXPIRED";
export type ContractVerification = { ok: true; contract: Contract } | { ok: false; reasonCode: ContractVerificationFailure };
export type IntentResolutionFailure = ContractVerificationFailure | "INTENT_NOT_BOUND" | "INTENT_CONTRACT_NOT_FOUND" | "INTENT_CONTRACT_UNAVAILABLE" | "INTENT_ID_MISMATCH";
export type IntentResolution = { ok: true; contract: Contract } | { ok: false; reasonCode: IntentResolutionFailure };
export type IntentRepository = { getIntentById(id: string): Promise<unknown | null> | unknown | null };
export type IntentContractResolverDependencies = { intents: IntentRepository; userPublicKeyPem: string; clock: Clock };

function contractHash(payload: UnsignedContractPayload): string {
  return createHash("sha256").update(canonicalJson(payload as unknown as JsonValue), "utf8").digest("hex");
}

export function signContractPayload(payload: UnsignedContractPayload, privateKeyPem: string): Contract {
  const hash = contractHash(payload);
  const signature = sign(null, Buffer.from(hash, "utf8"), createPrivateKey(privateKeyPem)).toString("base64");
  return ContractSchema.parse({ ...payload, hash, signature });
}

export function signIntentDraft(input: {
  draft: UnsignedDraftContract;
  shipToHash: string;
  privateKeyPem: string;
  now?: Date | string;
}): Contract {
  const draft = input.draft;
  const now = input.now === undefined ? new Date() : new Date(input.now);
  const expires = new Date(draft.expires_at);
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(expires.getTime()) || expires.getTime() <= now.getTime()) throw new Error("Intent draft expiry is missing or expired.");
  if (!Array.isArray(draft.allowed_payee_ids) || draft.allowed_payee_ids.length === 0 || draft.allowed_payee_ids.some((id) => typeof id !== "string" || id.trim().length === 0)) throw new Error("Intent draft must name allowed payees.");
  if (!Number.isSafeInteger(draft.budget_max_cents) || draft.budget_max_cents <= 0 || !Number.isSafeInteger(draft.per_order_cap_cents) || draft.per_order_cap_cents <= 0 || draft.per_order_cap_cents > draft.budget_max_cents) throw new Error("Intent draft budget limits are invalid.");
  if (typeof input.shipToHash !== "string" || input.shipToHash.trim().length === 0) throw new Error("Shipping address hash is required.");
  const payload: UnsignedContractPayload = {
    id: draft.id,
    family_id: draft.family_id,
    version: draft.version,
    owner_payer_id: draft.owner_payer_id,
    criteria: draft.criteria,
    budget_max_cents: draft.budget_max_cents,
    per_order_cap_cents: draft.per_order_cap_cents,
    allowed_payee_ids: draft.allowed_payee_ids,
    blocked_categories: draft.blocked_categories,
    expires_at: draft.expires_at,
    ship_to_hash: input.shipToHash,
    status: draft.status,
  };
  return signContractPayload(payload, input.privateKeyPem);
}

export function verifyIntentContract(value: unknown, options: { userPublicKeyPem: string; now?: Date | string }): ContractVerification {
  try {
    const parsed = ContractSchema.safeParse(value);
    if (!parsed.success) return { ok: false, reasonCode: "INTENT_CONTRACT_INVALID" };
    const contract = parsed.data;
    const { hash, signature, ...payload } = contract;
    if (contractHash(payload) !== hash) return { ok: false, reasonCode: "INTENT_CONTRACT_HASH_MISMATCH" };
    const signatureBytes = Buffer.from(signature, "base64");
    if (!signatureBytes.length || !verify(null, Buffer.from(hash, "utf8"), createPublicKey(options.userPublicKeyPem), signatureBytes)) return { ok: false, reasonCode: "INTENT_CONTRACT_INVALID_SIGNATURE" };
    if (contract.status !== "ACTIVE") return { ok: false, reasonCode: "INTENT_CONTRACT_NOT_ACTIVE" };
    const now = options.now === undefined ? new Date() : new Date(options.now);
    const expiry = new Date(contract.expires_at);
    if (!Number.isFinite(now.getTime()) || expiry.getTime() <= now.getTime()) return { ok: false, reasonCode: "INTENT_CONTRACT_EXPIRED" };
    return { ok: true, contract };
  } catch {
    return { ok: false, reasonCode: "INTENT_CONTRACT_INVALID" };
  }
}

export class IntentContractResolver {
  constructor(private readonly deps: IntentContractResolverDependencies) {}

  async resolveForRun(run: Pick<Run, "draftIntentId" | "signedIntentId">): Promise<IntentResolution> {
    if (!run.draftIntentId || !run.signedIntentId || run.draftIntentId !== run.signedIntentId) return { ok: false, reasonCode: "INTENT_NOT_BOUND" };
    let value: unknown | null;
    try {
      value = await this.deps.intents.getIntentById(run.signedIntentId);
    } catch {
      return { ok: false, reasonCode: "INTENT_CONTRACT_UNAVAILABLE" };
    }
    if (value === null || value === undefined) return { ok: false, reasonCode: "INTENT_CONTRACT_NOT_FOUND" };
    if (typeof value !== "object" || !value || !("id" in value) || value.id !== run.signedIntentId) return { ok: false, reasonCode: "INTENT_ID_MISMATCH" };
    return verifyIntentContract(value, { userPublicKeyPem: this.deps.userPublicKeyPem, now: this.deps.clock.now() });
  }
}
