import type {
  CompilerInput,
  CompileDraftResult,
  UnsignedDraftContract,
} from "./types.js";

/**
 * Parses amount string or number to integer cents.
 * Disallows floats or rounds non-integers explicitly, rejecting negative or NaN.
 */
function parseCents(val: unknown): number | null {
  if (typeof val === "number") {
    if (!Number.isFinite(val) || val <= 0) return null;
    return Math.round(val);
  }
  if (typeof val === "string") {
    const cleaned = val.replace(/[$,]/g, "").trim();
    if (!cleaned) return null;
    const num = parseFloat(cleaned);
    if (!Number.isFinite(num) || num <= 0) return null;
    // If it looks like dollars with decimal (e.g. "100.00" or "80")
    if (val.includes("$") || val.includes(".")) {
      return Math.round(num * 100);
    }
    return Math.round(num);
  }
  return null;
}

/**
 * Extracts intent details from natural language prose prompt if provided.
 */
function parsePromptProse(prompt: string) {
  const extracted: {
    merchant?: string;
    budgetCents?: number;
    perOrderCents?: number;
    blockedCategories: string[];
  } = { blockedCategories: [] };

  // Detect merchant
  const merchantMatch = prompt.match(
    /(?:at|for|from|merchant)\s+([A-Za-z0-9_-]+)/i,
  );
  if (merchantMatch) {
    extracted.merchant = merchantMatch[1].toLowerCase();
    if (extracted.merchant.startsWith("merchant_")) {
      // Keep canonical
    } else {
      extracted.merchant = `merchant_${extracted.merchant}`;
    }
  }

  // Detect budget: e.g. "up to $100" or "budget $100" or "10000 cents"
  const budgetMatch = prompt.match(
    /(?:up to|budget(?: of)?|max(?:imum)? total)\s+(\$?[0-9]+(?:\.[0-9]{2})?)/i,
  );
  if (budgetMatch) {
    const parsed = parseCents(budgetMatch[1]);
    if (parsed !== null) extracted.budgetCents = parsed;
  }

  // Detect per-order cap: e.g. "max $80 per order" or "per order cap $80"
  const perOrderMatch = prompt.match(
    /(?:max(?:imum)?|cap of)?\s*(\$?[0-9]+(?:\.[0-9]{2})?)\s*(?:per order|\/order)/i,
  );
  if (perOrderMatch) {
    const parsed = parseCents(perOrderMatch[1]);
    if (parsed !== null) extracted.perOrderCents = parsed;
  }

  // Detect blocked categories: e.g. "no gift cards" or "block gift_card"
  if (/no gift[ -]?cards?|block(?:ed)? gift[ -]?cards?/i.test(prompt)) {
    extracted.blockedCategories.push("gift_card");
  }
  if (/no crypto|block(?:ed)? crypto/i.test(prompt)) {
    extracted.blockedCategories.push("crypto");
  }

  return extracted;
}

/**
 * Compiles unstructured or semi-structured requests into an unsigned draft Intent Contract.
 * Strict Phase 6 Contract 3 compliance:
 * - Draft-only: Returns unsigned object with NO signature and NO hash.
 * - Disallows guessing on ambiguous or missing essential terms.
 * - Integer cents only.
 */
export function compileDraftContract(
  input: CompilerInput | string,
): CompileDraftResult {
  const warnings: string[] = [];
  const normalizedInput: CompilerInput =
    typeof input === "string" ? { prompt: input } : { ...input };

  let merchantList = normalizedInput.allowed_payee_ids ?? [];
  let budgetCents = normalizedInput.budget_max_cents;
  let perOrderCents = normalizedInput.per_order_cap_cents;
  let blockedCategories = normalizedInput.blocked_categories ?? [];

  // Parse prose if prompt provided
  if (normalizedInput.prompt) {
    const prose = parsePromptProse(normalizedInput.prompt);
    if (merchantList.length === 0 && prose.merchant) {
      merchantList = [prose.merchant];
    }
    if (!budgetCents && prose.budgetCents) {
      budgetCents = prose.budgetCents;
    }
    if (!perOrderCents && prose.perOrderCents) {
      perOrderCents = prose.perOrderCents;
    }
    if (blockedCategories.length === 0 && prose.blockedCategories.length > 0) {
      blockedCategories = prose.blockedCategories;
    }
  }

  // Validation 1: Merchant specification
  if (!merchantList || merchantList.length === 0) {
    warnings.push("Allowed merchant or payee ID is required; cannot draft open-ended authorization.");
  }

  // Validation 2: Budget cap specification
  if (budgetCents === undefined || budgetCents === null || budgetCents <= 0) {
    warnings.push("Total budget cap (budget_max_cents) is missing or non-positive; explicit cap required.");
  } else if (!Number.isInteger(budgetCents)) {
    warnings.push("Total budget cap must be an integer number of cents.");
  }

  // Validation 3: Per-order cap specification
  if (perOrderCents === undefined || perOrderCents === null || perOrderCents <= 0) {
    // If budget cap is given, default per-order cap to budget cap with warning
    if (budgetCents && budgetCents > 0) {
      perOrderCents = budgetCents;
      warnings.push("Per-order cap was not specified; defaulting to match total budget cap.");
    } else {
      warnings.push("Per-order cap (per_order_cap_cents) is missing or non-positive.");
    }
  } else if (!Number.isInteger(perOrderCents)) {
    warnings.push("Per-order cap must be an integer number of cents.");
  }

  if (
    budgetCents &&
    perOrderCents &&
    perOrderCents > budgetCents
  ) {
    warnings.push("Per-order cap cannot exceed total budget cap.");
  }

  // If there are fundamental ambiguities, return NEEDS_CLARIFICATION
  const isAmbiguous =
    !merchantList ||
    merchantList.length === 0 ||
    !budgetCents ||
    budgetCents <= 0 ||
    !perOrderCents ||
    perOrderCents <= 0 ||
    perOrderCents > budgetCents;

  if (isAmbiguous) {
    return {
      status: "NEEDS_CLARIFICATION",
      draft: null,
      warnings,
    };
  }

  // Build unsigned draft object (strictly NO signature, NO hash)
  const defaultDays = 30;
  const expiresAt =
    normalizedInput.expires_at ??
    new Date(Date.now() + defaultDays * 86400 * 1000).toISOString();

  const nonce = Date.now();
  const draft: UnsignedDraftContract = {
    id: `ct_draft_${nonce}`,
    family_id: `fam_${nonce}`,
    version: 1,
    owner_payer_id: normalizedInput.payer_id ?? "payer_default",
    budget_max_cents: budgetCents!,
    per_order_cap_cents: perOrderCents!,
    allowed_payee_ids: merchantList,
    blocked_categories: blockedCategories.length > 0 ? blockedCategories : ["gift_card"],
    criteria: [
      {
        id: "crit_standard",
        type: "structured",
        field: "merchant_id",
        expected: merchantList[0],
      },
    ],
    expires_at: expiresAt,
    status: "ACTIVE",
  };

  return {
    status: "DRAFT",
    draft,
    warnings,
  };
}
