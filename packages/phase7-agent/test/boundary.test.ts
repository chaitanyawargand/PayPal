import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => entry.isDirectory()
    ? sourceFiles(join(directory, entry.name))
    : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []));
  return nested.flat();
}

describe("agent boundary", () => {
  it("contains no payment, credential, or arbitrary host execution path", async () => {
    const files = await sourceFiles(fileURLToPath(new URL("../src", import.meta.url)));
    const sources = await Promise.all(files.map(async (file) => ({ file, text: await readFile(file, "utf8") })));
    const source = sources.map((entry) => entry.text).join("\n");
    expect(source).not.toMatch(/@paypal|paypal\.com|capturePayment|process\.env|decidePayment|executePayment|verifyQuoteSignature|signQuote/i);
    const networkFiles = sources.filter(({ text }) => /globalThis\.fetch|\.fetch\(/.test(text)).map(({ file }) => file);
    expect(networkFiles.map((file) => file.split(/[\\/]/).at(-1)).sort()).toEqual(["gemini-model.ts", "merchant-tools.ts"]);
  });
});
