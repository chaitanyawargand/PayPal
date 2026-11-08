import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDirectory = fileURLToPath(new URL("../src/", import.meta.url));
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("Phase 7B package boundary", () => {
  it("contains no payment provider, Gemini, or environment access", () => {
    const forbidden = /@paypal|capturePayment|api-m\.paypal\.com|api-m\.sandbox\.paypal\.com|GEMINI_API_KEY|process\.env/i;
    for (const path of sources(sourceDirectory)) expect(readFileSync(path, "utf8"), path).not.toMatch(forbidden);
  });
});
