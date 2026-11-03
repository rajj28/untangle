import { describe, expect, it } from "vitest";
import { defaultRoute, parseRoute } from "../src/routes.ts";

describe("hash routes", () => {
  it("parses picker, business pages, and desk views", () => {
    expect(parseRoute("#/me")).toEqual({ kind: "picker" });
    expect(parseRoute("#/me/business-1")).toEqual({ kind: "business", businessId: "business-1", page: "home" });
    expect(parseRoute("#/me/business-1/invoices")).toEqual({ kind: "business", businessId: "business-1", page: "invoices" });
    expect(parseRoute("#/me/business-1/activity")).toEqual({ kind: "business", businessId: "business-1", page: "activity" });
    for (const view of ["ledger", "settlement", "network", "matrix", "activity"] as const) {
      expect(parseRoute(`#/desk/${view}`)).toEqual({ kind: "desk", view });
    }
  });

  it("rejects malformed and unknown routes", () => {
    expect(parseRoute("#/me/business-1/unknown")).toBeNull();
    expect(parseRoute("#/desk/nope")).toBeNull();
    expect(parseRoute("not-a-route")).toBeNull();
  });

  it("chooses a default based on viewport width and remembered business", () => {
    expect(defaultRoute(375, null)).toEqual({ kind: "picker" });
    expect(defaultRoute(767, "business-1")).toEqual({ kind: "business", businessId: "business-1", page: "home" });
    expect(defaultRoute(768, null)).toEqual({ kind: "desk", view: "settlement" });
  });
});
