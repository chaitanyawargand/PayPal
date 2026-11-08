import type { PricingPolicy } from "../../store-core/src/index.js";

export const NOVAMART_PRICING_POLICY: PricingPolicy = Object.freeze({
  standardShippingCents: 495,
  expressShippingCents: 1295,
  freeStandardShippingThresholdCents: 7500,
  taxRateBps: 825,
});
