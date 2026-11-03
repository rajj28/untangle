import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical.ts";

describe("canonicalJson", () => {
  it("sorts object keys so key order does not change the output", () => {
    expect(canonicalJson({ z: 1, a: 2 })).toBe(canonicalJson({ a: 2, z: 1 }));
    expect(canonicalJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
  });

  it("handles nested objects and arrays", () => {
    expect(canonicalJson({ values: [3, { z: true, a: null }] })).toBe('{"values":[3,{"a":null,"z":true}]}');
  });

  it("omits object properties with undefined values", () => {
    expect(canonicalJson({ keep: 1, omit: undefined })).toBe('{"keep":1}');
  });

  it("rejects non-integer numbers", () => {
    expect(() => canonicalJson(1.5)).toThrow(TypeError);
  });

  it("rejects NaN", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
  });

  it("rejects Date values", () => {
    expect(() => canonicalJson(new Date("2026-01-01T00:00:00.000Z"))).toThrow(TypeError);
  });

  it("rejects bigint values", () => {
    expect(() => canonicalJson(1n)).toThrow(TypeError);
  });

  it("uses JSON.stringify string escaping for Unicode", () => {
    const value = "café \u2028 😀";
    expect(canonicalJson(value)).toBe(JSON.stringify(value));
  });
});
