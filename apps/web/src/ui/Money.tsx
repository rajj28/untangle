import { formatMoney } from "../money.ts";

export function Money({ cents, currency, sign = false, className = "" }: { cents: number; currency: string; sign?: boolean; className?: string }) {
  const prefix = sign && cents < 0 ? "−" : sign && cents > 0 ? "+" : "";
  const value = formatMoney(sign ? Math.abs(cents) : cents, currency);
  return <span className={`tabular-nums whitespace-nowrap ${className}`}>{prefix}{value}</span>;
}
