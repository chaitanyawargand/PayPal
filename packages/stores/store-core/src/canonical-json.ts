function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError("Non-finite number"); return value; }
  if (typeof value !== "object") throw new TypeError(`Unsupported JSON value: ${typeof value}`);
  if (seen.has(value)) throw new TypeError("Circular structure");
  seen.add(value);
  let result: unknown;
  if (Array.isArray(value)) result = value.map((entry) => normalize(entry, seen));
  else {
    const object = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) output[key] = normalize(object[key], seen);
    result = output;
  }
  seen.delete(value);
  return result;
}
export function canonicalJson(value: unknown): string { return JSON.stringify(normalize(value, new Set())); }
