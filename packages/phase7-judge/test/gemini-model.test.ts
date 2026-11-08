import { describe, expect, it } from "vitest";
import { JudgeModelError } from "../src/errors.js";
import { GeminiJudgeModel } from "../src/gemini-model.js";
import type { JudgeFacts } from "../src/model.js";

const facts: JudgeFacts = {
  run: { prompt: "jacket" },
  candidate: { candidateId: "cand_1", merchantId: "novamart", sku: "JKT-001", quantity: 1, advertisedTotalCents: 1000, terms: { condition: "NEW", returnsDays: 30, finalSale: false, subscription: false, giftCard: false, warrantyLabel: "1 year" }, seller: { verified: true } },
  verifiedQuote: { merchantId: "novamart", sku: "JKT-001", quoteTotalCents: 1000 },
  baseDecision: { outcome: "ALLOW", reasonCodes: [] },
};

describe("GeminiJudgeModel", () => {
  it("parses JSON and sends the injected key only in the header", async () => {
    const key = "test-only-secret";
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      capturedInit = init;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ recommendation: "STEP_UP" }) }] } }] }));
    }) as typeof fetch;
    const model = new GeminiJudgeModel(key, "gemini-test", fakeFetch);
    expect(await model.review(facts)).toEqual({ recommendation: "STEP_UP" });
    expect(capturedUrl).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(capturedUrl).not.toContain(key);
    expect(new Headers(capturedInit?.headers).get("x-goog-api-key")).toBe(key);
    expect(capturedInit?.redirect).toBe("manual");
    expect(JSON.parse(String(capturedInit?.body)).generationConfig.responseMimeType).toBe("application/json");
  });

  it("raises safe typed errors for HTTP and malformed JSON responses", async () => {
    const key = "test-only-secret";
    const unavailable = new GeminiJudgeModel(key, "test", (async () => new Response("failure", { status: 500 })) as typeof fetch);
    await expect(unavailable.review(facts)).rejects.toMatchObject({ code: "MODEL_HTTP_ERROR", message: "Judge model returned an HTTP error." });
    const malformed = new GeminiJudgeModel(key, "test", (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }))) as typeof fetch);
    let error: unknown;
    try { await malformed.review(facts); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(JudgeModelError);
    expect((error as Error).message).not.toContain(key);
    expect((error as Error).message).toBe("Judge model response was unavailable or invalid.");
  });
});
