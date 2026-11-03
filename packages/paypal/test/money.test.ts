import { describe, expect, it } from "vitest";
import { fromMoney, payoutAmount, toMoney } from "../src/money.ts";

describe("money conversion", () => {
  it("formats USD and JPY using their currency exponents", () => {
    expect(toMoney(1010, "USD").value).toBe("10.10");
    expect(toMoney(5, "USD").value).toBe("0.05");
    expect(toMoney(0, "USD").value).toBe("0.00");
    expect(toMoney(500, "JPY").value).toBe("500");
  });

  it("rejects invalid minor amounts and currency codes", () => {
    expect(() => toMoney(-1, "USD")).toThrow(TypeError);
    expect(() => toMoney(1.5, "USD")).toThrow(TypeError);
    expect(() => toMoney(1, "usd")).toThrow(TypeError);
  });

  it("parses valid whole, fractional, and zero-decimal values exactly", () => {
    expect(fromMoney({ currency_code: "USD", value: "10" })).toBe(1000);
    expect(fromMoney({ currency_code: "USD", value: "10.1" })).toBe(1010);
    expect(fromMoney({ currency_code: "USD", value: "10.10" })).toBe(1010);
    expect(fromMoney({ currency_code: "JPY", value: "500" })).toBe(500);
  });

  it("rejects excess decimals, signs, spaces, empty values, and exponent notation", () => {
    expect(() => fromMoney({ currency_code: "USD", value: "1.234" })).toThrow(TypeError);
    expect(() => fromMoney({ currency_code: "JPY", value: "5.5" })).toThrow(TypeError);
    expect(() => fromMoney({ currency_code: "USD", value: "-1.00" })).toThrow(TypeError);
    expect(() => fromMoney({ currency_code: "USD", value: " 1.00" })).toThrow(TypeError);
    expect(() => fromMoney({ currency_code: "USD", value: "" })).toThrow(TypeError);
    expect(() => fromMoney({ currency_code: "USD", value: "1e3" })).toThrow(TypeError);
  });

  it("formats payout amounts with the payout currency field", () => {
    expect(payoutAmount(250, "USD")).toEqual({ currency: "USD", value: "2.50" });
  });

  it("round trips random safe minor amounts", () => {
    const currencies = ["USD", "EUR", "JPY"];
    for (let index = 0; index < 200; index += 1) {
      const amount = Math.floor(Math.random() * 1_000_000_000_001);
      const currency = currencies[index % currencies.length] ?? "USD";
      expect(fromMoney(toMoney(amount, currency))).toBe(amount);
    }
  });
});
