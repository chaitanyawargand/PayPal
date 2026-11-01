import type { Verdict, ReasonCode, Contract, Payment } from "../../core/src";

export interface LayerResult {
  layer: "L1";
  check: string;
  outcome: Verdict;
  reason?: ReasonCode;
  detail: string;
}

export interface Decision {
  verdict: Verdict;
  reason_codes: ReasonCode[];
  computed_total_cents: number;
  layer_results: LayerResult[];
}

export interface EngineInput {
  contract: Contract;
  payment: Payment;
  spent_cents?: number; // already captured + held, Gateway will load this from DB later
}

const rank = (v: Verdict) => (v === "BLOCK" ? 3 : v === "STEP_UP" ? 2 : 1);

export function decidePayment(input: EngineInput): Decision {
  const { contract, payment } = input;
  const spent = input.spent_cents ?? 0;

  const layer_results: LayerResult[] = [];
  const reasons: ReasonCode[] = [];

  const push = (
    check: string,
    outcome: Verdict,
    detail: string,
    reason?: ReasonCode,
  ) => {
    layer_results.push({ layer: "L1", check, outcome, detail, reason });
    if (reason && outcome !== "ALLOW") reasons.push(reason);
  };

  // 1. TOTAL_MISMATCH - T2: Never trust agent total, recompute it
  const computed_total_cents: number = payment.items.reduce(
    (sum: number, i: { qty: number; unit_price_cents: number }) =>
      sum + i.qty * i.unit_price_cents,
    0,
  );
  if (computed_total_cents !== payment.proposed_total_cents) {
    push(
      "total_mismatch",
      "BLOCK",
      `computed ${computed_total_cents} != proposed ${payment.proposed_total_cents}`,
      "TOTAL_MISMATCH",
    );
  } else {
    push("total_mismatch", "ALLOW", `total ${computed_total_cents} matches`);
  }

  // 2. PAYEE_NOT_IN_REGISTRY - T2: Agent cannot invent a payee
  // If your contract field is named differently, change ONLY this line to your schema name
  if (!contract.allowed_payee_ids.includes(payment.merchant_id)) {
    {
      push(
        "payee_registry",
        "BLOCK",
        `${payment.merchant_id} not in contract allowlist`,
        "PAYEE_NOT_IN_REGISTRY",
      );
    }
  } else {
    push("payee_registry", "ALLOW", `${payment.merchant_id} allowed`);
  }

  // 3. OVER_BUDGET - T5: spent + this purchase must stay inside signed budget
  if (spent + payment.proposed_total_cents > contract.budget_max_cents) {
    push(
      "budget",
      "BLOCK",
      `spent ${spent} + ${payment.proposed_total_cents} > budget ${contract.budget_max_cents}`,
      "OVER_BUDGET",
    );
  } else if (payment.proposed_total_cents > contract.per_order_cap_cents) {
    push(
      "budget",
      "BLOCK",
      `${payment.proposed_total_cents} > per-order cap ${contract.per_order_cap_cents}`,
      "OVER_BUDGET",
    );
  } else {
    push("budget", "ALLOW", "within budget and per-order cap");
  }

  // 4. BLOCKED_CATEGORY + untrusted provenance - T1
  // Core PaymentItem has no origin_zone. Provenance is carried by
  // payment.spans — content lifted from a merchant page is untrusted
  // data, so any payment built from spans tightens to STEP_UP.
  // (Blocked category still matches by SKU until Signed Merchant
  // Order provides a real category field.)
  let sawItemCheck = false;

  for (const item of payment.items) {
    const isGiftCard = item.sku.toLowerCase().includes("gift");
    const isBlocked =
      isGiftCard && contract.blocked_categories.includes("gift_card");

    if (isBlocked) {
      sawItemCheck = true;
      push(
        "blocked_category",
        "BLOCK",
        `${item.sku} is blocked gift_card`,
        "BLOCKED_CATEGORY",
      );
    }
  }

  if (payment.spans.length > 0) {
    sawItemCheck = true;
    push(
      "line_origin",
      "STEP_UP",
      `${payment.spans.length} span(s) from untrusted content`,
      "LINE_FROM_UNTRUSTED_CONTENT",
    );
  }

  if (!sawItemCheck) {
    push("line_origin", "ALLOW", "all lines from trusted origin");
  }

  const verdict = layer_results.reduce<Verdict>(
    (worst, r) => (rank(r.outcome) > rank(worst) ? r.outcome : worst),
    "ALLOW",
  );

  return {
    verdict,
    reason_codes: [...new Set(reasons)],
    computed_total_cents,
    layer_results,
  };
}
