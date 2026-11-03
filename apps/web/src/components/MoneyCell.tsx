import { formatMoney } from "../money.ts";

export function MoneyCell({ cents, currency, muted = false }: { cents: number; currency: string; muted?: boolean }) {
  return <span className={`tabular-nums whitespace-nowrap ${muted ? "text-muted" : ""}`}>{formatMoney(cents, currency)}</span>;
}
