import { z } from 'zod';
export const Verdict = z.enum(['ALLOW','STEP_UP','BLOCK'])
export const ReasonCode = z.enum([
  'OVER_BUDGET','PAYEE_NOT_IN_REGISTRY','TOTAL_MISMATCH',
  'BLOCKED_CATEGORY','LINE_FROM_UNTRUSTED_CONTENT',
  'UNTRUSTED_ORIGIN','CRITERIA_MISMATCH','OVER_AUTO_LIMIT'
  // add only codes from Threat Model T1-T10
])