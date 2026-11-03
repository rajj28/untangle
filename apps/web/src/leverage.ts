import { formatLeverage } from "./money.ts";
import type { LeverageValue } from "./money.ts";

export function leverageLabel(
  value: LeverageValue,
  status: string,
  planned: LeverageValue | null = null,
): { primary: string; secondary: string | null } {
  if (status === "closed") return { primary: `Round complete · ${formatLeverage(value)}`, secondary: null };
  return {
    primary: `${formatLeverage(value)} so far`,
    secondary: planned === null ? null : `${formatLeverage(planned)} when this round completes`,
  };
}
