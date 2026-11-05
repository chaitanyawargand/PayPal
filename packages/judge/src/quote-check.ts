export interface GroundedQuoteCheckResult {
  valid: boolean;
  reason?: string;
}

const NEGATION_PATTERNS = [
  /\bnot\b/i,
  /\bno\b/i,
  /\bnever\b/i,
  /\bexcept\b/i,
  /\bnon-/i,
  /\bunsupported\b/i,
  /\bwithout\b/i,
  /\bisn't\b/i,
  /\bdoesn't\b/i,
  /\bdid not\b/i,
  /\bdoes not\b/i,
  /\bcannot\b/i,
  /\bcan't\b/i,
  /\bfalse\b/i,
  /\bfake\b/i,
];

/**
 * Validates a grounded quote against verbatim evidence_text.
 * Locked rule: indexOf + 80-char negation window check.
 */
export function checkGroundedQuote(
  evidenceText: string,
  quote: string | null,
): GroundedQuoteCheckResult {
  if (!quote) {
    return { valid: true };
  }

  const trimmedQuote = quote.trim();
  if (!trimmedQuote) {
    return { valid: true };
  }

  // Exact verbatim occurrence in evidence_text
  const idx = evidenceText.indexOf(trimmedQuote);
  if (idx === -1) {
    return {
      valid: false,
      reason: `Grounded quote "${trimmedQuote}" was not found verbatim in evidence_text.`,
    };
  }

  // Check 80-char window before the quote for negation modifiers
  const start = Math.max(0, idx - 80);
  const prefix = evidenceText.slice(start, idx);

  for (const pattern of NEGATION_PATTERNS) {
    if (pattern.test(prefix)) {
      return {
        valid: false,
        reason: `Negation detected within 80-char window of quote in evidence_text: "${prefix.trim()}".`,
      };
    }
  }

  return { valid: true };
}

