import { z } from "zod";

export type Verdict = "ALLOW" | "STEP_UP" | "BLOCK";

export const VerdictEnum = z.enum(["ALLOW", "STEP_UP", "BLOCK"]);

export interface JudgeInput {
  deterministic_verdict: Verdict;
  evidence_text: string;
  claim_summary: string;
}

export interface JudgeOutput {
  verdict: Verdict;
  grounded_quote: string | null;
  reason: string;
  model: "gemini-3.5-flash";
}

export const JudgeOutputSchema = z.object({
  verdict: VerdictEnum,
  grounded_quote: z.string().nullable(),
  reason: z.string().min(1),
  model: z.literal("gemini-3.5-flash"),
});

export interface JudgeEvaluationResult {
  judgeOutput: JudgeOutput;
  final_verdict: Verdict;
}

export interface GeminiClient {
  generateContent(prompt: string): Promise<string>;
}
