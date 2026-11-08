import { describe, expect, it } from "vitest";
import { AgentModelError } from "../src/errors.js";
import { GeminiAgentModel } from "../src/gemini-model.js";

describe("Gemini model adapter", () => {
  it("sends API key only in the header and parses structured output", async () => {
    const key = "secret-test-key";
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push({ url, init });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ query: "jacket", quantity: 2 }) }] } }] }), { status: 200 });
    }) as typeof fetch;
    const model = new GeminiAgentModel(key, "gemini-test", fetcher);
    expect(await model.planSearch("two jackets")).toEqual({ query: "jacket", quantity: 2 });
    expect(requests[0]!.url).not.toContain(key);
    expect(new Headers(requests[0]!.init?.headers).get("x-goog-api-key")).toBe(key);
    expect(requests[0]!.init?.redirect).toBe("manual");
  });

  it("returns safe errors for provider and malformed responses", async () => {
    const key = "secret-test-key";
    const failed = new GeminiAgentModel(key, "test", (async () => new Response("failure", { status: 500 })) as typeof fetch);
    await expect(failed.planSearch("jacket")).rejects.toBeInstanceOf(AgentModelError);
    const malformed = new GeminiAgentModel(key, "test", (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }))) as typeof fetch);
    let message = "";
    try { await malformed.planSearch("jacket"); } catch (error) { message = (error as Error).message; }
    expect(message).not.toContain(key);
    expect(message).toBe("Model response was unavailable or invalid.");
  });
});
