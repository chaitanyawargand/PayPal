export type StoreCoreErrorCode =
  | "INVALID_CENTS" | "INVALID_QUANTITY" | "INVALID_VARIANT"
  | "INSUFFICIENT_STOCK" | "CART_NOT_FOUND" | "CART_LINE_NOT_FOUND"
  | "PRODUCT_NOT_FOUND" | "EMPTY_PRICING_INPUT" | "INVALID_LINE_ITEM"
  | "INVALID_QUOTE";

export class StoreCoreError extends Error {
  constructor(readonly code: StoreCoreErrorCode, message: string) {
    super(message);
    this.name = "StoreCoreError";
  }
}
