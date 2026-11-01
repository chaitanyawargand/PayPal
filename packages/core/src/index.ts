import { z } from 'zod';
export * from './canonical';
export * from './money';
export * from './contract';
export * from './payment';
export * from './receipt';
export * from './verdict';
export * from './judge';   // <-- add this
export const Verdict = z.enum([
  'ALLOW',
  'STEP_UP',
  'BLOCK',
]);

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

export const OriginZone = z.enum([
  'trusted_catalog',
  'untrusted_content',
  'registry',
  'unknown',
]);

export const ContractStatus = z.enum([
  'ACTIVE',
  'SUPERSEDED',
  'REVOKED',
  'EXPIRED',
]);

export type Verdict = z.infer<typeof Verdict>;
export type ReasonCode = z.infer<typeof ReasonCode>;
export type OriginZone = z.infer<typeof OriginZone>;
export type ContractStatus = z.infer<typeof ContractStatus>;