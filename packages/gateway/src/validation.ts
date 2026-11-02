import { z, type ZodIssue } from "zod";
import { PaymentSchema } from "../../core/src/payment.js";
import { ContractSchema } from "../../core/src/contract.js";

/**
 * Validates the body for POST /v1/payments/execute.
 * Reuses existing PaymentSchema and ContractSchema from core.
 * Does not add or substitute any total or amount fields.
 */
export const ExecutePaymentBodySchema = z
  .object({
    contract: z.union([ContractSchema, z.record(z.string(), z.unknown())]),
    payment: PaymentSchema,
    spent_cents: z.number().int().nonnegative().optional(),
    receipt_id: z.string().min(1).optional(),
  })
  .passthrough();

export type ExecutePaymentBody = z.infer<typeof ExecutePaymentBodySchema>;

export interface FormattedValidationIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Extracts only issue paths and messages to strictly avoid echoing any input payloads.
 */
export function formatValidationIssues(
  issues: ZodIssue[],
): FormattedValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
  }));
}

