import { StoreCoreError } from "./errors.js";
export function assertIntegerCents(value: number): number {
  if (!Number.isSafeInteger(value)) throw new StoreCoreError("INVALID_CENTS", "Amount must be safe integer cents");
  return value;
}
export function addCents(...values: number[]): number { return assertIntegerCents(values.reduce((sum, value) => sum + assertIntegerCents(value), 0)); }
export function multiplyCents(unitAmountCents: number, quantity: number): number {
  assertIntegerCents(unitAmountCents);
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new StoreCoreError("INVALID_QUANTITY", "Quantity must be a non-negative integer");
  return assertIntegerCents(unitAmountCents * quantity);
}
export function formatUsd(cents: number): string {
  assertIntegerCents(cents);
  const negative = cents < 0;
  const value = Math.abs(cents);
  const whole = Math.floor(value / 100).toLocaleString("en-US");
  return `${negative ? "-" : ""}$${whole}.${String(value % 100).padStart(2, "0")}`;
}
export function calculateTaxCents(merchandiseSubtotalCents: number, taxRateBps: number): number {
  assertIntegerCents(merchandiseSubtotalCents);
  if (!Number.isSafeInteger(taxRateBps) || taxRateBps < 0) throw new StoreCoreError("INVALID_CENTS", "Tax rate must be non-negative integer basis points");
  return assertIntegerCents(Math.floor((merchandiseSubtotalCents * taxRateBps + 5000) / 10000));
}
