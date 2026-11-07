import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { compileDraftContract } from "../src/compiler.js";

describe("packages/compiler - Draft Contract Compiler", () => {
  it("1. Compiles structured input into an unsigned draft with integer cents", () => {
    const result = compileDraftContract({
      payer_id: "payer_sidd_001",
      budget_max_cents: 10000,
      per_order_cap_cents: 8000,
      allowed_payee_ids: ["merchant_trailgear"],
      blocked_categories: ["gift_card"],
    });

    expect(result.status).toBe("DRAFT");
    expect(result.draft).not.toBeNull();
    expect(result.draft!.budget_max_cents).toBe(10000);
    expect(result.draft!.per_order_cap_cents).toBe(8000);
    expect(result.draft!.allowed_payee_ids).toEqual(["merchant_trailgear"]);
    expect(result.draft!.blocked_categories).toEqual(["gift_card"]);
    expect(result.draft!.status).toBe("ACTIVE");
  });

  it("2. Draft object MUST NEVER contain a signature or hash field", () => {
    const result = compileDraftContract({
      budget_max_cents: 10000,
      per_order_cap_cents: 8000,
      allowed_payee_ids: ["merchant_trailgear"],
    });

    expect(result.status).toBe("DRAFT");
    const draft = result.draft as any;
    expect("signature" in draft).toBe(false);
    expect(draft.signature).toBeUndefined();
    expect("hash" in draft).toBe(false);
    expect(draft.hash).toBeUndefined();
  });

  it("3. Missing merchant triggers NEEDS_CLARIFICATION with warnings", () => {
    const result = compileDraftContract({
      budget_max_cents: 10000,
      per_order_cap_cents: 8000,
      allowed_payee_ids: [],
    });

    expect(result.status).toBe("NEEDS_CLARIFICATION");
    expect(result.draft).toBeNull();
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Allowed merchant")]),
    );
  });

  it("4. Missing budget cap triggers NEEDS_CLARIFICATION with warnings", () => {
    const result = compileDraftContract({
      allowed_payee_ids: ["merchant_trailgear"],
    });

    expect(result.status).toBe("NEEDS_CLARIFICATION");
    expect(result.draft).toBeNull();
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Total budget cap")]),
    );
  });

  it("5. Inconsistent caps (per-order > budget) triggers NEEDS_CLARIFICATION", () => {
    const result = compileDraftContract({
      allowed_payee_ids: ["merchant_trailgear"],
      budget_max_cents: 5000,
      per_order_cap_cents: 10000,
    });

    expect(result.status).toBe("NEEDS_CLARIFICATION");
    expect(result.draft).toBeNull();
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Per-order cap cannot exceed")]),
    );
  });

  it("6. Parses natural language prose prompt accurately", () => {
    const prompt =
      "Allow purchases at TrailGear up to $100, max $80 per order, no gift cards";
    const result = compileDraftContract(prompt);

    expect(result.status).toBe("DRAFT");
    expect(result.draft).not.toBeNull();
    expect(result.draft!.allowed_payee_ids).toContain("merchant_trailgear");
    expect(result.draft!.budget_max_cents).toBe(10000);
    expect(result.draft!.per_order_cap_cents).toBe(8000);
    expect(result.draft!.blocked_categories).toContain("gift_card");
  });

  it("7. Vague or open-ended prose triggers NEEDS_CLARIFICATION without guessing", () => {
    const vaguePrompt = "Go buy whatever you want whenever you feel like it";
    const result = compileDraftContract(vaguePrompt);

    expect(result.status).toBe("NEEDS_CLARIFICATION");
    expect(result.draft).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("8. Architectural Boundary: packages/compiler has zero execution, DB, or signing imports", () => {
    const srcDir = path.resolve(__dirname, "../src");
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts"));

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = fs.readFileSync(path.join(srcDir, file), "utf-8");
      expect(content).not.toMatch(/from\s+["'].*db.*["']/i);
      expect(content).not.toMatch(/from\s+["'].*psp.*["']/i);
      expect(content).not.toMatch(/from\s+["'].*flow.*["']/i);
      expect(content).not.toMatch(/from\s+["'].*gateway.*["']/i);
      expect(content).not.toMatch(/from\s+["'].*sign.*["']/i);
      expect(content).not.toMatch(/process\.env/i);
    }
  });
});
