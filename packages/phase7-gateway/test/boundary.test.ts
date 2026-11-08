import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDirectory = fileURLToPath(new URL("../src/", import.meta.url));
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}
describe("gateway source boundary", () => {
  it("has no live provider, Gemini, environment, or outbound fetch integration", () => {
    const forbidden = /@paypal|api-m\.paypal\.com|api-m\.sandbox\.paypal\.com|capturePayment|GEMINI_API_KEY|process\.env|fetch\s*\(/i;
    for (const path of sourceFiles(sourceDirectory)) expect(readFileSync(path, "utf8"), path).not.toMatch(forbidden);
  });
});
