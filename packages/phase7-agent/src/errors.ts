export type AgentErrorCode = "INVALID_TOOL_INPUT" | "UNKNOWN_MERCHANT" | "STORE_TIMEOUT" | "STORE_REDIRECT" | "STORE_HTTP_ERROR" | "STORE_NETWORK_ERROR" | "STORE_INVALID_RESPONSE" | "NO_CANDIDATES" | "GATEWAY_STATE";
export class AgentError extends Error {
  constructor(readonly code: AgentErrorCode, message: string) { super(message); this.name = "AgentError"; }
}
export type AgentModelErrorCode = "MODEL_UNAVAILABLE" | "MODEL_TIMEOUT" | "MODEL_INVALID_RESPONSE";
export class AgentModelError extends Error {
  constructor(readonly code: AgentModelErrorCode, message: string) { super(message); this.name = "AgentModelError"; }
}
