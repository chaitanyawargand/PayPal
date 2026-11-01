import { z } from 'zod'

// This is for ONE criterion. Example: "must be waterproof"
export const CriterionVerdictSchema = z.object({
  criterion_id: z.string(),
  verdict: z.enum(['satisfied', 'not_satisfied', 'uncertain']),
  evidence_text: z.string(), // exact copy from page, or "" if uncertain
  reason: z.string().max(120),
})

export const JudgeOutputSchema = z.object({
  per_criterion: z.array(CriterionVerdictSchema),
  overall: z.enum(['satisfied', 'not_satisfied', 'uncertain']),
})

// FREE TypeScript type, don't write it manually
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>