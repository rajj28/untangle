export type LeverageValue = number | "∞" | "—";

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function formatCompact(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

export function calculateLeverage(cleared: number, moved: number): LeverageValue {
  if (moved === 0) return cleared > 0 ? "∞" : "—";
  return cleared / moved;
}

export function formatLeverage(value: LeverageValue): string {
  return typeof value === "number" ? `${value.toFixed(1)}×` : value;
}
