export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function normalize(
  value: JsonValue,
  ancestors: WeakSet<object>,
): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Canonical JSON cannot contain non-finite numbers');
    }

    return value;
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new Error('Circular reference detected');
    }

    ancestors.add(value);

    const result = value.map((item) => normalize(item, ancestors));

    ancestors.delete(value);

    return result;
  }

  if (typeof value === 'object') {
    if (ancestors.has(value)) {
      throw new Error('Circular reference detected');
    }

    const prototype = Object.getPrototypeOf(value);

    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Only plain objects are supported');
    }

    ancestors.add(value);

    const result: { [key: string]: JsonValue } = {};

    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, JsonValue>)[key];

      if (item === undefined) {
        throw new Error(`Undefined value at key: ${key}`);
      }

      result[key] = normalize(item, ancestors);
    }

    ancestors.delete(value);

    return result;
  }

  throw new Error('Unsupported value in canonical JSON');
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(normalize(value, new WeakSet()));
}