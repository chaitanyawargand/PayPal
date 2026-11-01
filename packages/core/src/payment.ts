import { z } from 'zod';
import { MoneyCents } from './money.js';
import { OriginZone } from './index.js';

export const PaymentItem = z.object({
  sku: z.string().min(1),

  qty: z.number().int().positive(),

  unit_price_cents: MoneyCents,

  origin_zone: OriginZone,
}).strict();

export const PaymentSpan = z.object({
  id: z.string().min(1),

  source_url: z.string().url(),

  zone: OriginZone,

  hash: z.string().min(1),
}).strict();

export const PaymentSchema = z.object({
  id: z.string().min(1),

  contract_id: z.string().min(1),

  idempotency_key: z.string().min(1),

  merchant_id: z.string().min(1),

  merchant_order_ref: z.string().min(1),

  items: z.array(PaymentItem).min(1),

  proposed_total_cents: MoneyCents,

  spans: z.array(PaymentSpan),
}).strict();

export type PaymentItem = z.infer<typeof PaymentItem>;
export type PaymentSpan = z.infer<typeof PaymentSpan>;
export type Payment = z.infer<typeof PaymentSchema>;