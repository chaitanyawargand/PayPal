# `packages/evidence`

Evidence Pack builder and standalone cryptographic dispute verifier.

Conforms strictly to **Phase 6 Contract 1**.

## Features
- **Database-free**: Zero imports from `packages/db` or SQLite drivers. Can be run in pure in-memory/browser/CLI dispute verification contexts.
- **Contract 1 Conformance**:
  ```ts
  verifyEvidencePack(pack): EvidenceVerifyResult
  // Returns { valid: boolean, checks: { chain: boolean, signatures: boolean }, failures: string[] }
  ```
- **Cryptographic integrity**:
  - Recomputes SHA-256 hash chaining using canonical JSON serialization from genesis.
  - Verifies Ed25519 digital signatures on each receipt hash against the pack's public key.
  - Fail-closed: Never throws on corrupt or forged inputs.
