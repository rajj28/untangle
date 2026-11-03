import type { Money, PayoutAmount } from "./types.ts";

export type { Money, PayoutAmount } from "./types.ts";

const ZERO_DECIMAL_CURRENCIES = new Set(["HUF", "JPY", "TWD"]);
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function validateCurrency(currency: string): void {
  if (!CURRENCY_PATTERN.test(currency)) throw new TypeError("currency must be a 3-letter uppercase code");
}

export function currencyExponent(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
}

function formatMinor(minor: number, currency: string): string {
  validateCurrency(currency);
  if (!Number.isSafeInteger(minor) || minor < 0) throw new TypeError("minor amount must be a safe non-negative integer");

  const exponent = currencyExponent(currency);
  if (exponent === 0) return String(minor);

  const divisor = 10n ** BigInt(exponent);
  const value = BigInt(minor);
  const whole = value / divisor;
  const fraction = String(value % divisor).padStart(exponent, "0");
  return `${whole}.${fraction}`;
}

export function toMoney(minor: number, currency: string): Money {
  return { currency_code: currency, value: formatMinor(minor, currency) };
}

export function payoutAmount(minor: number, currency: string): PayoutAmount {
  return { currency, value: formatMinor(minor, currency) };
}

export function fromMoney(money: Money | PayoutAmount): number {
  const currency = "currency_code" in money ? money.currency_code : money.currency;
  validateCurrency(currency);
  const exponent = currencyExponent(currency);
  if (typeof money.value !== "string") throw new TypeError("money value must be a decimal string");
  const decimalPattern = exponent === 0 ? /^(\d+)$/ : /^(\d+)(?:\.(\d{1,2}))?$/;
  const match = decimalPattern.exec(money.value);
  if (match === null) throw new TypeError("money value must be an unsigned decimal amount");

  const whole = BigInt(match[1] ?? "0");
  const fraction = exponent === 0 ? 0n : BigInt((match[2] ?? "").padEnd(exponent, "0") || "0");
  const minor = whole * 10n ** BigInt(exponent) + fraction;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError("money value exceeds the safe integer range");
  return Number(minor);
}
