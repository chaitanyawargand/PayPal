import { z } from 'zod';
import { Verdict, ReasonCode } from './index.js';

export const PSPBinding = z.object({
  tier: z.enum(['A', 'B', 'C']),

  order_id: z.string().min(1),

  capture_id: z.string().min(1).nullable(),
}).strict();

export const ReceiptSchema = z.object({
  receipt_id: z.string().min(1),

  payment_id: z.string().min(1),

  seq: z.number().int().positive(),

  contract_hash: z.string().min(1),

  snapshot_hash: z.string().min(1),

  signed_order_hash: z.string().min(1),

  verdict: Verdict,

  reason_codes: z.array(ReasonCode),

  psp: PSPBinding,

  prev_hash: z.string().nullable(),

  hash: z.string().min(1),
}).strict();

export type PSPBinding = z.infer<typeof PSPBinding>;
export type Receipt = z.infer<typeof ReceiptSchema>;