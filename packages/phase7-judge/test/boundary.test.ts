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

describe("judge source boundary", () => {
  it("contains no payment, credential, signing, or quote verification code", async () => {
    const files = await sourceFiles(fileURLToPath(new URL("../src", import.meta.url)));
    const sources = await Promise.all(files.map(async (file) => ({ file, text: await readFile(file, "utf8") })));
    const joined = sources.map(({ text }) => text).join("\n");
    expect(joined).not.toMatch(/@paypal|paypal\.com|capturePayment|process\.env|decidePayment|executePayment|verifyQuoteSignature|signQuote|HMAC/i);
    const fetchFiles = sources.filter(({ text }) => /globalThis\.fetch|\.fetch\(/.test(text)).map(({ file }) => file.split(/[\\/]/).at(-1));
    expect(fetchFiles).toEqual(["gemini-model.ts"]);
  });
});
