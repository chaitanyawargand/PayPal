import { z } from "zod";
import { AgentModelError } from "./errors.js";
import { RankingResponseSchema, SearchPlanSchema, type AgentModelPort, type CandidateRankingInput, type RankingResponse, type SearchPlan } from "./model.js";
import { rankStructuredCandidates } from "./ranking.js";

export type GeminiFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class GeminiAgentModel implements AgentModelPort {
  constructor(
    private readonly apiKey: string,
    private readonly model = "gemini-2.5-flash",
    private readonly fetcher: GeminiFetch = globalThis.fetch.bind(globalThis),
    private readonly timeoutMs = 5000,
  ) {}

  async planSearch(prompt: string): Promise<SearchPlan> {
    return SearchPlanSchema.parse(await this.generate("Return a JSON object with query, quantity, and optional maxBudgetCents for product discovery. Use quantity 1 if unspecified. Never choose a store or call tools.", { prompt }, SearchPlanSchema));
  }

  async rankCandidates(input: CandidateRankingInput): Promise<RankingResponse> {
    const rankingOnly = {
      prompt: input.prompt,
      ...(input.maxBudgetCents === undefined ? {} : { maxBudgetCents: input.maxBudgetCents }),
      candidates: input.candidates,
    };
    try {
      return await this.generate("Return JSON with orderedCandidateIds containing every supplied candidate id exactly once, from best to worst. Use only the supplied structured fields.", rankingOnly, RankingResponseSchema);
    } catch {
      return { orderedCandidateIds: rankStructuredCandidates(input.candidates) };
    }
  }

  private async generate<T>(instruction: string, data: unknown, schema: z.ZodType<T>): Promise<T> {
    if (!this.apiKey) throw new AgentModelError("MODEL_UNAVAILABLE", "Model service is unavailable.");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${instruction}\n${JSON.stringify(data)}` }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      });
      if (!response.ok) throw new Error("model response");
      const envelope = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const output = envelope.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
      if (!output) throw new Error("model output");
      return schema.parse(JSON.parse(output));
    } catch {
      throw new AgentModelError(controller.signal.aborted ? "MODEL_TIMEOUT" : "MODEL_INVALID_RESPONSE", "Model response was unavailable or invalid.");
    } finally {
      clearTimeout(timer);
    }
  }
}
