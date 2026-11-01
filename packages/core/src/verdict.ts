import { z } from 'zod';

export const Verdict = z.enum([
  'ALLOW',
  'STEP_UP',
  'BLOCK',
]);
export type Verdict = z.infer<typeof Verdict>;

export const ReasonCode = z.enum([
  'OVER_BUDGET',
  'PAYEE_NOT_IN_REGISTRY',
  'TOTAL_MISMATCH',
  'BLOCKED_CATEGORY',
  'LINE_FROM_UNTRUSTED_CONTENT',
  'UNTRUSTED_ORIGIN',
  'CRITERIA_MISMATCH',
  'OVER_AUTO_LIMIT',
]);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const OriginZone = z.enum([
  'trusted_catalog',
  'untrusted_content',
  'registry',
  'unknown',
]);
export type OriginZone = z.infer<typeof OriginZone>;

export const ContractStatus = z.enum([
  'ACTIVE',
  'SUPERSEDED',
  'REVOKED',
  'EXPIRED',
]);
export type ContractStatus = z.infer<typeof ContractStatus>;