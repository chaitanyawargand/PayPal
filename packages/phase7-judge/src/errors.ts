export type JudgeModelErrorCode = "MODEL_UNAVAILABLE" | "MODEL_TIMEOUT" | "MODEL_HTTP_ERROR" | "MODEL_INVALID_RESPONSE";

export class JudgeModelError extends Error {
  constructor(readonly code: JudgeModelErrorCode, message: string) {
    super(message);
    this.name = "JudgeModelError";
  }
}
