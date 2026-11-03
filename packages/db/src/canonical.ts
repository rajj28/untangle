import { createHash } from "node:crypto";

function canonicalValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON numbers must be finite");
    if (!Number.isInteger(value)) throw new TypeError("canonical JSON numbers must be integers");
    return JSON.stringify(value);
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`canonical JSON does not support ${typeof value} values`);
  }
  if (value === undefined) throw new TypeError("canonical JSON does not support undefined values here");
  if (value instanceof Date) throw new TypeError("canonical JSON does not support Date values; use ISO strings");

  if (typeof value !== "object") throw new TypeError("canonical JSON value is not supported");
  if (ancestors.has(value)) throw new TypeError("canonical JSON does not support circular values");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${Array.from(value, (item) => item === undefined ? "null" : canonicalValue(item, ancestors)).join(",")}]`;
    }

    const entries = Object.keys(value)
      .sort()
      .flatMap((key) => {
        const item: unknown = (value as Record<string, unknown>)[key];
        if (item === undefined) return [];
        return [`${JSON.stringify(key)}:${canonicalValue(item, ancestors)}`];
      });
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value, new Set());
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
