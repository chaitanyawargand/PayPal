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

describe("trusted host source boundary", () => {
  it("keeps engine decisions and private signing material in their designated modules", async () => {
    const files = await sourceFiles(fileURLToPath(new URL("../src", import.meta.url)));
    const sources = await Promise.all(files.map(async (file) => ({ file, text: await readFile(file, "utf8") })));
    const joined = sources.map(({ text }) => text).join("\n");
    expect(joined).not.toMatch(/process\.env|@paypal|capturePayment|executePayment|signQuotePayload|generativelanguage\.googleapis\.com/i);
    expect(sources.filter(({ text }) => /\bdecidePayment\s*\(/.test(text)).map(({ file }) => file.split(/[\\/]/).at(-1))).toEqual(["decision-adapter.ts"]);
    expect(sources.filter(({ text }) => /createPrivateKey|\bsign\(/.test(text)).map(({ file }) => file.split(/[\\/]/).at(-1))).toEqual(["contract-resolver.ts"]);
    expect(joined).not.toMatch(/-----BEGIN (?:PRIVATE KEY|RSA PRIVATE KEY|ED25519 PRIVATE KEY)-----/);
  });
});
