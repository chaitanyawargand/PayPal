export type GatewayErrorCode = "VALIDATION_ERROR" | "RUN_NOT_FOUND" | "CANDIDATE_NOT_FOUND" | "INVALID_TRANSITION" | "DEPENDENCY_FAILED";
export class GatewayError extends Error {
  constructor(readonly code: GatewayErrorCode, message: string) {
    super(message);
    this.name = "GatewayError";
  }
}
