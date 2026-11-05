# Contract 1 Specification & Package Exports (`packages/evidence`)

## Exported Functions
```ts
export function buildEvidencePack(options: BuildEvidencePackOptions): EvidencePack;
export function verifyEvidencePack(pack: unknown): EvidenceVerifyResult;
```

## Contract 1 Schema & Types
```ts
export interface EvidenceVerifyChecks {
  chain: boolean;
  signatures: boolean;
}

export interface EvidenceVerifyResult {
  valid: boolean;
  checks: EvidenceVerifyChecks;
  failures: string[];
}

export interface EvidencePack {
  intent_contract: Record<string, unknown>;
  public_key_pem: string;
  signed_entries: SignedReceiptEntry[];
  created_at: string;
}
```

## Verification Semantics
- **Recomputation**: Recomputes the entire receipt hash chain from genesis (`"0".repeat(64)`) and validates all Ed25519 digital signatures using `verifySignedReceipts`.
- **Fail-Closed**: Always returns a structured object matching Contract 1 without throwing.
- **Zero Dependencies on DB**: Operates without SQLite, databases, or network connections.

