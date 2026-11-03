import { describe, expect, it } from "vitest";
import { statementLines } from "../src/statement.ts";
import type { StatementBody } from "../src/types.ts";

const body: StatementBody = {
  roundId: "round-1", businessId: "cafe", networkId: "network-1", currency: "USD", planHash: "hash",
  setoffs: [
    { obligationId: "a", invoiceId: "INV-A", role: "creditor", counterpartyId: "bakery", amountMinor: 40000, outstandingBeforeMinor: 40000, remainingAfterMinor: 0 },
    { obligationId: "b", invoiceId: "INV-B", role: "debtor", counterpartyId: "mill", amountMinor: 20000, outstandingBeforeMinor: 20000, remainingAfterMinor: 0 },
  ],
  pays: [{ transferId: "t1", payeeId: "cleaning", amountMinor: 100000 }],
  receives: [{ transferId: "t2", payerId: "corner", amountMinor: 50000 }],
  passThrough: [{ transferId: "t1", obligationId: "c", role: "debtor", amountMinor: 25000 }],
  totals: { clearedMinor: 60000, paysMinor: 100000, receivesMinor: 50000 },
};

describe("statementLines", () => {
  it("explains set-off roles, payments, pass-through, and totals in plain language", () => {
    const lines = statementLines(body, { bakery: "Rosa's Bakery", mill: "Mill", cleaning: "Sparkle Cleaning Co", corner: "Corner Cafe" }, "USD");
    expect(lines.map((line) => line.text)).toEqual(expect.arrayContaining([
      "Your invoice to Rosa's Bakery ($400.00) is cleared by set-off — no money moves.",
      "Your invoice from Mill ($200.00) is cleared by set-off — no money moves.",
      "You pay Sparkle Cleaning Co $1,000.00 with PayPal.",
      "You receive $500.00 from Corner Cafe with PayPal.",
      "an invoice you owe ($250.00) is settled on your behalf as part of the payment chain.",
      "Total cleared with no money moving: $600.00.",
      "Total you pay: $1,000.00.",
      "Total you receive: $500.00.",
    ]));
  });
});
