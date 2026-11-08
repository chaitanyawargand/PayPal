import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signContractPayload, signIntentDraft, verifyIntentContract } from "../src/contract-resolver.js";
import { IntentContractResolver } from "../src/contract-resolver.js";
import type { UnsignedDraftContract } from "../../compiler/src/types.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const otherPublicKeyPem = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
const now = new Date("2030-01-01T00:00:00.000Z");
const draft: UnsignedDraftContract = {
  id: "intent_fixture",
  family_id: "family_fixture",
  version: 1,
  owner_payer_id: "payer_fixture",
  criteria: [{ id: "criterion_fixture", type: "structured", field: "merchant_id", expected: "novamart" }],
  budget_max_cents: 10000,
  per_order_cap_cents: 9000,
  allowed_payee_ids: ["novamart"],
  blocked_categories: ["gift_card"],
  expires_at: "2030-02-01T00:00:00.000Z",
  status: "ACTIVE",
};

describe("signed Intent Contract bridge", () => {
  it("signs an unsigned compiler draft and verifies its signature and hash", () => {
    const signed = signIntentDraft({ draft, shipToHash: "ship_hash_fixture", privateKeyPem, now });
    expect(signed).toMatchObject({ ...draft, ship_to_hash: "ship_hash_fixture" });
    expect(verifyIntentContract(signed, { userPublicKeyPem: publicKeyPem, now })).toEqual({ ok: true, contract: signed });
    expect(draft).not.toHaveProperty("hash");
    expect(draft).not.toHaveProperty("ship_to_hash");
  });

  it("rejects tampering, the wrong key, inactive status, and expiry", async () => {
    const signed = signIntentDraft({ draft, shipToHash: "ship_hash_fixture", privateKeyPem, now });
    expect(verifyIntentContract({ ...signed, budget_max_cents: 11000 }, { userPublicKeyPem: publicKeyPem, now })).toMatchObject({ ok: false, reasonCode: "INTENT_CONTRACT_HASH_MISMATCH" });
    expect(verifyIntentContract(signed, { userPublicKeyPem: otherPublicKeyPem, now })).toMatchObject({ ok: false, reasonCode: "INTENT_CONTRACT_INVALID_SIGNATURE" });
    const { hash: _hash, signature: _signature, ...unsigned } = signed;
    const revoked = signContractPayload({ ...unsigned, status: "REVOKED" }, privateKeyPem);
    expect(verifyIntentContract(revoked, { userPublicKeyPem: publicKeyPem, now })).toMatchObject({ ok: false, reasonCode: "INTENT_CONTRACT_NOT_ACTIVE" });
    const expiredDraft = { ...draft, expires_at: "2029-12-31T23:59:59.000Z" };
    const expired = signIntentDraft({ draft: expiredDraft, shipToHash: "ship_hash_fixture", privateKeyPem, now: new Date("2029-01-01T00:00:00.000Z") });
    expect(verifyIntentContract(expired, { userPublicKeyPem: publicKeyPem, now })).toMatchObject({ ok: false, reasonCode: "INTENT_CONTRACT_EXPIRED" });
    const resolverFor = (contract: unknown) => new IntentContractResolver({ intents: { getIntentById: async () => contract }, userPublicKeyPem: publicKeyPem, clock: { now: () => now } });
    expect(await resolverFor(revoked).resolveForRun({ draftIntentId: revoked.id, signedIntentId: revoked.id })).toMatchObject({ ok: false, reasonCode: "INTENT_CONTRACT_NOT_ACTIVE" });
    expect(await resolverFor(expired).resolveForRun({ draftIntentId: expired.id, signedIntentId: expired.id })).toMatchObject({ ok: false, reasonCode: "INTENT_CONTRACT_EXPIRED" });
  });

  it("resolves only the contract bound to equal draft and signed intent IDs", async () => {
    const signed = signIntentDraft({ draft, shipToHash: "ship_hash_fixture", privateKeyPem, now });
    const resolver = new IntentContractResolver({ intents: { getIntentById: async (id) => id === signed.id ? signed : null }, userPublicKeyPem: publicKeyPem, clock: { now: () => now } });
    const run = { draftIntentId: signed.id, signedIntentId: signed.id };
    expect(await resolver.resolveForRun(run)).toEqual({ ok: true, contract: signed });
    expect(await resolver.resolveForRun({ draftIntentId: signed.id })).toMatchObject({ ok: false, reasonCode: "INTENT_NOT_BOUND" });
    expect(await resolver.resolveForRun({ draftIntentId: signed.id, signedIntentId: "other" })).toMatchObject({ ok: false, reasonCode: "INTENT_NOT_BOUND" });
    expect(await resolver.resolveForRun({ draftIntentId: "missing", signedIntentId: "missing" })).toMatchObject({ ok: false, reasonCode: "INTENT_CONTRACT_NOT_FOUND" });

    const mismatch = new IntentContractResolver({ intents: { getIntentById: async () => ({ ...signed, id: "different" }) }, userPublicKeyPem: publicKeyPem, clock: { now: () => now } });
    expect(await mismatch.resolveForRun(run)).toMatchObject({ ok: false, reasonCode: "INTENT_ID_MISMATCH" });
    const unavailable = new IntentContractResolver({ intents: { getIntentById: async () => { throw new Error("storage unavailable"); } }, userPublicKeyPem: publicKeyPem, clock: { now: () => now } });
    expect(await unavailable.resolveForRun(run)).toMatchObject({ ok: false, reasonCode: "INTENT_CONTRACT_UNAVAILABLE" });
  });
});
