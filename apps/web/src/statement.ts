import { formatMoney } from "./money.ts";
import type { StatementBody } from "./types.ts";

export interface StatementLine {
  kind: "setoff" | "pays" | "receives" | "pass-through" | "total";
  text: string;
}

type Names = Readonly<Record<string, string | undefined>>;

export function statementLines(body: StatementBody, names: Names, currency: string): StatementLine[] {
  const lines: StatementLine[] = [];
  for (const item of body.setoffs) {
    const counterparty = names[item.counterpartyId] ?? "another business";
    const invoice = item.role === "creditor" ? `Your invoice to ${counterparty}` : `Your invoice from ${counterparty}`;
    lines.push({ kind: "setoff", text: `${invoice} (${formatMoney(item.amountMinor, currency)}) is cleared by set-off — no money moves.` });
  }
  for (const item of body.pays) {
    lines.push({ kind: "pays", text: `You pay ${names[item.payeeId] ?? "another business"} ${formatMoney(item.amountMinor, currency)} with PayPal.` });
  }
  for (const item of body.receives) {
    lines.push({ kind: "receives", text: `You receive ${formatMoney(item.amountMinor, currency)} from ${names[item.payerId] ?? "another business"} with PayPal.` });
  }
  for (const item of body.passThrough) {
    const direction = item.role === "creditor" ? "an invoice you are owed" : "an invoice you owe";
    lines.push({ kind: "pass-through", text: `${direction} (${formatMoney(item.amountMinor, currency)}) is settled on your behalf as part of the payment chain.` });
  }
  lines.push({ kind: "total", text: `Total cleared with no money moving: ${formatMoney(body.totals.clearedMinor, currency)}.` });
  lines.push({ kind: "total", text: `Total you pay: ${formatMoney(body.totals.paysMinor, currency)}.` });
  lines.push({ kind: "total", text: `Total you receive: ${formatMoney(body.totals.receivesMinor, currency)}.` });
  return lines;
}
