import { describe, expect, it } from "vitest";
import { leverageLabel } from "../src/leverage.ts";

describe("leverage labels", () => {
  it("shows the current and planned value before the round closes", () => {
    expect(leverageLabel(5, "settling", 12.8)).toEqual({ primary: "5.0× so far", secondary: "12.8× when this round completes" });
  });

  it("shows infinity while an all-set-off round is in progress", () => {
    expect(leverageLabel("∞", "consenting", "∞")).toEqual({ primary: "∞ so far", secondary: "∞ when this round completes" });
  });

  it("labels a closed round and preserves the no-value dash", () => {
    expect(leverageLabel("—", "closed")).toEqual({ primary: "Round complete · —", secondary: null });
  });
});
