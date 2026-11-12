import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appScriptPath = fileURLToPath(new URL("../public/app.js", import.meta.url));

function loadFormatter(source: string): (cents: unknown) => string {
  const match = source.match(/function formatCents\(cents\) \{[\s\S]*?\n  \}/);
  if (!match) throw new Error("formatCents was not found in app.js");
  return new Function(`${match[0]}\nreturn formatCents;`)() as (cents: unknown) => string;
}

describe("price formatting", () => {
  it.each([
    [null, "Unavailable"],
    [undefined, "Unavailable"],
    [Number.NaN, "Unavailable"],
    [-1, "Unavailable"],
    [1.5, "Unavailable"],
    [0, "$0.00"],
    [6774, "$67.74"],
  ])("formats %s cents safely", async (cents, expected) => {
    const source = await readFile(appScriptPath, "utf8");
    expect(loadFormatter(source)(cents)).toBe(expected);
  });

  it("uses nullish fallback so a real zero price is not replaced", async () => {
    const source = await readFile(appScriptPath, "utf8");
    expect(source).toContain("cand.quoteTotalCents ?? cand.advertisedTotalCents");
    expect(source).not.toContain("cand.quoteTotalCents || cand.advertisedTotalCents");
  });
});
