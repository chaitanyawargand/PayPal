import { z } from 'zod';
import { MoneyCents } from './money.js';
import { ContractStatus } from './index.js';

export const ContractCriterion = z.object({
  id: z.string().min(1),
  type: z.enum(['structured', 'prose']),
  field: z.string().min(1),
  expected: z.unknown(),
}).strict();

export const ContractSchema = z.object({
  id: z.string().min(1),

  family_id: z.string().min(1),
  version: z.number().int().positive(),

  owner_payer_id: z.string().min(1),

  criteria: z.array(ContractCriterion).min(1),

  budget_max_cents: MoneyCents,
  per_order_cap_cents: MoneyCents,

  allowed_payee_ids: z.array(z.string().min(1)),
  blocked_categories: z.array(z.string().min(1)),

  expires_at: z.string().datetime(),

  ship_to_hash: z.string().min(1),

  status: ContractStatus,

  hash: z.string().min(1),
  signature: z.string().min(1),
}).strict();

export type ContractCriterion = z.infer<typeof ContractCriterion>;
export type Contract = z.infer<typeof ContractSchema>;