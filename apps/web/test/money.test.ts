import { describe, expect, it } from "vitest";
import { calculateLeverage, formatLeverage, formatMoney, percent } from "../src/money.ts";

describe("money formatting", () => {
  it("formats zero cents", () => {
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });

  it("formats a small amount without converting cents early", () => {
    expect(formatMoney(5, "USD")).toBe("$0.05");
  });

  it("formats a comma separated amount", () => {
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
  });

  it("formats negative amounts", () => {
    expect(formatMoney(-123456, "USD")).toBe("-$1,234.56");
  });

  it("clamps progress percentages to the visible range", () => {
    expect(percent(25, 100)).toBe(25);
    expect(percent(120, 100)).toBe(100);
    expect(percent(10, 0)).toBe(0);
  });
});

describe("settlement leverage", () => {
  it("computes invoices settled per unit moved", () => {
    expect(calculateLeverage(281000, 22000)).toBeCloseTo(12.772727, 5);
    expect(formatLeverage(calculateLeverage(281000, 22000))).toBe("12.8×");
  });

  it("shows infinity when value was cleared without money moving", () => {
    expect(calculateLeverage(1, 0)).toBe("∞");
  });

  it("shows a dash when nothing was cleared or moved", () => {
    expect(calculateLeverage(0, 0)).toBe("—");
  });
});
