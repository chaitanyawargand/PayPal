import { z } from "zod";
import { MERCHANTS, MERCHANT_IDS, type MerchantId } from "./config.js";
import { AgentError } from "./errors.js";
import { CartMutationResponseSchema, ProductDetailSchema, QuoteResponseSchema, SearchResponseSchema, type ProductDetail, type SearchResult } from "./store-schemas.js";

const merchantId = z.enum(MERCHANT_IDS as [MerchantId, ...MerchantId[]]);
export const SearchStoreInput = z.object({ merchantId, query: z.string().min(1).max(2000) }).strict();
export const GetProductInput = z.object({ merchantId, sku: z.string().min(1).max(100) }).strict();
export const RequestQuoteInput = z.object({ merchantId, sku: z.string().min(1).max(100), quantity: z.number().int().min(1).max(100), variant: z.record(z.string(), z.string()).optional() }).strict();
export type SearchStoreInput = z.infer<typeof SearchStoreInput>;
export type GetProductInput = z.infer<typeof GetProductInput>;
export type RequestQuoteInput = z.infer<typeof RequestQuoteInput>;
export type ToolName = "search_store" | "get_product" | "request_quote";
export const TOOL_REGISTRY = Object.freeze({
  search_store: Object.freeze({ name: "search_store", inputSchema: SearchStoreInput }),
  get_product: Object.freeze({ name: "get_product", inputSchema: GetProductInput }),
  request_quote: Object.freeze({ name: "request_quote", inputSchema: RequestQuoteInput }),
});
export type QuoteToolResult = { quoteId: string; quoteTotalCents: number; advertisedTotalCents: number };
export interface ToolTransport {
  searchStore(input: SearchStoreInput): Promise<SearchResult[]>;
  getProduct(input: GetProductInput): Promise<ProductDetail>;
  requestQuote(input: RequestQuoteInput): Promise<QuoteToolResult>;
}
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type MerchantBaseUrls = Readonly<Record<MerchantId, string>>;
const DEFAULT_MERCHANT_BASE_URLS: MerchantBaseUrls = {
  novamart: MERCHANTS.novamart.baseUrl,
  dealdemon: MERCHANTS.dealdemon.baseUrl,
  peermarket: MERCHANTS.peermarket.baseUrl,
};

export class HttpMerchantToolTransport implements ToolTransport {
  constructor(
    private readonly fetcher: FetchLike = globalThis.fetch.bind(globalThis),
    private readonly timeoutMs = 2500,
    private readonly baseUrls: MerchantBaseUrls = DEFAULT_MERCHANT_BASE_URLS,
  ) {}

  async searchStore(raw: SearchStoreInput): Promise<SearchResult[]> {
    const input = this.parseInput(SearchStoreInput, raw);
    const url = `${this.base(input.merchantId)}/api/search?q=${encodeURIComponent(input.query)}`;
    const response = await this.call(url, { method: "GET" }, input.merchantId);
    const payload = this.parseResponse(SearchResponseSchema, await this.json(response, input.merchantId), input.merchantId);
    if (payload.merchantId !== input.merchantId) throw this.invalidResponse(input.merchantId);
    return payload.results;
  }

  async getProduct(raw: GetProductInput): Promise<ProductDetail> {
    const input = this.parseInput(GetProductInput, raw);
    const url = `${this.base(input.merchantId)}/api/products/${encodeURIComponent(input.sku)}`;
    const response = await this.call(url, { method: "GET" }, input.merchantId);
    const product = this.parseResponse(ProductDetailSchema, await this.json(response, input.merchantId), input.merchantId);
    if (product.sku.toLowerCase() !== input.sku.toLowerCase()) throw this.invalidResponse(input.merchantId);
    return product;
  }

  async requestQuote(raw: RequestQuoteInput): Promise<QuoteToolResult> {
    const input = this.parseInput(RequestQuoteInput, raw);
    const root = this.base(input.merchantId);
    const cartResponse = await this.call(`${root}/api/cart/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: input.sku, quantity: input.quantity, ...(input.variant ? { variant: input.variant } : {}) }),
    }, input.merchantId);
    const cartData = this.parseResponse(CartMutationResponseSchema, await this.json(cartResponse, input.merchantId), input.merchantId);
    const quoteResponse = await this.call(`${root}/api/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cart-id": cartData.cart.id },
      body: JSON.stringify({ deliveryMethod: "STANDARD" }),
    }, input.merchantId);
    const quote = this.parseResponse(QuoteResponseSchema, await this.json(quoteResponse, input.merchantId), input.merchantId);
    return { quoteId: quote.quoteId, quoteTotalCents: quote.totalCents, advertisedTotalCents: cartData.pricing.computedTotalCents };
  }

  private base(id: MerchantId): string { return this.baseUrls[id]; }
  private parseInput<T>(schema: z.ZodType<T>, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success) {
      const issue = result.error.issues[0];
      if (issue?.path[0] === "merchantId") throw new AgentError("UNKNOWN_MERCHANT", "Merchant is not allowlisted.");
      throw new AgentError("INVALID_TOOL_INPUT", "Tool input is invalid.");
    }
    return result.data;
  }
  private invalidResponse(id: MerchantId): AgentError { return new AgentError("STORE_INVALID_RESPONSE", `Store ${id} returned an invalid response.`); }
  private parseResponse<T>(schema: z.ZodType<T>, value: unknown, id: MerchantId): T {
    const result = schema.safeParse(value);
    if (!result.success) throw this.invalidResponse(id);
    return result.data;
  }
  private async json(response: Response, id: MerchantId): Promise<unknown> {
    try { return await response.json(); }
    catch { throw this.invalidResponse(id); }
  }
  private async call(url: string, init: RequestInit, id: MerchantId): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, { ...init, redirect: "manual", signal: controller.signal });
      if (response.status >= 300 && response.status < 400) throw new AgentError("STORE_REDIRECT", `Store ${id} returned a redirect.`);
      if (!response.ok) throw new AgentError("STORE_HTTP_ERROR", `Store ${id} returned HTTP ${response.status}.`);
      return response;
    } catch (error) {
      if (error instanceof AgentError) throw error;
      if (controller.signal.aborted) throw new AgentError("STORE_TIMEOUT", `Store ${id} request timed out.`);
      throw new AgentError("STORE_NETWORK_ERROR", `Store ${id} request failed.`);
    } finally { clearTimeout(timer); }
  }
}
